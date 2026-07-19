// Phase 1.0.1 — Subscription sync driven by official N3 transaction
// DETAIL endpoints, not header lists.
//
// Flow:
//   1. List Sales Invoice headers  → GET /api/SalesInvoices/{key}   → itemDetails[]
//   2. List Delivery Order headers → GET /api/DeliveryOrders/{key}  → itemDetails[]
//   3. Upsert ALL detail lines (mapped or not) into tenant-scoped
//      *_line_snapshots tables — audit + future recalculation source.
//   4. For every line whose stock_code matches an active RENEWAL mapping
//      (case-insensitive, trimmed, exact equality), insert/update a
//      `subscription_renewal_events` row (unique per source doc + line).
//   5. Rebuild `customer_subscription_snapshots` — one row per
//      (tenant_code, customer_code, subscription_category). Latest valid
//      (non-voided) renewal event wins. Invoice and DO are independent
//      sources.
//
// Ad Hoc mappings are stored for future job history but NEVER produce
// expiry rows. Unmapped stock codes are stored in line snapshots but
// ignored by subscription calculation.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { N3_ENDPOINTS } from "@/lib/qne/endpoints";
import {
  isN3NotFound,
  n3Get,
  n3GetList,
  N3HttpError,
  type N3TenantContext,
} from "./n3.server";
import { runWithSyncLog, SyncNotReadyError, type SyncResult } from "./log.server";
import { loadAllPaginated } from "./pagination.server";

/**
 * Server-side feature flag for Phase 1.1.6b reconciliation. Default: ON.
 * Set RECONCILIATION_ENABLED=false to disable both document-deletion and
 * line-removal reconciliation without touching Phase 1.1.5 cancellation.
 */
function reconciliationEnabled(): boolean {
  const v = (process.env.RECONCILIATION_ENABLED ?? "").trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "off";
}

export interface ReconciliationCounters {
  enabled: boolean;
  checked: number;
  confirmedDeleted: number;
  confirmedLineRemoved: number;
  transient: number;
  unknownEnvelope: number;
  reconciliationFailed: number;
  skippedUnsafe: boolean;
  skippedReason: string | null;
  inventoryTotal: number | null;
  priorInventoryTotal: number | null;
  uniqueHeadersSeen: number;
  existingActiveLineDocuments: number;
  pagesFetched: number;
  candidateDocuments: number;
  candidateCapHit: boolean;
}


// ---------------------------------------------------------------------------
// Phase 1.1.6b — Pure safety evaluator. Kept side-effect free so unit tests
// can pin down the empty-inventory and inventory-collapse guards without
// mocking supabase or the N3 client.

export interface ScanSafetyInput {
  scanHealthy: boolean;
  scanReason: string | null;
  inventoryTotal: number | null;
  uniqueHeadersSeen: number;
  existingActiveLineDocuments: number;
  priorInventoryTotal: number | null;
  collapseThreshold?: number; // fraction of prior, default 0.5
  minPriorForCollapseCheck?: number; // default 10
}

export interface ScanSafetyResult {
  skippedUnsafe: boolean;
  skippedReason: string | null;
}

export function evaluateScanSafety(input: ScanSafetyInput): ScanSafetyResult {
  if (!input.scanHealthy) {
    return {
      skippedUnsafe: true,
      skippedReason: input.scanReason ?? "scan unhealthy",
    };
  }
  const threshold = input.collapseThreshold ?? 0.5;
  const minPrior = input.minPriorForCollapseCheck ?? 10;
  // Empty inventory guard — never delete everything just because the API
  // returned no rows this run.
  if (input.uniqueHeadersSeen === 0 && input.existingActiveLineDocuments > 0) {
    return {
      skippedUnsafe: true,
      skippedReason: `empty inventory (0 headers) while ${input.existingActiveLineDocuments} active documents exist locally`,
    };
  }
  if (
    input.inventoryTotal === 0 &&
    input.existingActiveLineDocuments > 0
  ) {
    return {
      skippedUnsafe: true,
      skippedReason: `N3 reported total=0 while ${input.existingActiveLineDocuments} active documents exist locally`,
    };
  }
  // Suspicious collapse — refuse to reconcile if the reported inventory
  // is under half of the previous healthy run (with a floor to avoid
  // whipsaw on tiny tenants).
  if (
    input.priorInventoryTotal != null &&
    input.priorInventoryTotal >= minPrior &&
    input.inventoryTotal != null &&
    input.inventoryTotal < input.priorInventoryTotal * threshold
  ) {
    return {
      skippedUnsafe: true,
      skippedReason: `inventory collapse: current=${input.inventoryTotal} < ${Math.round(
        threshold * 100,
      )}% of prior=${input.priorInventoryTotal}`,
    };
  }
  return { skippedUnsafe: false, skippedReason: null };
}


// ---------------------------------------------------------------------------
// Phase 1.1.6b — Ordered reconciliation writers. Events flip to
// is_source_void=true BEFORE the line snapshot flips to
// is_deleted_in_source=true, so a crash between the two leaves the
// rebuild treating the entitlement as void (safe) rather than active with
// a deleted source. Every write carries the run-boundary timestamp guard
// so a row refreshed in-run is never mis-invalidated by a stale scan.

export interface ReconciliationWriteClient {
  from: (table: string) => {
    update: (payload: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => {
        eq: (col: string, val: unknown) => {
          eq: (col: string, val: unknown) => {
            eq?: (col: string, val: unknown) => unknown;
            lt?: (col: string, val: unknown) => unknown;
            // events chain resolves to a promise-like via .eq(source_document_id)
            then?: unknown;
          };
        };
      };
    };
  };
}

export async function invalidateDeletedDocument(args: {
  client: { from: (table: string) => unknown };
  tenantCode: string;
  sourceType: SourceType;
  docId: string;
  runStartedAt: Date;
  lineTable: "sales_invoice_line_snapshots" | "delivery_order_line_snapshots";
}): Promise<void> {
  const runIso = args.runStartedAt.toISOString();
  const nowIso = new Date().toISOString();
  // 1. Events first — must succeed. Rebuild will treat the entitlement as
  //    void even if step 2 crashes before it lands.
  const evtRes = await (args.client.from("subscription_renewal_events") as unknown as {
    update: (p: Record<string, unknown>) => {
      eq: (c: string, v: unknown) => {
        eq: (c: string, v: unknown) => {
          eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
  })
    .update({ is_source_void: true })
    .eq("tenant_code", args.tenantCode)
    .eq("source_type", args.sourceType)
    .eq("source_document_id", args.docId);
  if (evtRes.error) {
    throw new Error(
      `[reconciliation] events invalidation failed docId=${args.docId}: ${evtRes.error.message}`,
    );
  }
  // 2. Line snapshots — with timestamp guard so a row refreshed in the
  //    same run cannot be mistakenly marked deleted.
  const lineRes = await (args.client.from(args.lineTable) as unknown as {
    update: (p: Record<string, unknown>) => {
      eq: (c: string, v: unknown) => {
        eq: (c: string, v: unknown) => {
          eq: (c: string, v: unknown) => {
            lt: (c: string, v: unknown) => Promise<{ error: { message: string } | null }>;
          };
        };
      };
    };
  })
    .update({
      is_deleted_in_source: true,
      document_status: "Deleted",
      last_synced_at: nowIso,
    })
    .eq("tenant_code", args.tenantCode)
    .eq("n3_document_id", args.docId)
    .eq("is_deleted_in_source", false)
    .lt("last_seen_at", runIso);
  if (lineRes.error) {
    throw new Error(
      `[reconciliation] line invalidation failed docId=${args.docId}: ${lineRes.error.message}`,
    );
  }
}

export async function invalidateRemovedLine(args: {
  client: { from: (table: string) => unknown };
  tenantCode: string;
  sourceType: SourceType;
  docId: string;
  lineId: string;
  runStartedAt: Date;
  lineTable: "sales_invoice_line_snapshots" | "delivery_order_line_snapshots";
}): Promise<void> {
  const runIso = args.runStartedAt.toISOString();
  const nowIso = new Date().toISOString();
  const evtRes = await (args.client.from("subscription_renewal_events") as unknown as {
    update: (p: Record<string, unknown>) => {
      eq: (c: string, v: unknown) => {
        eq: (c: string, v: unknown) => {
          eq: (c: string, v: unknown) => {
            eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }>;
          };
        };
      };
    };
  })
    .update({ is_source_void: true })
    .eq("tenant_code", args.tenantCode)
    .eq("source_type", args.sourceType)
    .eq("source_document_id", args.docId)
    .eq("source_line_id", args.lineId);
  if (evtRes.error) {
    throw new Error(
      `[reconciliation] events invalidation failed docId=${args.docId} lineId=${args.lineId}: ${evtRes.error.message}`,
    );
  }
  const lineRes = await (args.client.from(args.lineTable) as unknown as {
    update: (p: Record<string, unknown>) => {
      eq: (c: string, v: unknown) => {
        eq: (c: string, v: unknown) => {
          eq: (c: string, v: unknown) => {
            eq: (c: string, v: unknown) => {
              lt: (c: string, v: unknown) => Promise<{ error: { message: string } | null }>;
            };
          };
        };
      };
    };
  })
    .update({
      is_deleted_in_source: true,
      document_status: "Deleted",
      last_synced_at: nowIso,
    })
    .eq("tenant_code", args.tenantCode)
    .eq("n3_document_id", args.docId)
    .eq("n3_line_id", args.lineId)
    .eq("is_deleted_in_source", false)
    .lt("last_seen_at", runIso);
  if (lineRes.error) {
    throw new Error(
      `[reconciliation] line invalidation failed docId=${args.docId} lineId=${args.lineId}: ${lineRes.error.message}`,
    );
  }
}



// ---------------------------------------------------------------------------
// N3 shapes (minimal, only the fields we depend on).

interface N3LookupCode {
  code?: string;
  name?: string;
  description?: string;
}
interface N3DocLine {
  id?: string;
  pos?: number;
  numbering?: number;
  stockId?: number;
  description?: string;
  qty?: number;
  stock?: N3LookupCode | null;
  uom?: N3LookupCode | null;
  // Some responses may inline the stock code directly.
  stockCode?: string;
  [k: string]: unknown;
}
interface N3DocHeader {
  id?: string;
  docCode?: string;
  documentNo?: string;
  docDate?: string;
  date?: string;
  customerCode?: string;
  customerName?: string;
  isCancelled?: boolean;
  updatedAt?: number;
  [k: string]: unknown;
}
interface N3DocFull extends N3DocHeader {
  itemDetails?: N3DocLine[];
  details?: N3DocLine[];
}

// ---------------------------------------------------------------------------
// Domain types.

type CycleUnit = "day" | "month" | "year";
type SourceType = "invoice" | "delivery_order";
type SubscriptionStatus = "Active" | "Due Soon" | "Overdue" | "Unknown";

interface RenewalMapping {
  stock_code: string;
  n3_stock_id: string | null;
  subscription_category: string;
  renewal_cycle_value: number;
  renewal_cycle_unit: CycleUnit;
}

// ---------------------------------------------------------------------------
// Helpers.

function isCycleUnit(v: unknown): v is CycleUnit {
  return v === "day" || v === "month" || v === "year";
}

function parseDate(v: string | undefined | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Inclusive expiry — day: start + value - 1 day; month/year: calendar
 * arithmetic, then minus 1 day. Never fixed-days per month/year.
 */
export function computeInclusiveExpiry(start: Date, value: number, unit: CycleUnit): Date {
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  if (unit === "day") {
    d.setUTCDate(d.getUTCDate() + value - 1);
    return d;
  }
  if (unit === "month") d.setUTCMonth(d.getUTCMonth() + value);
  else d.setUTCFullYear(d.getUTCFullYear() + value);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/**
 * Phase 1.1.6c — Resolve the effective renewal quantity from a raw N3 line
 * `qty`. Returns an integer ≥ 1 when the line should produce entitlement,
 * or a structured skip reason. Never rounds fractions.
 *
 *   null / undefined       → { effective: 1 }
 *   integer ≥ 1            → { effective: qty }
 *   0                      → skip "zero_quantity"
 *   negative               → skip "negative_quantity" (package exchange
 *                            is Phase 1.1.7 — existing entitlement stays)
 *   fraction (e.g. 1.5)    → skip "fractional_quantity"
 *   NaN / non-finite       → skip "invalid_quantity"
 */
export type QuantityResolution =
  | { effective: number; skipReason?: undefined }
  | { effective: null; skipReason: "zero_quantity" | "negative_quantity" | "fractional_quantity" | "invalid_quantity" };

export function resolveEffectiveQuantity(qty: number | null | undefined): QuantityResolution {
  if (qty === null || qty === undefined) return { effective: 1 };
  if (typeof qty !== "number" || !Number.isFinite(qty)) {
    return { effective: null, skipReason: "invalid_quantity" };
  }
  if (qty === 0) return { effective: null, skipReason: "zero_quantity" };
  if (qty < 0) return { effective: null, skipReason: "negative_quantity" };
  if (!Number.isInteger(qty)) return { effective: null, skipReason: "fractional_quantity" };
  return { effective: qty };
}

function computeStatus(daysLeft: number, dueSoonDays: number): SubscriptionStatus {
  if (daysLeft < 0) return "Overdue";
  if (daysLeft <= dueSoonDays) return "Due Soon";
  return "Active";
}

function normalizeStockKey(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

function pickStockCode(line: N3DocLine): string | null {
  const fromStock = line.stock?.code?.trim();
  if (fromStock) return fromStock;
  const inline = (line.stockCode ?? "").trim();
  return inline || null;
}

function pickLineId(line: N3DocLine, index: number): string {
  if (line.id) return String(line.id);
  const pos = line.pos ?? line.numbering;
  if (pos != null) return `pos:${pos}`;
  return `idx:${index}`;
}

function pickParentLineId(line: N3DocLine): string | null {
  const raw =
    (line as Record<string, unknown>).parentId ??
    (line as Record<string, unknown>).parentLineId ??
    (line as Record<string, unknown>).parent_id;
  if (raw == null) return null;
  const s = String(raw).trim();
  return s ? s : null;
}

type LineType =
  | "stock"
  | "description"
  | "serial_or_reference"
  | "child_detail"
  | "unknown";

/**
 * Classify an N3 detail line strictly from official DTO signals. Never
 * derives a Stock Code from description text.
 */
function classifyLine(line: N3DocLine, stockCode: string | null): LineType {
  if (stockCode) return "stock";
  const parent = pickParentLineId(line);
  if (parent) return "child_detail";
  const desc = (line.description ?? "").trim();
  const looksLikeSerial =
    !!(line as Record<string, unknown>).serialNo ||
    !!(line as Record<string, unknown>).referenceNo;
  if (looksLikeSerial) return "serial_or_reference";
  if (desc) return "description";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Main entry.

export async function syncSubscriptionSnapshots(ctx: N3TenantContext): Promise<SyncResult> {
  const { tenantCode } = ctx;

  return runWithSyncLog({ tenantCode, snapshotType: "contract" }, async (counters, heartbeat) => {
    // Phase 1.1.6b — capture the run boundary. All reconciliation timestamp
    // guards MUST compare against this exact moment so a late-arriving row
    // (last_seen_at written moments after the check began) is never
    // mis-classified as missing.
    const runStartedAt = new Date();
    counters.details.reconciliationRunStartedAt = runStartedAt.toISOString();
    const reconEnabled = reconciliationEnabled();
    counters.details.reconciliationEnabled = reconEnabled;

    await heartbeat("Loading renewal mappings");

    // ---- 1. Load mappings ---------------------------------------------------
    type MappingRow = {
      stock_code: string;
      n3_stock_id: string | null;
      service_type: string | null;
      subscription_category: string | null;
      renewal_cycle_value: number | null;
      renewal_cycle_unit: string | null;
      contract_days: number | null;
      is_active: boolean | null;
    };
    const mappingRows = await loadAllPaginated<MappingRow>(
      "renewal_stock_mappings.active",
      (from, to) =>
        supabaseAdmin
          .from("renewal_stock_mappings")
          .select(
            "stock_code, n3_stock_id, service_type, subscription_category, renewal_cycle_value, renewal_cycle_unit, contract_days, is_active",
          )
          .eq("tenant_code", tenantCode)
          .eq("is_active", true)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: MappingRow[] | null; error: { message: string } | null }>,
    );

    // Two lookup maps for renewal mappings — prefer N3 Stock ID, fall back to
    // normalized Stock Code. Same value is stored in both so mapping match
    // survives Stock Code rename.
    const renewalMappingsByStockId = new Map<string, RenewalMapping>();
    const renewalMappingsByCode = new Map<string, RenewalMapping>();
    const adHocStockCodes = new Set<string>();
    const adHocStockIds = new Set<string>();
    for (const m of mappingRows) {
      const key = normalizeStockKey(m.stock_code);
      const n3Id = (m.n3_stock_id ?? "").toString().trim() || null;
      if (!key && !n3Id) continue;
      if (m.service_type === "Ad Hoc") {
        if (key) adHocStockCodes.add(key);
        if (n3Id) adHocStockIds.add(n3Id);
        continue;
      }
      if (m.service_type !== "Renewal") continue;
      const category = (m.subscription_category ?? "").trim() || "Maintenance";
      let value = typeof m.renewal_cycle_value === "number" ? m.renewal_cycle_value : null;
      let unit: CycleUnit = isCycleUnit(m.renewal_cycle_unit) ? m.renewal_cycle_unit : "day";
      if (value == null && typeof m.contract_days === "number") {
        value = m.contract_days;
        unit = "day";
      }
      if (!value || value <= 0) continue;
      const mapping: RenewalMapping = {
        stock_code: m.stock_code,
        n3_stock_id: n3Id,
        subscription_category: category,
        renewal_cycle_value: value,
        renewal_cycle_unit: unit,
      };
      if (key) renewalMappingsByCode.set(key, mapping);
      if (n3Id) renewalMappingsByStockId.set(n3Id, mapping);
    }

    const renewalMappings = renewalMappingsByCode; // legacy alias for downstream code paths


    counters.details.activeRenewalMappings = renewalMappings.size;
    counters.details.activeAdHocMappings = adHocStockCodes.size;

    if (renewalMappings.size === 0) {
      throw new SyncNotReadyError(
        "Subscription calculation not ready — configure at least one Renewal Stock Mapping.",
      );
    }

    // ---- 2. Tenant settings + known customers ------------------------------
    const { data: settings } = await supabaseAdmin
      .from("general_settings")
      .select("due_soon_days")
      .eq("tenant_code", tenantCode)
      .maybeSingle();
    const dueSoonDays = settings?.due_soon_days ?? 30;

    await ensureDefaultCategories(tenantCode);

    // Category id lookup (tenant-scoped, case-insensitive).
    type CatRow = { id: string; name: string };
    const catRows = await loadAllPaginated<CatRow>(
      "subscription_categories.byTenant",
      (from, to) =>
        supabaseAdmin
          .from("subscription_categories")
          .select("id, name")
          .eq("tenant_code", tenantCode)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: CatRow[] | null; error: { message: string } | null }>,
    );
    const categoryIdByName = new Map<string, string>();
    for (const c of catRows) categoryIdByName.set(c.name.toLowerCase(), c.id);

    type CustRow = { customer_code: string; customer_name: string | null; n3_customer_id: string | null };
    const custRows = await loadAllPaginated<CustRow>(
      "customer_snapshots.forSubscription",
      (from, to) =>
        supabaseAdmin
          .from("customer_snapshots")
          .select("customer_code, customer_name, n3_customer_id")
          .eq("tenant_code", tenantCode)
          .order("customer_code", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: CustRow[] | null; error: { message: string } | null }>,
    );
    const customerNameByCode = new Map<string, string | null>();
    const customerN3IdByCode = new Map<string, string | null>();
    for (const c of custRows) {
      customerNameByCode.set(c.customer_code, c.customer_name ?? null);
      customerN3IdByCode.set(c.customer_code, c.n3_customer_id ?? null);
    }
    if (customerNameByCode.size === 0) {
      throw new SyncNotReadyError(
        "Subscription calculation not ready — no Customer Snapshots. Run Customer Sync first.",
      );
    }

    // ---- 3. Sync detail lines for Sales Invoices and Delivery Orders -------
    await heartbeat("Fetching Sales Invoice details");
    const siMetrics = await syncSourceDetails({
      ctx,
      tenantCode,
      sourceType: "invoice",
      listEndpoint: N3_ENDPOINTS["salesInvoices.list"],
      getEndpoint: N3_ENDPOINTS["salesInvoices.get"],
      lineTable: "sales_invoice_line_snapshots",
      renewalMappings,
      renewalMappingsByStockId,
      adHocStockCodes,
      adHocStockIds,
      categoryIdByName,
      customerNameByCode,
      customerN3IdByCode,
      heartbeat,
      runStartedAt,
      reconciliationEnabled: reconEnabled,
    });
    await heartbeat("Fetching Delivery Order details");
    const doMetrics = await syncSourceDetails({
      ctx,
      tenantCode,
      sourceType: "delivery_order",
      listEndpoint: N3_ENDPOINTS["deliveryOrders.list"],
      getEndpoint: N3_ENDPOINTS["deliveryOrders.get"],
      lineTable: "delivery_order_line_snapshots",
      renewalMappings,
      renewalMappingsByStockId,
      adHocStockCodes,
      adHocStockIds,
      categoryIdByName,
      customerNameByCode,
      customerN3IdByCode,
      heartbeat,
      runStartedAt,
      reconciliationEnabled: reconEnabled,
    });


    // Merge per-source metrics into the audit counters.
    counters.details.salesInvoice = siMetrics;
    counters.details.deliveryOrder = doMetrics;
    counters.details.reconciliation = {
      salesInvoice: siMetrics.reconciliation,
      deliveryOrder: doMetrics.reconciliation,
      totals: {
        checked: siMetrics.reconciliation.checked + doMetrics.reconciliation.checked,
        confirmedDeleted:
          siMetrics.reconciliation.confirmedDeleted + doMetrics.reconciliation.confirmedDeleted,
        confirmedLineRemoved:
          siMetrics.reconciliation.confirmedLineRemoved +
          doMetrics.reconciliation.confirmedLineRemoved,
        transient: siMetrics.reconciliation.transient + doMetrics.reconciliation.transient,
        unknownEnvelope:
          siMetrics.reconciliation.unknownEnvelope + doMetrics.reconciliation.unknownEnvelope,
      },
    };

    counters.details.mappedRenewalLines = siMetrics.mappedRenewalLines + doMetrics.mappedRenewalLines;
    counters.details.mappedAdHocLines = siMetrics.mappedAdHocLines + doMetrics.mappedAdHocLines;
    counters.details.unmappedLinesIgnored =
      siMetrics.unmappedLinesIgnored + doMetrics.unmappedLinesIgnored;
    counters.details.renewalEventsInserted =
      siMetrics.renewalEventsInserted + doMetrics.renewalEventsInserted;
    counters.details.renewalEventsSkipped =
      siMetrics.renewalEventsSkipped + doMetrics.renewalEventsSkipped;
    counters.details.voidedDocumentsExcluded =
      siMetrics.voidedDocuments + doMetrics.voidedDocuments;
    counters.details.failedDetailRequests =
      siMetrics.detailRequestsFailed + doMetrics.detailRequestsFailed;
    counters.failed = siMetrics.detailRequestsFailed + doMetrics.detailRequestsFailed;

    const totalMapped = siMetrics.mappedRenewalLines + doMetrics.mappedRenewalLines;
    const totalUnmapped = siMetrics.unmappedLinesIgnored + doMetrics.unmappedLinesIgnored;
    const totalHeaders = siMetrics.headersScanned + doMetrics.headersScanned;
    const totalLines = siMetrics.detailLinesStored + doMetrics.detailLinesStored;

    // ---- 4. Rebuild current subscription snapshots -------------------------
    await heartbeat("Rebuilding Current Subscriptions");
    const rebuild = await rebuildCurrentSnapshots(tenantCode, dueSoonDays, customerNameByCode);
    await heartbeat("Finalizing diagnostics");
    counters.inserted = rebuild.inserted;
    counters.updated = rebuild.updated;
    counters.skipped = rebuild.skipped;
    counters.details.subscriptionSnapshotsInserted = rebuild.inserted;
    counters.details.subscriptionSnapshotsUpdated = rebuild.updated;
    counters.details.subscriptionSnapshotsUnchanged = rebuild.skipped;
    counters.details.subscriptionSnapshotsBySource = rebuild.bySource;

    // Zero-result diagnostics (used by health warning).
    if (rebuild.inserted + rebuild.updated + rebuild.skipped === 0) {
      let reason: string;
      if (totalHeaders === 0) reason = "no transaction headers returned by N3";
      else if (totalLines === 0) reason = "no detail lines returned for any document";
      else if (totalMapped === 0 && totalUnmapped > 0)
        reason = "no stock codes on N3 lines matched an active Renewal mapping";
      else reason = "no qualifying renewal events could be built";
      counters.details.zeroResultReason = reason;
      throw new SyncNotReadyError(`No subscriptions produced — ${reason}.`);
    }
  });
}

// ---------------------------------------------------------------------------
// Per-source (invoice / DO) detail sync.

interface SourceMetrics {
  headersScanned: number;
  detailRequestsAttempted: number;
  detailRequestsSucceeded: number;
  detailRequestsFailed: number;
  detailLinesStored: number;
  mappedRenewalLines: number;
  mappedAdHocLines: number;
  unmappedStockLines: number;
  unmappedLinesIgnored: number;
  voidedDocuments: number;
  voidedSourceLines: number;
  renewalEventsInserted: number;
  renewalEventsSkipped: number;
  // Phase 1.0.4 — split skip reasons so Delivery Order path is auditable.
  renewalEventsSkippedVoided: number;
  renewalEventsSkippedMissingCustomer: number;
  renewalEventsSkippedInvalidDate: number;
  // Phase 1.1.6c — quantity-driven skip counters.
  renewalEventsSkippedZeroQty: number;
  renewalEventsSkippedNegativeQty: number;
  renewalEventsSkippedFractionalQty: number;
  renewalEventsSkippedInvalidQty: number;
  lineTypeCounts: {
    stock: number;
    description: number;
    serial_or_reference: number;
    child_detail: number;
    unknown: number;
  };
  linesWithoutStockIgnored: number;
}

async function syncSourceDetails(args: {
  ctx: N3TenantContext;
  tenantCode: string;
  sourceType: SourceType;
  listEndpoint: (typeof N3_ENDPOINTS)[keyof typeof N3_ENDPOINTS];
  getEndpoint: (typeof N3_ENDPOINTS)[keyof typeof N3_ENDPOINTS];
  lineTable: "sales_invoice_line_snapshots" | "delivery_order_line_snapshots";
  renewalMappings: Map<string, RenewalMapping>;
  renewalMappingsByStockId: Map<string, RenewalMapping>;
  adHocStockCodes: Set<string>;
  adHocStockIds: Set<string>;
  categoryIdByName: Map<string, string>;
  customerNameByCode: Map<string, string | null>;
  customerN3IdByCode: Map<string, string | null>;
  heartbeat?: (stage: string, progress?: Record<string, unknown>) => Promise<void>;
  runStartedAt: Date;
  reconciliationEnabled: boolean;
}): Promise<SourceMetrics & { reconciliation: ReconciliationCounters }> {

  const {
    ctx,
    tenantCode,
    sourceType,
    listEndpoint,
    getEndpoint,
    lineTable,
    renewalMappings,
    renewalMappingsByStockId,
    adHocStockCodes,
    adHocStockIds,
    categoryIdByName,
    customerNameByCode,
    customerN3IdByCode,
    heartbeat,
  } = args;


  const metrics: SourceMetrics = {
    headersScanned: 0,
    detailRequestsAttempted: 0,
    detailRequestsSucceeded: 0,
    detailRequestsFailed: 0,
    detailLinesStored: 0,
    mappedRenewalLines: 0,
    mappedAdHocLines: 0,
    unmappedStockLines: 0,
    unmappedLinesIgnored: 0,
    voidedDocuments: 0,
    voidedSourceLines: 0,
    renewalEventsInserted: 0,
    renewalEventsSkipped: 0,
    renewalEventsSkippedVoided: 0,
    renewalEventsSkippedMissingCustomer: 0,
    renewalEventsSkippedInvalidDate: 0,
    renewalEventsSkippedZeroQty: 0,
    renewalEventsSkippedNegativeQty: 0,
    renewalEventsSkippedFractionalQty: 0,
    renewalEventsSkippedInvalidQty: 0,
    lineTypeCounts: {
      stock: 0,
      description: 0,
      serial_or_reference: 0,
      child_detail: 0,
      unknown: 0,
    },
    linesWithoutStockIgnored: 0,
  };


  // Phase 1.1.6b — Gated Full-Inventory Scan. We must know whether the
  // header list came back complete before we're allowed to treat any
  // stored document as "missing". Any transport error, non-0000 envelope
  // during paging, or short/oversized page invalidates the scan.
  const headers: N3DocHeader[] = [];
  const seenDocumentIds = new Set<string>();
  let scanHealthy = true;
  let scanReason: string | null = null;
  let totalReported: number | null = null;
  let pagesFetched = 0;
  const PAGE_SIZE = 200;
  try {
    let skip = 0;
    for (let page = 0; page < 500; page++) {
      const { rows, total } = await n3GetList<N3DocHeader>(
        args.ctx.token,
        listEndpoint.target,
        listEndpoint.path,
        { $top: PAGE_SIZE, $skip: skip },
      );
      pagesFetched += 1;
      // Phase 1.1.6b correction #4: preserve the actual reported total,
      // including a legitimate zero. Only a *missing* total stays null.
      if (typeof total === "number") totalReported = total;
      for (const h of rows) {
        headers.push(h);
        const id = (h.id ?? "").toString().trim();
        if (id) seenDocumentIds.add(id);
      }
      if (rows.length < PAGE_SIZE) break;
      if (totalReported != null && totalReported > 0 && skip + rows.length >= totalReported)
        break;
      skip += rows.length;
    }
    // Only the > 0 case has a mismatch invariant to check. total=0 is
    // handled by the empty-inventory guard in evaluateScanSafety.
    if (totalReported != null && totalReported > 0 && seenDocumentIds.size !== totalReported) {
      scanHealthy = false;
      scanReason = `unique headers ${seenDocumentIds.size} != API count ${totalReported}`;
    }
  } catch (err) {
    scanHealthy = false;
    scanReason = `list transport error: ${err instanceof Error ? err.message : String(err)}`;
    // Do NOT throw. We still upsert whatever headers we did fetch; we
    // simply cannot safely run reconciliation on an incomplete scan.
    console.warn(
      `[subscription-sync] list scan unhealthy source=${sourceType} reason=${scanReason}`,
    );
  }
  metrics.headersScanned = headers.length;
  await heartbeat?.(`Fetching ${sourceType} details 0/${headers.length}`, {
    source: sourceType,
    stage: "details",
    total: headers.length,
    processed: 0,
  });

  // Track seen lines per successfully-fetched detail so line-removal
  // reconciliation can compare stored line snapshots against the current
  // document body without a second detail fetch.
  const seenLineIdsByDoc = new Map<string, Set<string>>();
  const detailFetchedDocs = new Set<string>();

  let processed = 0;
  for (const header of headers) {
    const docId = (header.id ?? "").toString().trim();
    if (!docId) continue;
    processed += 1;

    if (processed % 25 === 0 || processed === headers.length) {
      await heartbeat?.(
        `Fetching ${sourceType} details ${processed}/${headers.length}`,
        { source: sourceType, stage: "details", total: headers.length, processed },
      );
    }

    const docNo = (header.docCode ?? header.documentNo ?? "").toString() || null;
    metrics.detailRequestsAttempted += 1;
    let full: N3DocFull;
    try {
      full = await n3Get<N3DocFull>(
        ctx.token,
        getEndpoint.target,
        getEndpoint.path.replace("{key}", encodeURIComponent(docId)),
      );
      metrics.detailRequestsSucceeded += 1;
    } catch (err) {
      metrics.detailRequestsFailed += 1;
      const status = err instanceof Error ? err.message.match(/\((\d{3})\)/)?.[1] : undefined;
      console.error(
        `[subscription-sync] detail fetch failed source=${sourceType} docId=${docId} docNo=${docNo ?? "?"} status=${status ?? "?"}`,
      );
      continue;
    }

    const lines = Array.isArray(full.itemDetails)
      ? full.itemDetails
      : Array.isArray(full.details)
        ? full.details
        : [];
    const docDate = parseDate(full.docDate ?? header.docDate ?? null);
    const isVoid = Boolean(full.isCancelled ?? header.isCancelled);
    if (isVoid) metrics.voidedDocuments += 1;
    const customerCode = (full.customerCode ?? header.customerCode ?? "").trim();
    const customerName =
      (full.customerName as string | undefined) ??
      (header.customerName as string | undefined) ??
      (customerCode ? customerNameByCode.get(customerCode) ?? null : null);
    // Prefer immutable N3 customer id from the document payload, then from
    // the local snapshot.
    const rawDocCustomerId =
      (full as Record<string, unknown>).customerId ??
      (header as Record<string, unknown>).customerId ??
      null;
    const customerN3Id =
      (rawDocCustomerId != null ? String(rawDocCustomerId).trim() : "") ||
      (customerCode ? customerN3IdByCode.get(customerCode) ?? null : null) ||
      null;

    // ---- Upsert every line (mapped or not) ------------------------------
    const upsertRows: Array<Record<string, unknown>> = [];
    const renewalEvents: Array<Record<string, unknown>> = [];

    lines.forEach((line, index) => {
      const stockCode = pickStockCode(line);
      const lineId = pickLineId(line, index);
      const stockKey = normalizeStockKey(stockCode);
      const parentLineId = pickParentLineId(line);
      const lineType = classifyLine(line, stockCode);
      metrics.lineTypeCounts[lineType] += 1;
      if (isVoid) metrics.voidedSourceLines += 1;

      // Immutable N3 Stock ID for this line (fallback: none — line simply
      // ships without one and matches by code as before).
      const stockN3Id =
        line.stockId != null && line.stockId !== 0 ? String(line.stockId) : null;
      const stockNameAtTx = line.stock?.name ?? null;

      const row = {
        tenant_code: tenantCode,
        n3_document_id: docId,
        n3_line_id: lineId,
        n3_stock_id: stockN3Id,
        n3_customer_id: customerN3Id,
        document_no: docNo,
        document_date: docDate ? isoDate(docDate) : null,
        document_status: isVoid ? "Cancelled" : "Active",
        customer_code: customerCode || null,
        customer_name: customerName ?? null,
        customer_code_at_transaction: customerCode || null,
        customer_name_at_transaction: customerName ?? null,
        line_no: line.pos ?? line.numbering ?? index + 1,
        source_line_order: line.pos ?? line.numbering ?? index + 1,
        stock_code: stockCode,
        stock_name: stockNameAtTx,
        stock_code_at_transaction: stockCode,
        stock_name_at_transaction: stockNameAtTx,
        description: line.description ?? line.stock?.description ?? null,
        quantity: typeof line.qty === "number" ? line.qty : null,
        uom: line.uom?.code ?? null,
        is_void: isVoid,
        is_void_source: isVoid,
        is_deleted_in_source: false,
        line_type: lineType,
        has_stock_code: !!stockCode,
        parent_line_id: parentLineId,
        last_seen_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      };
      upsertRows.push(row);

      // Only stock lines with a non-empty stock code can produce entitlement.
      if (lineType !== "stock" || !stockKey) {
        metrics.linesWithoutStockIgnored += 1;
        return;
      }
      // Prefer immutable Stock ID → fall back to Stock Code for legacy rows.
      const renewal =
        (stockN3Id && renewalMappingsByStockId.get(stockN3Id)) ||
        renewalMappings.get(stockKey) ||
        null;
      const isAdHoc =
        (stockN3Id && adHocStockIds.has(stockN3Id)) || adHocStockCodes.has(stockKey);
      if (renewal) {
        metrics.mappedRenewalLines += 1;
        if (isVoid) {
          // Header-level cancellation: do NOT push a fresh event, but the
          // post-loop propagation below flips is_source_void=true on any
          // pre-existing events for this (tenant, source_type,
          // source_document_id). History rows are preserved.
          metrics.renewalEventsSkipped += 1;
          metrics.renewalEventsSkippedVoided += 1;
          return;
        }
        if (!customerCode) {
          metrics.renewalEventsSkipped += 1;
          metrics.renewalEventsSkippedMissingCustomer += 1;
          return;
        }
        if (!docDate) {
          metrics.renewalEventsSkipped += 1;
          metrics.renewalEventsSkippedInvalidDate += 1;
          return;
        }
        const expiry = computeInclusiveExpiry(
          docDate,
          renewal.renewal_cycle_value,
          renewal.renewal_cycle_unit,
        );
        renewalEvents.push({
          tenant_code: tenantCode,
          customer_code: customerCode,
          customer_name: customerName ?? null,
          n3_customer_id: customerN3Id,
          n3_stock_id: stockN3Id,
          n3_document_id: docId,
          n3_line_id: lineId,
          customer_code_at_event: customerCode,
          customer_name_at_event: customerName ?? null,
          stock_code_at_event: stockCode,
          stock_name_at_event: stockNameAtTx,
          document_no_at_event: docNo,
          subscription_category_id:
            categoryIdByName.get(renewal.subscription_category.toLowerCase()) ?? null,
          subscription_category_name: renewal.subscription_category,
          stock_code: renewal.stock_code,
          stock_name: stockNameAtTx,
          source_type: sourceType,
          source_document_id: docId,
          source_document_no: docNo,
          source_document_date: isoDate(docDate),
          source_line_id: lineId,
          renewal_cycle_value: renewal.renewal_cycle_value,
          renewal_cycle_unit: renewal.renewal_cycle_unit,
          start_date: isoDate(docDate),
          expiry_date: isoDate(expiry),
          is_source_void: false,
        });
      } else if (isAdHoc) {
        metrics.mappedAdHocLines += 1; // stored for future job history; no expiry
      } else {
        metrics.unmappedStockLines += 1;
        metrics.unmappedLinesIgnored += 1;
      }

    });

    // Track the current line-id set the document just reported so the
    // line-removal reconciliation phase can flag stored lines that N3 no
    // longer returns. Recorded only for successful detail fetches.
    detailFetchedDocs.add(docId);
    const seenLines = new Set<string>();
    for (const r of upsertRows) {
      const lid = String((r as { n3_line_id: string }).n3_line_id);
      if (lid) seenLines.add(lid);
    }
    seenLineIdsByDoc.set(docId, seenLines);

    // Batch upsert line snapshots.
    if (upsertRows.length > 0) {
      const { error } = await supabaseAdmin
        .from(lineTable)
        .upsert(upsertRows as never, { onConflict: "tenant_code,n3_document_id,n3_line_id" });
      if (error) {
        console.error(`[subscription-sync] upsert ${lineTable} failed docId=${docId}`, error);
        metrics.detailRequestsFailed += 1;
      } else {
        metrics.detailLinesStored += upsertRows.length;
      }
    }


    // Batch upsert renewal events.
    if (renewalEvents.length > 0) {
      const { error, count } = await supabaseAdmin
        .from("subscription_renewal_events")
        .upsert(renewalEvents as never, {
          onConflict: "tenant_code,source_document_id,source_line_id",
          count: "exact",
        });
      if (error) {
        console.error(
          `[subscription-sync] upsert renewal events failed docId=${docId}`,
          error,
        );
        metrics.renewalEventsSkipped += renewalEvents.length;
      } else {
        metrics.renewalEventsInserted += count ?? renewalEvents.length;
      }
    }

    // Phase 1.1.5 — header-level cancellation propagation. Cancellation
    // lives on the header (isCancelled), so ANY renewal event previously
    // derived from this (tenant_code, source_type, source_document_id)
    // must reflect the current header state — regardless of line id.
    // History rows are preserved; only the is_source_void flag flips.
    // When the header is non-void again AND we just wrote fresh events
    // (is_source_void=false in the upsert payload), any leftover events
    // for lines that were removed from the document are also flipped
    // back to false only if their line snapshot is non-void — safest is
    // to only propagate the void=true direction here and let the upsert
    // above own the false direction for lines it re-emits.
    // Only propagate the void=true direction. When the header is active,
    // the upsert above already set is_source_void=false for the current
    // valid detail lines; we must NOT blanket-flip old/removed lines
    // back to false here.
    if (isVoid) {
      const { error: propErr } = await supabaseAdmin
        .from("subscription_renewal_events")
        .update({ is_source_void: true })
        .eq("tenant_code", tenantCode)
        .eq("source_type", sourceType)
        .eq("source_document_id", docId);
      if (propErr) {
        throw new Error(
          `[subscription-sync] propagate is_source_void=true failed docId=${docId}: ${propErr.message}`,
        );
      }
    }

  }

  // -------------------------------------------------------------------------
  // Phase 1.1.6b — Reconciliation.
  //
  // Runs ONLY when (a) the feature flag is on AND (b) the header inventory
  // scan came back complete. A partial scan (transport error, unique count
  // mismatch, short/oversized page, etc.) is TREATED AS UNKNOWN — the
  // whole reconciliation phase is skipped, never inferred from partial data.
  // -------------------------------------------------------------------------
  // Phase 1.1.6b — Reconciliation gate.
  //
  // Runs ONLY when (a) the feature flag is on AND (b) evaluateScanSafety
  // clears the run. Empty inventories with local data, suspicious
  // collapses (< 50% of prior run) and any unhealthy scan are treated as
  // UNKNOWN — the whole reconciliation phase is skipped, never inferred
  // from partial or suspicious data.

  // Count local active documents for this tenant + source. Used by both
  // the empty-inventory guard and the operator-facing counters.
  let existingActiveLineDocuments = 0;
  {
    const CHUNK = 1000;
    let offset = 0;
    const seen = new Set<string>();
    for (;;) {
      const { data, error } = await supabaseAdmin
        .from(lineTable)
        .select("n3_document_id")
        .eq("tenant_code", tenantCode)
        .eq("is_deleted_in_source", false)
        .range(offset, offset + CHUNK - 1);
      if (error) {
        console.warn(
          `[subscription-sync] existing-active load failed source=${sourceType}: ${error.message}`,
        );
        break;
      }
      const rows = data ?? [];
      for (const r of rows) {
        const id = String(r.n3_document_id ?? "").trim();
        if (id) seen.add(id);
      }
      if (rows.length < CHUNK) break;
      offset += CHUNK;
    }
    existingActiveLineDocuments = seen.size;
  }

  // Prior healthy inventory total for this source, from the most recent
  // completed subscription sync log.
  let priorInventoryTotal: number | null = null;
  {
    const { data } = await supabaseAdmin
      .from("snapshot_sync_logs")
      .select("details")
      .eq("tenant_code", tenantCode)
      .eq("snapshot_type", "contract")
      .eq("status", "success")
      .order("started_at", { ascending: false })
      .limit(5);
    const key = sourceType === "invoice" ? "salesInvoice" : "deliveryOrder";
    for (const log of data ?? []) {
      const details = (log.details ?? null) as Record<string, unknown> | null;
      const src = details?.[key] as { reconciliation?: { inventoryTotal?: number | null } } | undefined;
      const val = src?.reconciliation?.inventoryTotal;
      if (typeof val === "number") {
        priorInventoryTotal = val;
        break;
      }
    }
  }

  const safety = evaluateScanSafety({
    scanHealthy,
    scanReason,
    inventoryTotal: totalReported,
    uniqueHeadersSeen: seenDocumentIds.size,
    existingActiveLineDocuments,
    priorInventoryTotal,
  });

  const recon: ReconciliationCounters = {
    enabled: args.reconciliationEnabled,
    checked: 0,
    confirmedDeleted: 0,
    confirmedLineRemoved: 0,
    transient: 0,
    unknownEnvelope: 0,
    reconciliationFailed: 0,
    skippedUnsafe: safety.skippedUnsafe,
    skippedReason: safety.skippedReason,
    inventoryTotal: totalReported,
    priorInventoryTotal,
    uniqueHeadersSeen: seenDocumentIds.size,
    existingActiveLineDocuments,
    pagesFetched,
    candidateDocuments: 0,
    candidateCapHit: false,
  };

  if (!args.reconciliationEnabled) {
    console.info(
      `[subscription-sync] reconciliation disabled by RECONCILIATION_ENABLED source=${sourceType}`,
    );
    return { ...metrics, reconciliation: recon };
  }

  if (safety.skippedUnsafe) {
    console.warn(
      `[subscription-sync] reconciliation skipped (unsafe scan) source=${sourceType} reason=${safety.skippedReason}`,
    );
    return { ...metrics, reconciliation: recon };
  }

  await args.heartbeat?.(`Reconciling ${sourceType} deletions`, {
    source: sourceType,
    stage: "reconciliation",
  });

  // ---- Deleted-document reconciliation --------------------------------------
  // Candidates: rows for THIS tenant + source whose parent document is not
  // already flagged deleted, whose n3_document_id is not in the current
  // healthy inventory, AND whose last_seen_at < runStartedAt (so we never
  // race a row we just refreshed in this run).
  //
  // Order by last_seen_at ASC so the oldest missing documents are
  // verified first. When the cap trims the list, the next run picks up
  // where this one left off — deterministic progression, no starvation.
  const candidateDocIds: string[] = [];
  const seenDocumentOrder = new Set<string>();
  {
    const CHUNK = 1000;
    let offset = 0;
    for (;;) {
      const { data, error } = await supabaseAdmin
        .from(lineTable)
        .select("n3_document_id, last_seen_at, is_deleted_in_source")
        .eq("tenant_code", tenantCode)
        .lt("last_seen_at", args.runStartedAt.toISOString())
        .eq("is_deleted_in_source", false)
        .order("last_seen_at", { ascending: true })
        .order("n3_document_id", { ascending: true })
        .range(offset, offset + CHUNK - 1);
      if (error) {
        console.error(
          `[subscription-sync] reconciliation candidate load failed source=${sourceType}`,
          error,
        );
        recon.skippedUnsafe = true;
        recon.skippedReason = `candidate load failed: ${error.message}`;
        return { ...metrics, reconciliation: recon };
      }
      const rows = data ?? [];
      for (const r of rows) {
        const id = String(r.n3_document_id ?? "").trim();
        if (!id) continue;
        if (seenDocumentOrder.has(id)) continue;
        seenDocumentOrder.add(id);
        if (!seenDocumentIds.has(id)) candidateDocIds.push(id);
      }
      if (rows.length < CHUNK) break;
      offset += CHUNK;
    }
  }
  recon.candidateDocuments = candidateDocIds.length;

  // Hard cap: never let a runaway missing-set torch the run. Order-by
  // last_seen_at guarantees the next run's cap window advances.
  const MAX_VERIFY = 500;
  const toVerify = candidateDocIds.slice(0, MAX_VERIFY);
  if (candidateDocIds.length > MAX_VERIFY) {
    recon.candidateCapHit = true;
    console.warn(
      `[subscription-sync] reconciliation candidate cap hit source=${sourceType} candidates=${candidateDocIds.length} verified=${MAX_VERIFY}`,
    );
  }

  for (const docId of toVerify) {
    recon.checked += 1;
    try {
      await n3Get<N3DocFull>(
        args.ctx.token,
        getEndpoint.target,
        getEndpoint.path.replace("{key}", encodeURIComponent(docId)),
      );
      // Still exists — must be a transient list omission. Do NOT mark deleted.
      recon.transient += 1;
    } catch (err) {
      if (isN3NotFound(err)) {
        // Confirmed business-deletion. Ordered writer: events first, then
        // line snapshots (with run-boundary timestamp guard).
        try {
          await invalidateDeletedDocument({
            client: supabaseAdmin as unknown as { from: (t: string) => unknown },
            tenantCode,
            sourceType,
            docId,
            runStartedAt: args.runStartedAt,
            lineTable,
          });
          recon.confirmedDeleted += 1;
          console.info(
            `[subscription-sync] reconciled_deleted source=${sourceType} docId=${docId} tenant=${tenantCode}`,
          );
        } catch (writeErr) {
          recon.reconciliationFailed += 1;
          metrics.detailRequestsFailed += 1;
          console.error(
            `[subscription-sync] reconciliation write failed source=${sourceType} docId=${docId}`,
            writeErr,
          );
        }
      } else if (err instanceof N3HttpError) {
        // 401/403/500/etc. — do NOT mark deleted. Log and move on.
        recon.transient += 1;
        console.warn(
          `[subscription-sync] recon transient http_error source=${sourceType} docId=${docId} status=${err.status} envelope=${err.envelopeCode ?? "-"}`,
        );
      } else {
        recon.unknownEnvelope += 1;
        console.warn(
          `[subscription-sync] recon unknown error source=${sourceType} docId=${docId}`,
          err,
        );
      }
    }
  }

  // ---- Line-removal reconciliation -----------------------------------------
  // For every document whose detail fetch succeeded in THIS run, any stored
  // line snapshot whose n3_line_id is not in the freshly-seen line set —
  // AND whose last_seen_at predates this run — must be flagged deleted.
  {
    const docIds = Array.from(detailFetchedDocs);
    const BATCH = 100;
    for (let i = 0; i < docIds.length; i += BATCH) {
      const chunk = docIds.slice(i, i + BATCH);
      const { data, error } = await supabaseAdmin
        .from(lineTable)
        .select("n3_document_id, n3_line_id")
        .eq("tenant_code", tenantCode)
        .in("n3_document_id", chunk)
        .eq("is_deleted_in_source", false)
        .lt("last_seen_at", args.runStartedAt.toISOString());
      if (error) {
        console.error(
          `[subscription-sync] line-removal load failed source=${sourceType}`,
          error,
        );
        continue;
      }
      const toDelete: Array<{ doc: string; line: string }> = [];
      for (const r of data ?? []) {
        const doc = String(r.n3_document_id ?? "");
        const line = String(r.n3_line_id ?? "");
        if (!doc || !line) continue;
        const seen = seenLineIdsByDoc.get(doc);
        if (seen && !seen.has(line)) toDelete.push({ doc, line });
      }
      for (const t of toDelete) {
        try {
          await invalidateRemovedLine({
            client: supabaseAdmin as unknown as { from: (t: string) => unknown },
            tenantCode,
            sourceType,
            docId: t.doc,
            lineId: t.line,
            runStartedAt: args.runStartedAt,
            lineTable,
          });
          recon.confirmedLineRemoved += 1;
          console.info(
            `[subscription-sync] reconciled_line_removed source=${sourceType} docId=${t.doc} lineId=${t.line} tenant=${tenantCode}`,
          );
        } catch (writeErr) {
          recon.reconciliationFailed += 1;
          metrics.detailRequestsFailed += 1;
          console.error(
            `[subscription-sync] reconciliation line-write failed source=${sourceType} docId=${t.doc} lineId=${t.line}`,
            writeErr,
          );
        }
      }
    }
  }

  console.info(
    `[subscription-sync] reconciliation_complete source=${sourceType} tenant=${tenantCode} checked=${recon.checked} deleted=${recon.confirmedDeleted} linesRemoved=${recon.confirmedLineRemoved} transient=${recon.transient} unknown=${recon.unknownEnvelope} failed=${recon.reconciliationFailed} candidates=${recon.candidateDocuments} capHit=${recon.candidateCapHit} totalReported=${recon.inventoryTotal ?? "-"} priorTotal=${recon.priorInventoryTotal ?? "-"} unique=${recon.uniqueHeadersSeen} existingActive=${recon.existingActiveLineDocuments}`,
  );

  return { ...metrics, reconciliation: recon };
}



// ---------------------------------------------------------------------------
// Rebuild current customer_subscription_snapshots from the renewal event
// history. Latest non-void event per (customer, category) wins.

interface RebuildBySource {
  invoice: { inserted: number; updated: number; unchanged: number; total: number };
  delivery_order: { inserted: number; updated: number; unchanged: number; total: number };
}

async function rebuildCurrentSnapshots(
  tenantCode: string,
  dueSoonDays: number,
  customerNameByCode: Map<string, string | null>,
): Promise<{ inserted: number; updated: number; skipped: number; bySource: RebuildBySource }> {
  type RenewalEventRow = {
    customer_code: string;
    customer_name: string | null;
    n3_customer_id: string | null;
    n3_stock_id: string | null;
    subscription_category_id: string | null;
    subscription_category_name: string;
    stock_code: string | null;
    stock_name: string | null;
    source_type: string;
    source_document_id: string | null;
    source_document_no: string | null;
    source_document_date: string | null;
    source_line_id: string | null;
    renewal_cycle_value: number | null;
    renewal_cycle_unit: string | null;
    start_date: string | null;
    expiry_date: string | null;
    is_source_void: boolean | null;
  };
  const events = await loadAllPaginated<RenewalEventRow>(
    "subscription_renewal_events.forRebuild",
    (from, to) =>
      supabaseAdmin
        .from("subscription_renewal_events")
        .select(
          "customer_code, customer_name, n3_customer_id, n3_stock_id, subscription_category_id, subscription_category_name, stock_code, stock_name, source_type, source_document_id, source_document_no, source_document_date, source_line_id, renewal_cycle_value, renewal_cycle_unit, start_date, expiry_date, is_source_void",
        )
        .eq("tenant_code", tenantCode)
        .eq("is_source_void", false)
        .order("source_document_date", { ascending: false })
        .order("source_line_id", { ascending: false })
        .range(from, to) as unknown as PromiseLike<{ data: RenewalEventRow[] | null; error: { message: string } | null }>,
  );

  // Phase 1.1.4 — subscription identity is (tenant, n3_customer_id, category,
  // n3_stock_id) when BOTH immutable IDs exist. customer_code / stock_code
  // are mutable display fields and MUST NOT participate in identity.
  // Legacy rows (missing either immutable ID) fall back to
  // (customer_code + category + stock_code) purely for migration.
  const immutableKey = (
    n3CustomerId: string | null | undefined,
    category: string,
    n3StockId: string | null | undefined,
  ): string | null =>
    n3CustomerId && n3StockId ? `id::${n3CustomerId}::${category}::${n3StockId}` : null;
  const legacyKey = (
    customerCode: string,
    category: string,
    stockCode: string | null | undefined,
  ): string => `legacy::${customerCode}::${category}::${stockCode ?? ""}`;

  // Latest-event grouping: prefer immutable identity; fall back to legacy.
  const latestByKey = new Map<string, RenewalEventRow>();
  for (const ev of events) {
    const key =
      immutableKey(ev.n3_customer_id, ev.subscription_category_name, ev.n3_stock_id) ??
      legacyKey(ev.customer_code, ev.subscription_category_name, ev.stock_code);
    if (!latestByKey.has(key)) latestByKey.set(key, ev);
  }

  const bySource: RebuildBySource = {
    invoice: { inserted: 0, updated: 0, unchanged: 0, total: 0 },
    delivery_order: { inserted: 0, updated: 0, unchanged: 0, total: 0 },
  };

  // Phase 1.1.5 — even when there are no eligible events left, existing
  // subscription snapshots must be deactivated (never deleted). Continue
  // through the load/deactivate path instead of returning early.

  // Load ALL existing snapshots for this tenant so we can resolve rows by
  // either identity — renamed customer_code / stock_code make a chunked
  // IN(customer_code) filter unreliable.
  type ExistingSubRow = {
    id: string;
    customer_code: string;
    subscription_category: string;
    stock_code: string | null;
    n3_customer_id: string | null;
    n3_stock_id: string | null;
    latest_document_no: string | null;
    latest_document_date: string | null;
    expiry_date: string | null;
    subscription_status: string | null;
  };
  const existingRows = await loadAllPaginated<ExistingSubRow>(
    "customer_subscription_snapshots.allForTenant",
    (from, to) =>
      supabaseAdmin
        .from("customer_subscription_snapshots")
        .select(
          "id, customer_code, subscription_category, stock_code, n3_customer_id, n3_stock_id, latest_document_no, latest_document_date, expiry_date, subscription_status",
        )
        .eq("tenant_code", tenantCode)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: ExistingSubRow[] | null; error: { message: string } | null }>,
  );
  const existingByImmutable = new Map<string, ExistingSubRow>();
  const existingByLegacy = new Map<string, ExistingSubRow[]>();
  for (const r of existingRows) {
    const ik = immutableKey(r.n3_customer_id, r.subscription_category, r.n3_stock_id);
    if (ik) existingByImmutable.set(ik, r);
    const lk = legacyKey(r.customer_code, r.subscription_category, r.stock_code);
    const arr = existingByLegacy.get(lk);
    if (arr) arr.push(r);
    else existingByLegacy.set(lk, [r]);
  }

  const now = Date.now();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const consumedIds = new Set<string>();

  for (const [, ev] of latestByKey) {
    const expiryMs = new Date(ev.expiry_date ?? 0).getTime();
    const daysLeft = Math.ceil((expiryMs - now) / 86400000);
    const status = computeStatus(daysLeft, dueSoonDays);
    const row: Record<string, unknown> = {
      tenant_code: tenantCode,
      customer_code: ev.customer_code,
      customer_name: ev.customer_name ?? customerNameByCode.get(ev.customer_code) ?? null,
      n3_customer_id: ev.n3_customer_id ?? null,
      n3_stock_id: ev.n3_stock_id ?? null,
      subscription_category: ev.subscription_category_name,
      stock_code: ev.stock_code,
      stock_name: ev.stock_name ?? null,
      renewal_cycle_value: ev.renewal_cycle_value,
      renewal_cycle_unit: ev.renewal_cycle_unit,
      latest_source_type: ev.source_type,
      latest_document_no: ev.source_document_no ?? null,
      latest_document_date: ev.source_document_date,
      latest_source_document_id: ev.source_document_id,
      latest_source_line_id: ev.source_line_id,
      contract_start_date: ev.start_date,
      expiry_date: ev.expiry_date,
      remaining_days: daysLeft,
      subscription_status: status,
      last_calculated_at: new Date().toISOString(),
      is_stale: false,
      calculation_error: null,
    };

    const bucket =
      ev.source_type === "delivery_order" ? bySource.delivery_order : bySource.invoice;
    bucket.total += 1;

    // Resolve target row: immutable identity wins. If not found, fall back
    // to the legacy (mutable) key and, when the event now has immutable
    // IDs, adopt the legacy row in place (updating with immutable IDs) so
    // no duplicate is created and the immutable unique index cannot be
    // violated.
    const ik = immutableKey(ev.n3_customer_id, ev.subscription_category_name, ev.n3_stock_id);
    const lk = legacyKey(ev.customer_code, ev.subscription_category_name, ev.stock_code);
    let target: ExistingSubRow | null = null;
    if (ik) target = existingByImmutable.get(ik) ?? null;
    if (!target) {
      const legacyMatches = (existingByLegacy.get(lk) ?? []).filter(
        (r) => !consumedIds.has(r.id),
      );
      // Prefer a legacy row that has no immutable IDs yet — safe to adopt.
      target =
        legacyMatches.find((r) => !r.n3_customer_id || !r.n3_stock_id) ??
        legacyMatches[0] ??
        null;
    }

    if (target) {
      consumedIds.add(target.id);
      const changed =
        (target.latest_document_no ?? null) !== (row.latest_document_no ?? null) ||
        (target.latest_document_date ?? null) !== row.latest_document_date ||
        (target.expiry_date ?? null) !== row.expiry_date ||
        (target.subscription_status ?? null) !== row.subscription_status ||
        (target.customer_code ?? null) !== row.customer_code ||
        (target.stock_code ?? null) !== row.stock_code ||
        (target.n3_customer_id ?? null) !== (row.n3_customer_id ?? null) ||
        (target.n3_stock_id ?? null) !== (row.n3_stock_id ?? null);
      const { error: updErr } = await supabaseAdmin
        .from("customer_subscription_snapshots")
        .update(row as never)
        .eq("id", target.id);
      if (updErr) throw new Error(`Update subscription failed: ${updErr.message}`);
      if (changed) {
        updated += 1;
        bucket.updated += 1;
      } else {
        skipped += 1;
        bucket.unchanged += 1;
      }
    } else {
      const { error: insErr } = await supabaseAdmin
        .from("customer_subscription_snapshots")
        .insert(row as never);
      if (insErr) throw new Error(`Insert subscription failed: ${insErr.message}`);
      inserted += 1;
      bucket.inserted += 1;
    }
  }

  // Phase 1.1.5 — deactivate orphaned current subscriptions. Any existing
  // snapshot whose identity no longer resolves to a non-void event must
  // be marked Inactive. Audit history (renewal events + line snapshots)
  // is preserved; only the current-state row flips.
  let deactivated = 0;
  for (const r of existingRows) {
    if (consumedIds.has(r.id)) continue;
    if ((r.subscription_status ?? null) === "Inactive") {
      skipped += 1;
      continue;
    }
    const { error: deactErr } = await supabaseAdmin
      .from("customer_subscription_snapshots")
      .update({
        subscription_status: "Inactive",
        remaining_days: null,
        last_calculated_at: new Date().toISOString(),
        is_stale: false,
        calculation_error: null,
      } as never)
      .eq("id", r.id);
    if (deactErr) throw new Error(`Deactivate subscription failed: ${deactErr.message}`);
    deactivated += 1;
    updated += 1;
  }

  return { inserted, updated, skipped, bySource };
}


// ---------------------------------------------------------------------------
// Category seeding (unchanged from Phase 1.0).

const DEFAULT_CATEGORIES: Array<{ name: string; display_order: number }> = [
  { name: "Maintenance", display_order: 10 },
  { name: "Hosting", display_order: 20 },
  { name: "N3 Subscription", display_order: 30 },
  { name: "ServiceHub2", display_order: 40 },
  { name: "Hotel", display_order: 50 },
  { name: "Rental", display_order: 60 },
  { name: "Other Renewal", display_order: 70 },
];

export async function ensureDefaultCategories(tenantCode: string): Promise<void> {
  const { data: existing, error } = await supabaseAdmin
    .from("subscription_categories")
    .select("name")
    .eq("tenant_code", tenantCode);
  if (error) return;
  const have = new Set((existing ?? []).map((r) => r.name.toLowerCase()));
  const missing = DEFAULT_CATEGORIES.filter((c) => !have.has(c.name.toLowerCase()));
  if (missing.length === 0) return;
  await supabaseAdmin.from("subscription_categories").insert(
    missing.map((c) => ({
      tenant_code: tenantCode,
      name: c.name,
      display_order: c.display_order,
      is_system: true,
    })),
  );
}
