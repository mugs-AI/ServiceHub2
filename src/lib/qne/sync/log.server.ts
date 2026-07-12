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

  try {
    await work(counters);
    if (counters.failed > 0) status = "partial";
  } catch (err) {
    status = "failed";
    errorMessage = err instanceof Error ? err.message : String(err);
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
      succeeded: status !== "failed",
    });
  } catch (err) {
    console.error("[snapshot_health] update failed", err);
  }

  return { ...counters, durationMs, logId: logRow.id, status, errorMessage };
}

