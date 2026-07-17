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
import { n3Get, n3IterateList, type N3TenantContext } from "./n3.server";
import { runWithSyncLog, SyncNotReadyError, type SyncResult } from "./log.server";
import { loadAllPaginated } from "./pagination.server";

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
    for (const m of mappingRows ?? []) {
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
    const { data: catRows } = await supabaseAdmin
      .from("subscription_categories")
      .select("id, name")
      .eq("tenant_code", tenantCode);
    const categoryIdByName = new Map<string, string>();
    for (const c of catRows ?? []) categoryIdByName.set(c.name.toLowerCase(), c.id);

    const { data: custRows, error: custErr } = await supabaseAdmin
      .from("customer_snapshots")
      .select("customer_code, customer_name, n3_customer_id")
      .eq("tenant_code", tenantCode);
    if (custErr) throw new Error(`Load customer_snapshots failed: ${custErr.message}`);
    const customerNameByCode = new Map<string, string | null>();
    const customerN3IdByCode = new Map<string, string | null>();
    for (const c of custRows ?? []) {
      customerNameByCode.set(c.customer_code, c.customer_name ?? null);
      customerN3IdByCode.set(c.customer_code, (c.n3_customer_id ?? null) as string | null);
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
    });


    // Merge per-source metrics into the audit counters.
    counters.details.salesInvoice = siMetrics;
    counters.details.deliveryOrder = doMetrics;
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
}): Promise<SourceMetrics> {
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
    lineTypeCounts: {
      stock: 0,
      description: 0,
      serial_or_reference: 0,
      child_detail: 0,
      unknown: 0,
    },
    linesWithoutStockIgnored: 0,
  };


  const headers: N3DocHeader[] = [];
  try {
    for await (const h of n3IterateList<N3DocHeader>(ctx.token, listEndpoint.target, listEndpoint.path)) {
      headers.push(h);
    }
  } catch (err) {
    throw new Error(
      `Fetch ${listEndpoint.resource} (${listEndpoint.path}) failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  metrics.headersScanned = headers.length;
  await heartbeat?.(`Fetching ${sourceType} details 0/${headers.length}`, {
    source: sourceType,
    stage: "details",
    total: headers.length,
    processed: 0,
  });

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
  }

  return metrics;
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
  const { data: events, error } = await supabaseAdmin
    .from("subscription_renewal_events")
    .select(
      "customer_code, customer_name, n3_customer_id, n3_stock_id, subscription_category_id, subscription_category_name, stock_code, stock_name, source_type, source_document_id, source_document_no, source_document_date, source_line_id, renewal_cycle_value, renewal_cycle_unit, start_date, expiry_date, is_source_void",
    )
    .eq("tenant_code", tenantCode)
    .eq("is_source_void", false)
    .order("source_document_date", { ascending: false });
  if (error) throw new Error(`Load renewal events failed: ${error.message}`);

  // Pick latest per (customer, category, stock_code) — ordered descending,
  // so first wins. Sales Invoice and Delivery Order events are equal peers;
  // whichever has the newer source_document_date wins. Different Stock
  // Codes remain independent entitlements even inside the same category.
  const latestByKey = new Map<string, (typeof events)[number]>();
  for (const ev of events ?? []) {
    const key = `${ev.customer_code}::${ev.subscription_category_name}::${ev.stock_code ?? ""}`;
    if (!latestByKey.has(key)) latestByKey.set(key, ev);
  }

  const bySource: RebuildBySource = {
    invoice: { inserted: 0, updated: 0, unchanged: 0, total: 0 },
    delivery_order: { inserted: 0, updated: 0, unchanged: 0, total: 0 },
  };

  if (latestByKey.size === 0) return { inserted: 0, updated: 0, skipped: 0, bySource };

  // Load existing snapshots for change detection.
  const targetCustomers = Array.from(
    new Set(Array.from(latestByKey.values()).map((e) => e.customer_code)),
  );
  const { data: existingRows, error: existingErr } = await supabaseAdmin
    .from("customer_subscription_snapshots")
    .select(
      "customer_code, subscription_category, stock_code, latest_document_no, latest_document_date, expiry_date, subscription_status",
    )
    .eq("tenant_code", tenantCode)
    .in("customer_code", targetCustomers);
  if (existingErr) throw new Error(`Load existing subscriptions failed: ${existingErr.message}`);
  const existingByKey = new Map<string, Record<string, unknown>>();
  for (const r of existingRows ?? []) {
    existingByKey.set(
      `${r.customer_code}::${r.subscription_category}::${r.stock_code ?? ""}`,
      r as Record<string, unknown>,
    );
  }

  const now = Date.now();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const toUpsert: Array<Record<string, unknown>> = [];

  for (const [key, ev] of latestByKey) {
    const expiryMs = new Date(ev.expiry_date).getTime();
    const daysLeft = Math.ceil((expiryMs - now) / 86400000);
    const status = computeStatus(daysLeft, dueSoonDays);
    const row = {
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

    const existing = existingByKey.get(key);
    if (!existing) {
      inserted += 1;
      bucket.inserted += 1;
    } else {
      const changed =
        (existing.latest_document_no ?? null) !== (row.latest_document_no ?? null) ||
        (existing.latest_document_date ?? null) !== row.latest_document_date ||
        (existing.expiry_date ?? null) !== row.expiry_date ||
        (existing.subscription_status ?? null) !== row.subscription_status;
      if (changed) {
        updated += 1;
        bucket.updated += 1;
      } else {
        skipped += 1;
        bucket.unchanged += 1;
      }
    }
    toUpsert.push(row);
  }

  const BATCH = 200;
  for (let i = 0; i < toUpsert.length; i += BATCH) {
    const chunk = toUpsert.slice(i, i + BATCH);
    const { error: upsertErr } = await supabaseAdmin
      .from("customer_subscription_snapshots")
      .upsert(chunk as never, {
        onConflict: "tenant_code,customer_code,subscription_category,stock_code",
      });
    if (upsertErr) throw new Error(`Upsert subscriptions failed: ${upsertErr.message}`);
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
