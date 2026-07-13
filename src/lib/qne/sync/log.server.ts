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

export async function runWithSyncLog(
  opts: RunOptions,
  work: (counters: Counters) => Promise<void>,
): Promise<SyncResult> {
  const started = Date.now();
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

  const counters: Counters = { inserted: 0, updated: 0, skipped: 0, failed: 0 };
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
    })
    .eq("id", logRow.id);

  // Snapshot Health & Diagnostics — monitoring layer only; must never
  // affect synchronization outcomes.
  try {
    await updateHealthFromSync({
      tenantCode: opts.tenantCode,
      snapshotType: opts.snapshotType,
      syncStatus: status,
      syncErrorMessage: errorMessage,
      counters,
      lastAttempt: new Date(),
      // A "not ready" sync did not fail, but it also did not succeed —
      // do NOT advance last_successful_sync and force a Warning below.
      succeeded: status !== "failed" && !notReadyReason,
      notReadyReason,
    });
  } catch (err) {
    console.error("[snapshot_health] update failed", err);
  }

  return { ...counters, durationMs, logId: logRow.id, status, errorMessage, notReadyReason };
}
