// snapshot_sync_logs helpers. Server-only.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { updateHealthFromSync } from "./health.server";


export type SnapshotType = "customer" | "stock" | "contract";
export type SyncStatus = "success" | "partial" | "failed";

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
}

interface RunOptions {
  tenantCode: string;
  snapshotType: SnapshotType;
}

interface Counters {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  /**
   * Free-form counters and diagnostics stored on `snapshot_sync_logs.details`.
   * The subscription sync uses this for per-run detail-line, mapping, and
   * void-exclusion counts required by the Phase 1.0.1 diagnostics.
   */
  details: Record<string, unknown>;
}

/**
 * Thrown by a sync worker when required inputs are missing (e.g. no renewal
 * stock mapping, no customer snapshots). The run is NOT a failure but it
 * cannot produce a valid outcome — health must show Warning, not Healthy.
 */
export class SyncNotReadyError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
    this.name = "SyncNotReadyError";
  }
}

/**
 * Thrown when another sync run of the same tenant + snapshot type is
 * already in progress. Callers should translate this to HTTP 409.
 */
export class SyncLockedError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
    this.name = "SyncLockedError";
  }
}

export async function runWithSyncLog(
  opts: RunOptions,
  work: (counters: Counters) => Promise<void>,
): Promise<SyncResult> {
  // ---- Acquire tenant + snapshot-type lock -------------------------------
  const { error: lockErr } = await supabaseAdmin
    .from("sync_locks")
    .insert({ tenant_code: opts.tenantCode, snapshot_type: opts.snapshotType });
  if (lockErr) {
    // 23505 = unique_violation. Anything else is unexpected.
    if ((lockErr as { code?: string }).code === "23505") {
      throw new SyncLockedError(
        "A synchronization run is already in progress for this Client.",
      );
    }
    throw new Error(`Failed to acquire sync lock: ${lockErr.message}`);
  }

  const started = Date.now();

  try {
    const { data: logRow, error: logErr } = await supabaseAdmin
      .from("snapshot_sync_logs")
      .insert({
        tenant_code: opts.tenantCode,
        snapshot_type: opts.snapshotType,
        status: "running",
      })
      .select("id")
      .single();
    if (logErr || !logRow) {
      throw new Error(`Failed to open sync log: ${logErr?.message ?? "unknown"}`);
    }

    const counters: Counters = { inserted: 0, updated: 0, skipped: 0, failed: 0, details: {} };
    let status: SyncStatus = "success";
    let errorMessage: string | undefined;
    let notReadyReason: string | undefined;

    try {
      await work(counters);
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

    return { ...counters, durationMs, logId: logRow.id, status, errorMessage, notReadyReason };
  } finally {
    // Always release the sync lock so a crashed/failed run cannot block the next one.
    await supabaseAdmin
      .from("sync_locks")
      .delete()
      .eq("tenant_code", opts.tenantCode)
      .eq("snapshot_type", opts.snapshotType);
  }
}

