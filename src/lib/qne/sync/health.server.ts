// SnapshotHealthService — server-only. Maintains public.snapshot_health after
// every synchronization and computes freshness / validation diagnostics.
//
// This layer NEVER duplicates synchronization logic. It only reads
// snapshot_sync_logs + snapshot tables, then derives health.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SnapshotType, SyncStatus } from "./log.server";
import { loadAllPaginated } from "./pagination.server";

// Public snapshot_type values live in the DB as capitalised words.
export type HealthSnapshotType = "Customers" | "Stock" | "Contract";
export type HealthStatus = "Healthy" | "Warning" | "Error";

const INTERNAL_TO_PUBLIC: Record<SnapshotType, HealthSnapshotType> = {
  customer: "Customers",
  stock: "Stock",
  contract: "Contract",
};

export function toPublicSnapshotType(t: SnapshotType): HealthSnapshotType {
  return INTERNAL_TO_PUBLIC[t];
}

// ---- Freshness thresholds ---------------------------------------------------

export interface FreshnessThresholds {
  Customers: number; // hours
  Stock: number;
  Contract: number;
}

export const DEFAULT_FRESHNESS_HOURS: FreshnessThresholds = {
  Customers: 24,
  Stock: 24,
  Contract: 2,
};

/**
 * Read future per-tenant thresholds from general_settings.extra. Falls back to
 * defaults when the field is absent. Never hardcode thresholds elsewhere.
 */
export async function loadFreshnessThresholds(tenantCode: string): Promise<FreshnessThresholds> {
  const { data } = await supabaseAdmin
    .from("general_settings")
    .select("extra")
    .eq("tenant_code", tenantCode)
    .maybeSingle();
  const extra = (data?.extra ?? {}) as Record<string, unknown>;
  const raw = (extra.snapshot_freshness_hours ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && v > 0 ? v : fallback;
  return {
    Customers: num(raw.Customers, DEFAULT_FRESHNESS_HOURS.Customers),
    Stock: num(raw.Stock, DEFAULT_FRESHNESS_HOURS.Stock),
    Contract: num(raw.Contract, DEFAULT_FRESHNESS_HOURS.Contract),
  };
}

// ---- Validation helpers -----------------------------------------------------

export interface ValidationIssue {
  code: string;
  message: string;
  count: number;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  staleRecords: number;
  calculationErrors: number;
  recordsTotal: number;
}

async function validateCustomers(tenantCode: string): Promise<ValidationReport> {
  type Row = { customer_code: string | null; customer_name: string | null };
  const rows = await loadAllPaginated<Row>(
    "customer_snapshots.validate",
    (from, to) =>
      supabaseAdmin
        .from("customer_snapshots")
        .select("customer_code, customer_name")
        .eq("tenant_code", tenantCode)
        .order("customer_code", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  );
  const issues: ValidationIssue[] = [];
  const missingCode = rows.filter((r) => !r.customer_code || !r.customer_code.trim()).length;
  const missingName = rows.filter((r) => !r.customer_name || !String(r.customer_name).trim()).length;
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = r.customer_code ?? "";
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const duplicates = Array.from(seen.values()).filter((n) => n > 1).length;
  if (missingCode) issues.push({ code: "missing_customer_code", message: "Customers with missing customer_code", count: missingCode });
  if (missingName) issues.push({ code: "missing_customer_name", message: "Customers with missing customer_name", count: missingName });
  if (duplicates) issues.push({ code: "duplicate_customer_code", message: "Duplicate customer_code within tenant", count: duplicates });
  return { issues, staleRecords: 0, calculationErrors: 0, recordsTotal: rows.length };
}

async function validateStock(tenantCode: string): Promise<ValidationReport> {
  type Row = { stock_code: string | null };
  const rows = await loadAllPaginated<Row>(
    "stock_snapshots.validate",
    (from, to) =>
      supabaseAdmin
        .from("stock_snapshots")
        .select("stock_code")
        .eq("tenant_code", tenantCode)
        .order("stock_code", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  );
  const issues: ValidationIssue[] = [];
  const missingCode = rows.filter((r) => !r.stock_code || !r.stock_code.trim()).length;
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = r.stock_code ?? "";
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const duplicates = Array.from(seen.values()).filter((n) => n > 1).length;
  if (missingCode) issues.push({ code: "missing_stock_code", message: "Stock with missing stock_code", count: missingCode });
  if (duplicates) issues.push({ code: "duplicate_stock_code", message: "Duplicate stock_code within tenant", count: duplicates });
  return { issues, staleRecords: 0, calculationErrors: 0, recordsTotal: rows.length };
}

async function validateContracts(tenantCode: string): Promise<ValidationReport> {
  type Row = {
    latest_document_no: string | null;
    latest_document_date: string | null;
    expiry_date: string | null;
    contract_days: number | null;
    remaining_days: number | null;
    contract_status: string | null;
    is_stale: boolean | null;
    calculation_error: string | null;
  };
  const rows = await loadAllPaginated<Row>(
    "customer_contract_snapshots.validate",
    (from, to) =>
      supabaseAdmin
        .from("customer_contract_snapshots")
        .select(
          "latest_document_no, latest_document_date, expiry_date, contract_days, remaining_days, contract_status, is_stale, calculation_error",
        )
        .eq("tenant_code", tenantCode)
        .order("customer_code", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  );
  const issues: ValidationIssue[] = [];
  const staleRecords = rows.filter((r) => r.is_stale === true).length;
  const calculationErrors = rows.filter((r) => r.calculation_error != null).length;
  const missingDoc = rows.filter((r) => r.contract_status !== "Unknown" && !r.latest_document_no).length;
  const missingExpiry = rows.filter((r) => r.contract_status !== "Unknown" && !r.expiry_date).length;
  const missingDays = rows.filter((r) => r.contract_status !== "Unknown" && r.contract_days == null).length;
  const invalidRemaining = rows.filter(
    (r) => r.contract_status !== "Unknown" && (r.remaining_days == null || Number.isNaN(Number(r.remaining_days))),
  ).length;
  const invalidStatus = rows.filter(
    (r) => !["Active", "Due Soon", "Overdue", "Unknown", "Suspended"].includes(r.contract_status ?? ""),
  ).length;
  // Best-effort proxy for "customer with renewal docs but no valid mapping":
  // Unknown-status customers may indicate missing renewal_stock_mapping.
  const unknownCustomers = rows.filter((r) => r.contract_status === "Unknown").length;

  if (staleRecords) issues.push({ code: "stale_contract_calculations", message: "Contract snapshots flagged stale", count: staleRecords });
  if (calculationErrors) issues.push({ code: "calculation_errors", message: "Contract snapshots with calculation errors", count: calculationErrors });
  if (missingDoc) issues.push({ code: "missing_latest_document", message: "Active contracts missing latest document", count: missingDoc });
  if (missingExpiry) issues.push({ code: "missing_expiry_date", message: "Active contracts missing expiry date", count: missingExpiry });
  if (missingDays) issues.push({ code: "missing_contract_days", message: "Active contracts missing contract_days", count: missingDays });
  if (invalidRemaining) issues.push({ code: "invalid_remaining_days", message: "Active contracts with invalid remaining_days", count: invalidRemaining });
  if (invalidStatus) issues.push({ code: "invalid_contract_status", message: "Rows with unrecognised contract_status", count: invalidStatus });
  if (unknownCustomers) issues.push({ code: "possible_missing_mapping", message: "Customers with Unknown status (possible missing renewal_stock_mapping)", count: unknownCustomers });

  return { issues, staleRecords, calculationErrors, recordsTotal: rows.length };
}

export async function runValidation(
  tenantCode: string,
  snapshotType: HealthSnapshotType,
): Promise<ValidationReport> {
  if (snapshotType === "Customers") return validateCustomers(tenantCode);
  if (snapshotType === "Stock") return validateStock(tenantCode);
  return validateContracts(tenantCode);
}

// ---- Freshness --------------------------------------------------------------

export function isStale(lastSuccessfulSync: Date | null, thresholdHours: number, now: Date = new Date()): boolean {
  if (!lastSuccessfulSync) return true;
  const ageHours = (now.getTime() - lastSuccessfulSync.getTime()) / 3_600_000;
  return ageHours > thresholdHours;
}

// ---- Health derivation & persistence ---------------------------------------

export interface HealthUpdateInput {
  tenantCode: string;
  snapshotType: SnapshotType;
  syncStatus: SyncStatus;
  syncErrorMessage?: string;
  counters: { inserted: number; updated: number; skipped: number; failed: number };
  lastAttempt: Date;
  succeeded: boolean;
  /** When set, the sync could not produce a valid outcome (e.g. missing
   * mapping). Forces a Warning even when validation issues are zero. */
  notReadyReason?: string;
}

/**
 * Called from the sync log wrapper after every synchronization run.
 * Never duplicates sync logic — only reads state and writes snapshot_health.
 */
export async function updateHealthFromSync(input: HealthUpdateInput): Promise<void> {
  const publicType = toPublicSnapshotType(input.snapshotType);
  const thresholds = await loadFreshnessThresholds(input.tenantCode);
  const validation = await runValidation(input.tenantCode, publicType);

  // Load prior row to preserve last_successful_sync when this run failed.
  const { data: prior } = await supabaseAdmin
    .from("snapshot_health")
    .select("last_successful_sync")
    .eq("tenant_code", input.tenantCode)
    .eq("snapshot_type", publicType)
    .maybeSingle();

  const lastSuccessful = input.succeeded
    ? input.lastAttempt
    : prior?.last_successful_sync
    ? new Date(prior.last_successful_sync)
    : null;

  const stale = isStale(lastSuccessful, thresholds[publicType], input.lastAttempt);

  let health: HealthStatus;
  let warning: string | null = null;
  let error: string | null = null;

  if (input.syncStatus === "failed") {
    health = "Error";
    error = input.syncErrorMessage ?? "Synchronization failed";
  } else if (input.notReadyReason) {
    // Sync did not fail but produced no valid outcome — must never be Healthy.
    health = "Warning";
    warning = input.notReadyReason;
  } else if (
    input.counters.failed > 0 ||
    input.syncStatus === "partial" ||
    validation.staleRecords > 0 ||
    validation.calculationErrors > 0 ||
    validation.issues.length > 0 ||
    stale
  ) {
    health = "Warning";
    const parts: string[] = [];
    if (input.syncStatus === "partial") parts.push("partial synchronization");
    if (input.counters.failed > 0) parts.push(`${input.counters.failed} record write failure(s)`);
    if (validation.staleRecords > 0) parts.push(`${validation.staleRecords} stale record(s)`);
    if (validation.calculationErrors > 0) parts.push(`${validation.calculationErrors} calculation error(s)`);
    if (stale) parts.push(`snapshot older than ${thresholds[publicType]}h threshold`);
    if (validation.issues.length > 0) parts.push(`${validation.issues.length} validation issue type(s)`);
    warning = parts.join("; ") || "Warning conditions detected";
  } else {
    health = "Healthy";
  }

  const row = {
    tenant_code: input.tenantCode,
    snapshot_type: publicType,
    health_status: health,
    last_successful_sync: lastSuccessful ? lastSuccessful.toISOString() : null,
    last_attempt: input.lastAttempt.toISOString(),
    records_total: validation.recordsTotal,
    records_inserted: input.counters.inserted,
    records_updated: input.counters.updated,
    records_failed: input.counters.failed,
    stale_records: validation.staleRecords,
    calculation_errors: validation.calculationErrors,
    warning_message: warning,
    error_message: error,
  };

  const { error: upsertErr } = await supabaseAdmin
    .from("snapshot_health")
    .upsert(row, { onConflict: "tenant_code,snapshot_type" });
  if (upsertErr) {
    // Do not throw — health tracking must never break synchronization.
    console.error("[snapshot_health] upsert failed", upsertErr.message);
  }
}
