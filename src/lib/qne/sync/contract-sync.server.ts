// ContractSnapshotSync — rebuilds customer_contract_snapshots from Sales
// Invoices + Delivery Orders, driven by renewal_stock_mappings. Contract
// days ALWAYS come from renewal_stock_mappings — never hardcoded.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { n3IterateList, type N3TenantContext } from "./n3.server";
import { runWithSyncLog, type SyncResult } from "./log.server";

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
    // 1. Load renewal_stock_mappings for this tenant. If none, mark all
    //    known customers as Unknown and exit — we can't compute anything.
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
    if (customerCodes.length === 0) return;

    // 4. Gather latest qualifying candidate per customer from N3 (server-side).
    //    We stream Invoices + DOs once and keep the latest qualifying doc per customer.
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

    // If mappings is empty, skip N3 fetching entirely — everything will be Unknown.
    if (mappings.size > 0) {
      try {
        for await (const doc of n3IterateList<N3Doc>(ctx.token, "main", "/api/salesinvoice")) {
          consider(extractCandidates(doc, "invoice", mappings));
        }
      } catch (err) {
        counters.failed += 1;
        throw new Error(`Fetch salesinvoice failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      try {
        for await (const doc of n3IterateList<N3Doc>(ctx.token, "main", "/api/deliveryorder")) {
          consider(extractCandidates(doc, "delivery_order", mappings));
        }
      } catch (err) {
        counters.failed += 1;
        throw new Error(`Fetch deliveryorder failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 5. Load existing snapshots for change detection.
    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from("customer_contract_snapshots")
      .select("customer_code, latest_document_no, latest_document_date, expiry_date, contract_status")
      .eq("tenant_code", tenantCode)
      .in("customer_code", customerCodes);
    if (existingErr) throw new Error(`Load existing contracts failed: ${existingErr.message}`);
    const existingByCode = new Map<string, Record<string, unknown>>();
    for (const r of existingRows ?? []) existingByCode.set(r.customer_code, r as Record<string, unknown>);

    const now = Date.now();
    const toUpsert: Array<Record<string, unknown>> = [];

    for (const customerCode of customerCodes) {
      const latest = latestByCustomer.get(customerCode);
      const existing = existingByCode.get(customerCode);
      let row: Record<string, unknown>;
      if (!latest) {
        row = {
          tenant_code: tenantCode,
          customer_code: customerCode,
          latest_document_no: null,
          latest_document_date: null,
          latest_document_type: null,
          renewal_stock_code: null,
          contract_days: null,
          contract_start_date: null,
          expiry_date: null,
          remaining_days: null,
          contract_status: "Unknown" as ContractStatus,
          last_calculated_at: new Date().toISOString(),
          is_stale: false,
          calculation_error: null,
        };
      } else {
        const expiry = new Date(latest.docDate.getTime() + latest.contractDays * 86400000);
        const daysLeft = Math.ceil((expiry.getTime() - now) / 86400000);
        row = {
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
      }

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
