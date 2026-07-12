// Diagnostics helpers. Server-only. Tenant is resolved from the N3 session.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  loadFreshnessThresholds,
  runValidation,
  isStale,
  toPublicSnapshotType,
  type HealthSnapshotType,
} from "./sync/health.server";
import type { SnapshotType } from "./sync/log.server";

export interface SnapshotHealthRow {
  snapshot_type: HealthSnapshotType;
  health_status: "Healthy" | "Warning" | "Error";
  last_successful_sync: string | null;
  last_attempt: string | null;
  records_total: number;
  records_inserted: number;
  records_updated: number;
  records_failed: number;
  stale_records: number;
  calculation_errors: number;
  warning_message: string | null;
  error_message: string | null;
  is_stale: boolean;
  threshold_hours: number;
}

export async function getSnapshotHealth(tenantCode: string): Promise<{
  tenantCode: string;
  thresholds: Awaited<ReturnType<typeof loadFreshnessThresholds>>;
  snapshots: SnapshotHealthRow[];
}> {
  const thresholds = await loadFreshnessThresholds(tenantCode);
  const { data, error } = await supabaseAdmin
    .from("snapshot_health")
    .select("*")
    .eq("tenant_code", tenantCode);
  if (error) throw new Error(`Load snapshot_health failed: ${error.message}`);

  const now = new Date();
  const rows = (data ?? []).map((r): SnapshotHealthRow => {
    const type = r.snapshot_type as HealthSnapshotType;
    const last = r.last_successful_sync ? new Date(r.last_successful_sync) : null;
    return {
      snapshot_type: type,
      health_status: r.health_status as SnapshotHealthRow["health_status"],
      last_successful_sync: r.last_successful_sync,
      last_attempt: r.last_attempt,
      records_total: r.records_total ?? 0,
      records_inserted: r.records_inserted ?? 0,
      records_updated: r.records_updated ?? 0,
      records_failed: r.records_failed ?? 0,
      stale_records: r.stale_records ?? 0,
      calculation_errors: r.calculation_errors ?? 0,
      warning_message: r.warning_message,
      error_message: r.error_message,
      is_stale: isStale(last, thresholds[type], now),
      threshold_hours: thresholds[type],
    };
  });

  return { tenantCode, thresholds, snapshots: rows };
}

export async function getSnapshotDiagnostics(
  tenantCode: string,
  snapshotType: SnapshotType | HealthSnapshotType,
) {
  const publicType: HealthSnapshotType =
    snapshotType === "customer" || snapshotType === "stock" || snapshotType === "contract"
      ? toPublicSnapshotType(snapshotType)
      : (snapshotType as HealthSnapshotType);

  const thresholds = await loadFreshnessThresholds(tenantCode);
  const validation = await runValidation(tenantCode, publicType);

  const { data: health } = await supabaseAdmin
    .from("snapshot_health")
    .select("*")
    .eq("tenant_code", tenantCode)
    .eq("snapshot_type", publicType)
    .maybeSingle();

  const { data: recentLogs } = await supabaseAdmin
    .from("snapshot_sync_logs")
    .select(
      "id, snapshot_type, status, started_at, completed_at, duration_ms, inserted_count, updated_count, skipped_count, failed_count, error_message",
    )
    .eq("tenant_code", tenantCode)
    .eq("snapshot_type", publicType.toLowerCase().replace(/s$/, "")) // "Customers" -> "customer"
    .order("started_at", { ascending: false })
    .limit(10);

  const last = health?.last_successful_sync ? new Date(health.last_successful_sync) : null;

  return {
    tenantCode,
    snapshotType: publicType,
    thresholdHours: thresholds[publicType],
    isStale: isStale(last, thresholds[publicType], new Date()),
    health,
    validation,
    recentLogs: recentLogs ?? [],
  };
}
