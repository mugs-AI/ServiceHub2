// SubscriptionSnapshotSync — Phase 1.0 Customer Subscription Engine.
//
// Rebuilds `customer_subscription_snapshots`. One row per
// (tenant_code, customer_code, subscription_category). A Customer may own
// many renewable services (Maintenance, Hosting, N3 Subscription,
// ServiceHub2, Hotel, …), each with its OWN latest document, expiry,
// remaining days, and status.
//
// Renewal source rules:
//   * Sales Invoice and Delivery Order are INDEPENDENT sources — they never
//     need to match.
//   * For each mapped Subscription Category, the latest qualifying document
//     wins (regardless of type).
//   * Ad Hoc mappings are operational history only — they NEVER create
//     expiry rows.
//   * Unmapped Stock Codes are ignored entirely.
//
// Renewal cycle is driven by the mapping: value + unit (day | month | year).
// Never hardcoded to 365.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { N3_ENDPOINTS } from "@/lib/qne/endpoints";
import { n3IterateList, type N3TenantContext } from "./n3.server";
import { runWithSyncLog, SyncNotReadyError, type SyncResult } from "./log.server";

// ---- N3 shapes (minimal) ----------------------------------------------------

interface N3DocLine {
  stockCode?: string;
  [k: string]: unknown;
}
interface N3Doc {
  docNo?: string;
  documentNo?: string;
  docDate?: string;
  date?: string;
  customerCode?: string;
  customerName?: string;
  details?: N3DocLine[];
  lines?: N3DocLine[];
  [k: string]: unknown;
}

// ---- Domain types -----------------------------------------------------------

type CycleUnit = "day" | "month" | "year";
type SourceType = "invoice" | "delivery_order";
type SubscriptionStatus = "Active" | "Due Soon" | "Overdue" | "Unknown";

interface RenewalMapping {
  stock_code: string;
  subscription_category: string;
  renewal_cycle_value: number;
  renewal_cycle_unit: CycleUnit;
}

interface Candidate {
  sourceType: SourceType;
  docNo: string;
  docDate: Date;
  customerCode: string;
  customerName: string | null;
  stockCode: string;
  mapping: RenewalMapping;
}

// ---- Helpers ---------------------------------------------------------------

function parseDate(v: string | undefined | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isCycleUnit(v: unknown): v is CycleUnit {
  return v === "day" || v === "month" || v === "year";
}

function computeExpiry(start: Date, value: number, unit: CycleUnit): Date {
  const d = new Date(start);
  if (unit === "day") d.setUTCDate(d.getUTCDate() + value);
  else if (unit === "month") d.setUTCMonth(d.getUTCMonth() + value);
  else d.setUTCFullYear(d.getUTCFullYear() + value);
  return d;
}

function computeStatus(daysLeft: number, dueSoonDays: number): SubscriptionStatus {
  if (daysLeft < 0) return "Overdue";
  if (daysLeft <= dueSoonDays) return "Due Soon";
  return "Active";
}

function extractCandidate(
  doc: N3Doc,
  sourceType: SourceType,
  mappings: Map<string, RenewalMapping>,
): Candidate[] {
  const customerCode = (doc.customerCode ?? "").trim();
  if (!customerCode) return [];
  const date = parseDate(doc.docDate ?? doc.date);
  if (!date) return [];
  const lines = Array.isArray(doc.details)
    ? doc.details
    : Array.isArray(doc.lines)
      ? doc.lines
      : [];
  const out: Candidate[] = [];
  for (const line of lines) {
    const code = (line.stockCode ?? "").trim();
    if (!code) continue;
    const mapping = mappings.get(code);
    if (!mapping) continue; // ignore unmapped stock codes
    out.push({
      sourceType,
      docNo: (doc.docNo ?? doc.documentNo ?? "").toString(),
      docDate: date,
      customerCode,
      customerName: (doc.customerName as string | undefined) ?? null,
      stockCode: code,
      mapping,
    });
  }
  return out;
}

// ---- Sync -------------------------------------------------------------------

export async function syncSubscriptionSnapshots(
  ctx: N3TenantContext,
): Promise<SyncResult> {
  const { tenantCode } = ctx;
  return runWithSyncLog({ tenantCode, snapshotType: "contract" }, async (counters) => {
    // 1. Load active Renewal mappings for this tenant. Ad Hoc mappings are
    //    intentionally excluded — they never create expiry.
    const { data: mappingRows, error: mapErr } = await supabaseAdmin
      .from("renewal_stock_mappings")
      .select(
        "stock_code, service_type, subscription_category, renewal_cycle_value, renewal_cycle_unit, contract_days, is_active",
      )
      .eq("tenant_code", tenantCode)
      .eq("is_active", true)
      .eq("service_type", "Renewal");
    if (mapErr) throw new Error(`Load renewal_stock_mappings failed: ${mapErr.message}`);

    const mappings = new Map<string, RenewalMapping>();
    for (const m of mappingRows ?? []) {
      const category = (m.subscription_category ?? "").trim() || "Maintenance";
      // Prefer new cycle columns; legacy contract_days = day cycle fallback.
      let value = typeof m.renewal_cycle_value === "number" ? m.renewal_cycle_value : null;
      let unit: CycleUnit = isCycleUnit(m.renewal_cycle_unit) ? m.renewal_cycle_unit : "day";
      if (value == null && typeof m.contract_days === "number") {
        value = m.contract_days;
        unit = "day";
      }
      if (!value || value <= 0) continue;
      mappings.set(m.stock_code, {
        stock_code: m.stock_code,
        subscription_category: category,
        renewal_cycle_value: value,
        renewal_cycle_unit: unit,
      });
    }
    if (mappings.size === 0) {
      throw new SyncNotReadyError(
        "Subscription calculation not ready — configure Renewal Stock Mapping.",
      );
    }

    // 2. Due-soon threshold from general_settings (default 30 days).
    const { data: settings } = await supabaseAdmin
      .from("general_settings")
      .select("due_soon_days")
      .eq("tenant_code", tenantCode)
      .maybeSingle();
    const dueSoonDays = settings?.due_soon_days ?? 30;

    // 3. Ensure default subscription categories exist for this tenant.
    await ensureDefaultCategories(tenantCode);

    // 4. Customer name lookup from customer_snapshots (tenant-scoped).
    const { data: custRows, error: custErr } = await supabaseAdmin
      .from("customer_snapshots")
      .select("customer_code, customer_name")
      .eq("tenant_code", tenantCode);
    if (custErr) throw new Error(`Load customer_snapshots failed: ${custErr.message}`);
    const knownCustomers = new Set<string>();
    const customerNameByCode = new Map<string, string | null>();
    for (const c of custRows ?? []) {
      knownCustomers.add(c.customer_code);
      customerNameByCode.set(c.customer_code, c.customer_name ?? null);
    }
    if (knownCustomers.size === 0) {
      throw new SyncNotReadyError(
        "Subscription calculation not ready — no Customer Snapshots. Run Customer Sync first.",
      );
    }

    // 5. Stream Sales Invoices + Delivery Orders (independent sources) and
    //    keep the latest qualifying document per (customer, category).
    const latestByKey = new Map<string, Candidate>();

    const consider = (cand: Candidate) => {
      if (!knownCustomers.has(cand.customerCode)) return;
      const key = `${cand.customerCode}::${cand.mapping.subscription_category}`;
      const prev = latestByKey.get(key);
      if (!prev || cand.docDate.getTime() > prev.docDate.getTime()) {
        latestByKey.set(key, cand);
      }
    };

    const invoicesEp = N3_ENDPOINTS["salesInvoices.list"];
    const dosEp = N3_ENDPOINTS["deliveryOrders.list"];
    try {
      for await (const doc of n3IterateList<N3Doc>(ctx.token, invoicesEp.target, invoicesEp.path)) {
        for (const cand of extractCandidate(doc, "invoice", mappings)) consider(cand);
      }
    } catch (err) {
      throw new Error(
        `Fetch ${invoicesEp.resource} (${invoicesEp.path}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      for await (const doc of n3IterateList<N3Doc>(ctx.token, dosEp.target, dosEp.path)) {
        for (const cand of extractCandidate(doc, "delivery_order", mappings)) consider(cand);
      }
    } catch (err) {
      throw new Error(
        `Fetch ${dosEp.resource} (${dosEp.path}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (latestByKey.size === 0) {
      throw new SyncNotReadyError(
        "No qualifying Sales Invoices or Delivery Orders found for the configured Renewal Stock Mappings.",
      );
    }

    // 6. Optional stock name lookup for reporting.
    const stockCodes = Array.from(
      new Set(Array.from(latestByKey.values()).map((c) => c.stockCode)),
    );
    const stockNameByCode = new Map<string, string | null>();
    if (stockCodes.length > 0) {
      const { data: stocks } = await supabaseAdmin
        .from("stock_snapshots")
        .select("stock_code, stock_name")
        .eq("tenant_code", tenantCode)
        .in("stock_code", stockCodes);
      for (const s of stocks ?? []) stockNameByCode.set(s.stock_code, s.stock_name ?? null);
    }

    // 7. Load existing snapshots for change detection.
    const targetKeys = Array.from(latestByKey.values()).map((c) => ({
      customer_code: c.customerCode,
      subscription_category: c.mapping.subscription_category,
    }));
    const targetCustomers = Array.from(new Set(targetKeys.map((k) => k.customer_code)));
    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from("customer_subscription_snapshots")
      .select(
        "customer_code, subscription_category, latest_document_no, latest_document_date, expiry_date, subscription_status",
      )
      .eq("tenant_code", tenantCode)
      .in("customer_code", targetCustomers);
    if (existingErr) throw new Error(`Load existing subscriptions failed: ${existingErr.message}`);
    const existingByKey = new Map<string, Record<string, unknown>>();
    for (const r of existingRows ?? []) {
      existingByKey.set(
        `${r.customer_code}::${r.subscription_category}`,
        r as Record<string, unknown>,
      );
    }

    const now = Date.now();
    const toUpsert: Array<Record<string, unknown>> = [];

    for (const [key, cand] of latestByKey) {
      const expiry = computeExpiry(
        cand.docDate,
        cand.mapping.renewal_cycle_value,
        cand.mapping.renewal_cycle_unit,
      );
      const daysLeft = Math.ceil((expiry.getTime() - now) / 86400000);
      const status = computeStatus(daysLeft, dueSoonDays);
      const row: Record<string, unknown> = {
        tenant_code: tenantCode,
        customer_code: cand.customerCode,
        customer_name: cand.customerName ?? customerNameByCode.get(cand.customerCode) ?? null,
        subscription_category: cand.mapping.subscription_category,
        stock_code: cand.stockCode,
        stock_name: stockNameByCode.get(cand.stockCode) ?? null,
        renewal_cycle_value: cand.mapping.renewal_cycle_value,
        renewal_cycle_unit: cand.mapping.renewal_cycle_unit,
        latest_source_type: cand.sourceType,
        latest_document_no: cand.docNo || null,
        latest_document_date: cand.docDate.toISOString().slice(0, 10),
        contract_start_date: cand.docDate.toISOString().slice(0, 10),
        expiry_date: expiry.toISOString().slice(0, 10),
        remaining_days: daysLeft,
        subscription_status: status,
        last_calculated_at: new Date().toISOString(),
        is_stale: false,
        calculation_error: null,
      };

      const existing = existingByKey.get(key);
      if (!existing) counters.inserted += 1;
      else {
        const changed =
          (existing.latest_document_no ?? null) !== (row.latest_document_no ?? null) ||
          (existing.latest_document_date ?? null) !== (row.latest_document_date ?? null) ||
          (existing.expiry_date ?? null) !== (row.expiry_date ?? null) ||
          (existing.subscription_status ?? null) !== (row.subscription_status ?? null);
        if (changed) counters.updated += 1;
        else counters.skipped += 1;
      }
      toUpsert.push(row);
    }

    // 8. Upsert.
    const BATCH = 200;
    for (let i = 0; i < toUpsert.length; i += BATCH) {
      const chunk = toUpsert.slice(i, i + BATCH) as unknown as Array<{
        tenant_code: string;
        customer_code: string;
        subscription_category: string;
      }>;
      const { error } = await supabaseAdmin
        .from("customer_subscription_snapshots")
        .upsert(chunk, {
          onConflict: "tenant_code,customer_code,subscription_category",
        });
      if (error) {
        counters.failed += chunk.length;
        throw new Error(`Upsert subscriptions failed: ${error.message}`);
      }
    }
  });
}

// ---- Category seeding -------------------------------------------------------

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
  if (error) return; // best-effort; do not fail the sync for seeding
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
