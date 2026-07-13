// ContractSnapshotSync — rebuilds customer_contract_snapshots from Sales
// Invoices + Delivery Orders, driven by renewal_stock_mappings. Contract
// days ALWAYS come from renewal_stock_mappings — never hardcoded.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { N3_ENDPOINTS } from "@/lib/qne/endpoints";
import { n3IterateList, type N3TenantContext } from "./n3.server";
import { runWithSyncLog, SyncNotReadyError, type SyncResult } from "./log.server";

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
  details?: N3DocLine[];
  lines?: N3DocLine[];
  [k: string]: unknown;
}

type ContractStatus = "Active" | "Due Soon" | "Overdue" | "Unknown" | "Suspended";

interface Mapping {
  stock_code: string;
  contract_days: number | null;
}

function parseDate(v: string | undefined | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function computeStatus(daysLeft: number, dueSoonDays: number): ContractStatus {
  if (daysLeft < 0) return "Overdue";
  if (daysLeft <= dueSoonDays) return "Due Soon";
  return "Active";
}

interface Candidate {
  docType: "invoice" | "delivery_order";
  docNo: string;
  docDate: Date;
  customerCode: string;
  stockCode: string;
  contractDays: number;
}

function extractCandidates(
  doc: N3Doc,
  docType: Candidate["docType"],
  mappings: Map<string, Mapping>,
): Candidate | null {
  const customerCode = (doc.customerCode ?? "").trim();
  if (!customerCode) return null;
  const date = parseDate(doc.docDate ?? doc.date);
  if (!date) return null;
  const lines = Array.isArray(doc.details) ? doc.details : Array.isArray(doc.lines) ? doc.lines : [];
  for (const line of lines) {
    const code = (line.stockCode ?? "").trim();
    if (!code) continue;
    const mapping = mappings.get(code);
    if (!mapping) continue;
    const days = mapping.contract_days;
    if (typeof days !== "number" || days <= 0) continue; // require mapping to define days
    return {
      docType,
      docNo: (doc.docNo ?? doc.documentNo ?? "").toString(),
      docDate: date,
      customerCode,
      stockCode: code,
      contractDays: days,
    };
  }
  return null;
}

interface ContractSyncOptions {
  /**
   * When provided, only rebuild snapshots for these customer codes. Empty
   * array means "no work". Undefined means "rebuild every customer".
   */
  customerCodes?: string[];
}

export async function syncContractSnapshots(
  ctx: N3TenantContext,
  options: ContractSyncOptions = {},
): Promise<SyncResult> {
  const { tenantCode } = ctx;
  return runWithSyncLog({ tenantCode, snapshotType: "contract" }, async (counters) => {
    // 1. Load renewal_stock_mappings for this tenant. If none, refuse to
    //    produce Unknown-spam snapshots — surface a Warning and stop.
    const { data: mappingRows, error: mapErr } = await supabaseAdmin
      .from("renewal_stock_mappings")
      .select("stock_code, contract_days, is_active")
      .eq("tenant_code", tenantCode)
      .eq("is_active", true);
    if (mapErr) throw new Error(`Load renewal_stock_mappings failed: ${mapErr.message}`);
    const mappings = new Map<string, Mapping>();
    for (const m of mappingRows ?? []) {
      mappings.set(m.stock_code, { stock_code: m.stock_code, contract_days: m.contract_days });
    }
    if (mappings.size === 0) {
      throw new SyncNotReadyError(
        "Contract calculation not ready — configure Renewal Stock Mapping.",
      );
    }

    // 2. Load general_settings for due_soon_days threshold (default 30).
    const { data: settings } = await supabaseAdmin
      .from("general_settings")
      .select("due_soon_days")
      .eq("tenant_code", tenantCode)
      .maybeSingle();
    const dueSoonDays = settings?.due_soon_days ?? 30;

    // 3. Load candidate customers from snapshots (tenant-scoped).
    const { data: customers, error: custErr } = await supabaseAdmin
      .from("customer_snapshots")
      .select("customer_code")
      .eq("tenant_code", tenantCode);
    if (custErr) throw new Error(`Load customer_snapshots failed: ${custErr.message}`);
    let customerCodes = (customers ?? []).map((c) => c.customer_code);
    if (options.customerCodes) {
      const filter = new Set(options.customerCodes);
      customerCodes = customerCodes.filter((c) => filter.has(c));
    }
    if (customerCodes.length === 0) {
      throw new SyncNotReadyError(
        "Contract calculation not ready — no Customer Snapshots. Run Customer Sync first.",
      );
    }

    // 4. Gather latest qualifying candidate per customer from N3 (server-side).
    //    Invoice and DO are INDEPENDENT sources. We stream each list once
    //    and keep the latest qualifying doc per customer, regardless of type.
    const latestByCustomer = new Map<string, Candidate>();
    const targetCustomers = new Set(customerCodes);

    const consider = (cand: Candidate | null) => {
      if (!cand) return;
      if (!targetCustomers.has(cand.customerCode)) return;
      const prev = latestByCustomer.get(cand.customerCode);
      if (!prev || cand.docDate.getTime() > prev.docDate.getTime()) {
        latestByCustomer.set(cand.customerCode, cand);
      }
    };

    const invoicesEp = N3_ENDPOINTS["salesInvoices.list"];
    const dosEp = N3_ENDPOINTS["deliveryOrders.list"];
    try {
      for await (const doc of n3IterateList<N3Doc>(ctx.token, invoicesEp.target, invoicesEp.path)) {
        consider(extractCandidates(doc, "invoice", mappings));
      }
    } catch (err) {
      throw new Error(
        `Fetch ${invoicesEp.resource} (${invoicesEp.path}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      for await (const doc of n3IterateList<N3Doc>(ctx.token, dosEp.target, dosEp.path)) {
        consider(extractCandidates(doc, "delivery_order", mappings));
      }
    } catch (err) {
      throw new Error(
        `Fetch ${dosEp.resource} (${dosEp.path}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (latestByCustomer.size === 0) {
      throw new SyncNotReadyError(
        "No qualifying Sales Invoices or Delivery Orders found for the configured Renewal Stock Mappings.",
      );
    }

    // 5. Load existing snapshots for change detection — only for customers
    //    that actually have a qualifying document. We NEVER manufacture
    //    Unknown rows for customers without qualifying documents.
    const targetKeys = Array.from(latestByCustomer.keys());
    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from("customer_contract_snapshots")
      .select("customer_code, latest_document_no, latest_document_date, expiry_date, contract_status")
      .eq("tenant_code", tenantCode)
      .in("customer_code", targetKeys);
    if (existingErr) throw new Error(`Load existing contracts failed: ${existingErr.message}`);
    const existingByCode = new Map<string, Record<string, unknown>>();
    for (const r of existingRows ?? []) existingByCode.set(r.customer_code, r as Record<string, unknown>);

    const now = Date.now();
    const toUpsert: Array<Record<string, unknown>> = [];

    for (const customerCode of targetKeys) {
      const latest = latestByCustomer.get(customerCode)!;
      const existing = existingByCode.get(customerCode);
      const expiry = new Date(latest.docDate.getTime() + latest.contractDays * 86400000);
      const daysLeft = Math.ceil((expiry.getTime() - now) / 86400000);
      const row: Record<string, unknown> = {
        tenant_code: tenantCode,
        customer_code: customerCode,
        latest_document_no: latest.docNo || null,
        latest_document_date: latest.docDate.toISOString().slice(0, 10),
        latest_document_type: latest.docType,
        renewal_stock_code: latest.stockCode,
        contract_days: latest.contractDays,
        contract_start_date: latest.docDate.toISOString().slice(0, 10),
        expiry_date: expiry.toISOString().slice(0, 10),
        remaining_days: daysLeft,
        contract_status: computeStatus(daysLeft, dueSoonDays),
        last_calculated_at: new Date().toISOString(),
        is_stale: false,
        calculation_error: null,
      };

      if (!existing) {
        counters.inserted += 1;
      } else {
        const changed =
          (existing.latest_document_no ?? null) !== (row.latest_document_no ?? null) ||
          (existing.latest_document_date ?? null) !== (row.latest_document_date ?? null) ||
          (existing.expiry_date ?? null) !== (row.expiry_date ?? null) ||
          (existing.contract_status ?? null) !== (row.contract_status ?? null);
        if (changed) counters.updated += 1;
        else counters.skipped += 1;
      }
      toUpsert.push(row);
    }

    // 6. Upsert in batches.
    const BATCH = 200;
    for (let i = 0; i < toUpsert.length; i += BATCH) {
      const chunk = toUpsert.slice(i, i + BATCH) as unknown as Array<{
        tenant_code: string;
        customer_code: string;
      }>;
      const { error } = await supabaseAdmin
        .from("customer_contract_snapshots")
        .upsert(chunk, { onConflict: "tenant_code,customer_code" });
      if (error) {
        counters.failed += chunk.length;
        throw new Error(`Upsert contracts failed: ${error.message}`);
      }
    }
  });
}
