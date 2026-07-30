// Pure, client-safe entitlement grouping/filtering/sorting helpers.
// Imported by query.server.ts and by unit tests.

import type { EntitlementRecord } from "./types";

export interface EntitlementFilters {
  q?: string | null;
  stock?: string | null;
  category?: string | null;
  from?: string | null;
  to?: string | null;
}

export function filterRecords(
  rows: EntitlementRecord[],
  f: EntitlementFilters,
): EntitlementRecord[] {
  const q = (f.q ?? "").trim().toLowerCase();
  const stock = (f.stock ?? "").trim().toLowerCase();
  const category = (f.category ?? "").trim().toLowerCase();
  const from = (f.from ?? "").trim();
  const to = (f.to ?? "").trim();
  return rows.filter((r) => {
    if (q) {
      const hay = `${r.customer_code ?? ""} ${r.customer_name ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (stock) {
      const hay = `${r.stock_code ?? ""} ${r.stock_name ?? ""}`.toLowerCase();
      if (!hay.includes(stock)) return false;
    }
    if (category && (r.subscription_category ?? "").toLowerCase() !== category) return false;
    if (from && (!r.expiry_date || r.expiry_date < from)) return false;
    if (to && (!r.expiry_date || r.expiry_date > to)) return false;
    return true;
  });
}

export type EntitlementSort =
  | "expiry_asc"
  | "expiry_desc"
  | "customer_name"
  | "customer_code";

export function parseSort(
  raw: string | null | undefined,
  status: EntitlementStatusKey,
): EntitlementSort {
  const v = (raw ?? "").trim();
  if (
    v === "expiry_asc" ||
    v === "expiry_desc" ||
    v === "customer_name" ||
    v === "customer_code"
  )
    return v;
  // Defaults: Due Soon → nearest expiry first; Overdue → most recently expired.
  return status === "overdue" ? "expiry_desc" : "expiry_asc";
}

export interface EntitlementGroup {
  customer_code: string;
  customer_name: string | null;
  entitlement_count: number;
  earliest_expiry: string | null;
  latest_expiry: string | null;
  min_remaining_days: number | null;
  entitlements: EntitlementRecord[];
}

const FAR = "9999-12-31";
const NEAR = "0000-01-01";

export function groupByCustomer(
  rows: EntitlementRecord[],
  sort: EntitlementSort,
): EntitlementGroup[] {
  const map = new Map<string, EntitlementGroup>();
  for (const r of rows) {
    if (!r.customer_code) continue;
    let g = map.get(r.customer_code);
    if (!g) {
      g = {
        customer_code: r.customer_code,
        customer_name: r.customer_name,
        entitlement_count: 0,
        earliest_expiry: null,
        latest_expiry: null,
        min_remaining_days: null,
        entitlements: [],
      };
      map.set(r.customer_code, g);
    }
    if (!g.customer_name && r.customer_name) g.customer_name = r.customer_name;
    g.entitlement_count += 1;
    g.entitlements.push(r);
    if (r.expiry_date) {
      if (!g.earliest_expiry || r.expiry_date < g.earliest_expiry) g.earliest_expiry = r.expiry_date;
      if (!g.latest_expiry || r.expiry_date > g.latest_expiry) g.latest_expiry = r.expiry_date;
    }
    if (typeof r.remaining_days === "number") {
      g.min_remaining_days =
        g.min_remaining_days == null
          ? r.remaining_days
          : Math.min(g.min_remaining_days, r.remaining_days);
    }
  }

  const groups = Array.from(map.values());
  for (const g of groups) {
    g.entitlements.sort((a, b) => {
      const ax = a.expiry_date ?? FAR;
      const bx = b.expiry_date ?? FAR;
      if (ax !== bx) return sort === "expiry_desc" ? bx.localeCompare(ax) : ax.localeCompare(bx);
      return (a.stock_code ?? "").localeCompare(b.stock_code ?? "");
    });
  }

  groups.sort((a, b) => {
    switch (sort) {
      case "customer_name":
        return (a.customer_name ?? a.customer_code).localeCompare(
          b.customer_name ?? b.customer_code,
        );
      case "customer_code":
        return a.customer_code.localeCompare(b.customer_code);
      case "expiry_desc": {
        const ax = a.latest_expiry ?? NEAR;
        const bx = b.latest_expiry ?? NEAR;
        if (ax !== bx) return bx.localeCompare(ax);
        return a.customer_code.localeCompare(b.customer_code);
      }
      default: {
        const ax = a.earliest_expiry ?? FAR;
        const bx = b.earliest_expiry ?? FAR;
        if (ax !== bx) return ax.localeCompare(bx);
        return a.customer_code.localeCompare(b.customer_code);
      }
    }
  });

  return groups;
}

export function distinctCategories(rows: EntitlementRecord[]): string[] {
  const set = new Set<string>();
  for (const r of rows) if (r.subscription_category) set.add(r.subscription_category);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
