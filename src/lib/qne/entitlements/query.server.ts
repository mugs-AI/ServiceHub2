// Shared server-side entitlement read model.
//
// Single source of truth for every Due Soon / Overdue number and list in the
// app: Admin Dashboard KPI counts, the Due Soon Customer List and the Overdue
// Customer List all call into this module, so a count can never disagree with
// the page it links to.
//
// Reads ONLY public.customer_subscription_snapshots (the Subscription Engine
// read model). Never calls N3 at runtime.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadAllPaginated } from "@/lib/qne/sync/pagination.server";
import type { EntitlementRecord, EntitlementStatusKey } from "./types";

export type { EntitlementRecord, EntitlementStatusKey } from "./types";
export * from "./grouping";

export const STATUS_LABEL: Record<EntitlementStatusKey, string> = {
  due_soon: "Due Soon",
  overdue: "Overdue",
  active: "Active",
};

export function parseStatusKey(raw: string | null | undefined): EntitlementStatusKey | null {
  const v = (raw ?? "").toLowerCase().trim();
  if (v === "due_soon" || v === "overdue" || v === "active") return v;
  return null;
}


const SELECT_COLS =
  "id, customer_code, customer_name, subscription_category, stock_code, stock_name, latest_document_no, latest_document_date, contract_start_date, expiry_date, remaining_days, subscription_status";

/** Every entitlement record for a tenant in one status. Never truncated. */
export async function loadEntitlementRecords(
  tenantCode: string,
  status: EntitlementStatusKey,
): Promise<EntitlementRecord[]> {
  return loadAllPaginated<EntitlementRecord>(
    `customer_subscription_snapshots.${status}`,
    (from, to) =>
      supabaseAdmin
        .from("customer_subscription_snapshots")
        .select(SELECT_COLS)
        .eq("tenant_code", tenantCode)
        .eq("subscription_status", STATUS_LABEL[status])
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: EntitlementRecord[] | null;
        error: { message: string } | null;
      }>,
  );
}

export interface EntitlementTotals {
  customers: number;
  entitlements: number;
}

/** The canonical KPI numbers. Dashboard and list pages both use this. */
export async function entitlementTotals(
  tenantCode: string,
  status: EntitlementStatusKey,
): Promise<EntitlementTotals> {
  const rows = await loadEntitlementRecords(tenantCode, status);
  return totalsFromRecords(rows);
}

export function totalsFromRecords(rows: EntitlementRecord[]): EntitlementTotals {
  const set = new Set<string>();
  for (const r of rows) if (r.customer_code) set.add(r.customer_code);
  return { customers: set.size, entitlements: rows.length };
}

