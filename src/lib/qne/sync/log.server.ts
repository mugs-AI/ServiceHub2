// snapshot_sync_logs helpers with LEASED sync-lock support. Server-only.
//
// A lock is a lease: the row on `sync_locks` carries `expires_at` and
// `heartbeat_at`, and any lock whose lease has expired OR whose heartbeat is
// older than STALE_HEARTBEAT_MS is considered stale and automatically
// recovered on the next attempt. This prevents a crashed / redeployed /
// timed-out sync run from blocking the tenant forever.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { updateHealthFromSync } from "./health.server";


export type SnapshotType = "customer" | "stock" | "contract";
export type SyncStatus = "success" | "partial" | "failed";

/** Lease duration for a fresh heartbeat write. */
export const LEASE_MS = 10 * 60 * 1000; // 10 minutes
/** Any lock without a heartbeat this recent is considered abandoned. */
export const STALE_HEARTBEAT_MS = 5 * 60 * 1000; // 5 minutes

export interface SyncResult {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  durationMs: number;
  logId: string;
  status: SyncStatus;
  errorMessage?: string;
  notReadyReason?: string;
  details?: Record<string, unknown>;
  recovered?: boolean;
  recoveredNote?: string;
}

interface RunOptions {
  tenantCode: string;
  snapshotType: SnapshotType;
  /** Optional actor string stored on the lock (e.g. user email). */
  actor?: string;
}

interface Counters {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  details: Record<string, unknown>;
}

/**
 * Progress reporter passed to the worker. Updates the lock heartbeat +
 * lease AND the sync log's `stage` / `heartbeat_at` / `progress` fields.
 * Safe to call as often as you like — errors are swallowed so a transient
 * DB hiccup does not blow up the sync itself.
 */
export type HeartbeatFn = (
  stage: string,
  progress?: Record<string, unknown>,
) => Promise<void>;

export class SyncNotReadyError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
    this.name = "SyncNotReadyError";
  }
}

export interface ActiveLockInfo {
  tenantCode: string;
  snapshotType: SnapshotType;
  acquiredAt: string | null;
  heartbeatAt: string | null;
  expiresAt: string | null;
  stage: string | null;
  isStale: boolean;
  ageSeconds: number | null;
}

/** Thrown when a live (non-stale) lock blocks a new run. */
export class SyncLockedError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly activeLock: ActiveLockInfo,
  ) {
    super(userMessage);
    this.name = "SyncLockedError";
  }
}

// ------------------------------------------------------------------
// Public helpers used by API routes / admin console
// ------------------------------------------------------------------

/** Classify a lock row as stale (recoverable) or live. */
export function classifyLock(row: {
  acquired_at?: string | null;
  heartbeat_at?: string | null;
  expires_at?: string | null;
}, now: Date = new Date()): { isStale: boolean; ageSeconds: number | null } {
  const heartbeat = row.heartbeat_at ? new Date(row.heartbeat_at).getTime() : null;
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : null;
  const acquired = row.acquired_at ? new Date(row.acquired_at).getTime() : null;
  const ageMs = heartbeat ?? acquired;
  const ageSeconds = ageMs != null ? Math.round((now.getTime() - ageMs) / 1000) : null;

  // Legacy rows (no lease info at all) are stale by definition.
  if (expires == null && heartbeat == null) return { isStale: true, ageSeconds };
  if (expires != null && expires < now.getTime()) return { isStale: true, ageSeconds };
  if (heartbeat != null && now.getTime() - heartbeat > STALE_HEARTBEAT_MS) {
    return { isStale: true, ageSeconds };
  }
  return { isStale: false, ageSeconds };
}

export async function listActiveLocks(tenantCode: string): Promise<ActiveLockInfo[]> {
  const { data, error } = await supabaseAdmin
    .from("sync_locks")
    .select("tenant_code, snapshot_type, acquired_at, heartbeat_at, expires_at, stage")
    .eq("tenant_code", tenantCode);
  if (error) throw new Error(`Load sync_locks failed: ${error.message}`);
  const now = new Date();
  return (data ?? []).map((r) => {
    const { isStale, ageSeconds } = classifyLock(r, now);
    return {
      tenantCode: r.tenant_code,
      snapshotType: r.snapshot_type as SnapshotType,
      acquiredAt: r.acquired_at,
      heartbeatAt: r.heartbeat_at,
      expiresAt: r.expires_at,
      stage: r.stage,
      isStale,
      ageSeconds,
    };
  });
}

/**
 * Mark the abandoned in-flight log row (if any) as failed and remove the
 * stale lock. Called both by the automatic recovery path (on next acquire)
 * and by the admin "Recover Stale Sync" action.
 *
 * Returns `true` if a stale lock was found and released; `false` if the
 * lock either did not exist or was still live.
 */
export async function recoverStaleLock(
  tenantCode: string,
  snapshotType: SnapshotType,
  reason = "Previous synchronization did not complete and its stale lock was recovered.",
): Promise<{ recovered: boolean; wasLive?: ActiveLockInfo }> {
  const { data: lock } = await supabaseAdmin
    .from("sync_locks")
    .select("tenant_code, snapshot_type, acquired_at, heartbeat_at, expires_at, stage, sync_log_id")
    .eq("tenant_code", tenantCode)
    .eq("snapshot_type", snapshotType)
    .maybeSingle();
  if (!lock) return { recovered: false };

  const { isStale, ageSeconds } = classifyLock(lock);
  if (!isStale) {
    return {
      recovered: false,
      wasLive: {
        tenantCode: lock.tenant_code,
        snapshotType: lock.snapshot_type as SnapshotType,
        acquiredAt: lock.acquired_at,
        heartbeatAt: lock.heartbeat_at,
        expiresAt: lock.expires_at,
        stage: lock.stage,
        isStale: false,
        ageSeconds,
      },
    };
  }

  // Best-effort: close the specific log row this lock referenced,
  // else close the most recent still-running row for tenant/type.
  const logId = (lock as { sync_log_id?: string | null }).sync_log_id ?? null;
  if (logId) {
    await supabaseAdmin
      .from("snapshot_sync_logs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: reason,
      })
      .eq("id", logId)
      .eq("status", "running");
  } else {
    const { data: recent } = await supabaseAdmin
      .from("snapshot_sync_logs")
      .select("id")
      .eq("tenant_code", tenantCode)
      .eq("snapshot_type", snapshotType)
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1);
    if (recent && recent[0]) {
      await supabaseAdmin
        .from("snapshot_sync_logs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: reason,
        })
        .eq("id", recent[0].id);
    }
  }

  await supabaseAdmin
    .from("sync_locks")
    .delete()
    .eq("tenant_code", tenantCode)
    .eq("snapshot_type", snapshotType);

  return { recovered: true };
}

// ------------------------------------------------------------------
// Core: acquire lease → open log → run work with heartbeat → release
// ------------------------------------------------------------------

async function tryAcquireLease(
  opts: RunOptions,
  runId: string,
  now: Date,
): Promise<{ acquired: boolean; existing?: ActiveLockInfo }> {
  const expiresAt = new Date(now.getTime() + LEASE_MS).toISOString();
  const insert = await supabaseAdmin.from("sync_locks").insert({
    tenant_code: opts.tenantCode,
    snapshot_type: opts.snapshotType,
    acquired_at: now.toISOString(),
    acquired_by: opts.actor ?? null,
    run_id: runId,
    heartbeat_at: now.toISOString(),
    expires_at: expiresAt,
    stage: "starting",
    status: "running",
  });
  if (!insert.error) return { acquired: true };
  if ((insert.error as { code?: string }).code !== "23505") {
    throw new Error(`Failed to acquire sync lock: ${insert.error.message}`);
  }

  // Conflict — inspect existing row.
  const { data: existing } = await supabaseAdmin
    .from("sync_locks")
    .select("tenant_code, snapshot_type, acquired_at, heartbeat_at, expires_at, stage")
    .eq("tenant_code", opts.tenantCode)
    .eq("snapshot_type", opts.snapshotType)
    .maybeSingle();
  if (!existing) {
    // Vanished between insert and select — retry insert.
    return { acquired: false };
  }
  const { isStale, ageSeconds } = classifyLock(existing, now);
  return {
    acquired: false,
    existing: {
      tenantCode: existing.tenant_code,
      snapshotType: existing.snapshot_type as SnapshotType,
      acquiredAt: existing.acquired_at,
      heartbeatAt: existing.heartbeat_at,
      expiresAt: existing.expires_at,
      stage: existing.stage,
      isStale,
      ageSeconds,
    },
  };
}

export async function runWithSyncLog(
  opts: RunOptions,
  work: (counters: Counters, heartbeat: HeartbeatFn) => Promise<void>,
): Promise<SyncResult> {
  const runId = crypto.randomUUID();
  let recoveredNote: string | undefined;

  // Acquire, recovering a stale lock at most once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { acquired, existing } = await tryAcquireLease(opts, runId, new Date());
    if (acquired) break;

    if (existing && !existing.isStale) {
      throw new SyncLockedError(
        `A synchronization run is already in progress for this Client (stage: ${existing.stage ?? "unknown"}, last heartbeat ${existing.ageSeconds ?? "?"}s ago).`,
        existing,
      );
    }

    // Stale (or vanished) — recover and retry once.
    if (existing) {
      await recoverStaleLock(
        opts.tenantCode,
        opts.snapshotType,
        "Previous synchronization did not complete and its stale lock was recovered.",
      );
      recoveredNote = `Recovered a stale ${opts.snapshotType} lock (last heartbeat ${existing.ageSeconds ?? "?"}s ago) before starting this run.`;
    }
  }

  const started = Date.now();

  try {
    const { data: logRow, error: logErr } = await supabaseAdmin
      .from("snapshot_sync_logs")
      .insert({
        tenant_code: opts.tenantCode,
        snapshot_type: opts.snapshotType,
        status: "running",
        stage: "starting",
        heartbeat_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (logErr || !logRow) {
      throw new Error(`Failed to open sync log: ${logErr?.message ?? "unknown"}`);
    }

    // Link lock → log so the recovery path can close the exact row.
    await supabaseAdmin
      .from("sync_locks")
      .update({ sync_log_id: logRow.id })
      .eq("tenant_code", opts.tenantCode)
      .eq("snapshot_type", opts.snapshotType);

    const counters: Counters = { inserted: 0, updated: 0, skipped: 0, failed: 0, details: {} };
    let status: SyncStatus = "success";
    let errorMessage: string | undefined;
    let notReadyReason: string | undefined;

    const heartbeat: HeartbeatFn = async (stage, progress) => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + LEASE_MS).toISOString();
      try {
        await Promise.all([
          supabaseAdmin
            .from("sync_locks")
            .update({
              heartbeat_at: now.toISOString(),
              expires_at: expiresAt,
              stage,
            })
            .eq("tenant_code", opts.tenantCode)
            .eq("snapshot_type", opts.snapshotType),
          supabaseAdmin
            .from("snapshot_sync_logs")
            .update({
              stage,
              heartbeat_at: now.toISOString(),
              ...(progress ? { progress: progress as never } : {}),
            })
            .eq("id", logRow.id),
        ]);
      } catch (err) {
        console.warn("[sync heartbeat] update failed", err);
      }
    };

    try {
      await work(counters, heartbeat);
      if (counters.failed > 0) status = "partial";
    } catch (err) {
      if (err instanceof SyncNotReadyError) {
        status = "partial";
        notReadyReason = err.userMessage;
        errorMessage = err.userMessage;
      } else {
        status = "failed";
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    }

    const durationMs = Date.now() - started;
    await supabaseAdmin
      .from("snapshot_sync_logs")
      .update({
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        inserted_count: counters.inserted,
        updated_count: counters.updated,
        skipped_count: counters.skipped,
        failed_count: counters.failed,
        status,
        stage: status === "success" ? "completed" : status,
        heartbeat_at: new Date().toISOString(),
        error_message: errorMessage ?? null,
        details: (Object.keys(counters.details).length > 0 ? counters.details : null) as never,
      })
      .eq("id", logRow.id);

    try {
      await updateHealthFromSync({
        tenantCode: opts.tenantCode,
        snapshotType: opts.snapshotType,
        syncStatus: status,
        syncErrorMessage: errorMessage,
        counters,
        lastAttempt: new Date(),
        succeeded: status !== "failed" && !notReadyReason,
        notReadyReason,
      });
    } catch (err) {
      console.error("[snapshot_health] update failed", err);
    }

    return {
      ...counters,
      durationMs,
      logId: logRow.id,
      status,
      errorMessage,
      notReadyReason,
      recovered: recoveredNote != null,
      recoveredNote,
    };
  } finally {
    // Best-effort release; recovery path handles the case where this never runs.
    await supabaseAdmin
      .from("sync_locks")
      .delete()
      .eq("tenant_code", opts.tenantCode)
      .eq("snapshot_type", opts.snapshotType);
  }
}
