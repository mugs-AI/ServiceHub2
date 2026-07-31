import { describe, expect, it } from "vitest";

import { filterRecords, groupByCustomer, totalsFromRecords } from "./grouping";
import type { EntitlementRecord } from "./types";

function rec(p: Partial<EntitlementRecord>): EntitlementRecord {
  return {
    id: Math.random().toString(36).slice(2),
    customer_code: "C1",
    customer_name: "Customer One",
    subscription_category: "Software",
    stock_code: "S1",
    stock_name: "Stock One",
    latest_document_no: "IV-1",
    latest_document_date: "2026-01-01",
    contract_start_date: "2026-01-01",
    expiry_date: "2026-06-01",
    remaining_days: 10,
    subscription_status: "Due Soon",
    ...p,
  };
}

describe("entitlement KPI ↔ list consistency", () => {
  const rows = [
    rec({ customer_code: "C1", stock_code: "S1" }),
    rec({ customer_code: "C1", stock_code: "S2" }),
    rec({ customer_code: "C2", stock_code: "S1" }),
  ];

  it("KPI customer count equals the number of grouped cards", () => {
    const totals = totalsFromRecords(rows);
    const groups = groupByCustomer(rows, "expiry_asc");
    expect(totals.customers).toBe(groups.length);
    expect(totals.entitlements).toBe(
      groups.reduce((n, g) => n + g.entitlement_count, 0),
    );
  });

  it("filtered totals stay consistent with the filtered list", () => {
    const filtered = filterRecords(rows, { q: "c2" });
    const totals = totalsFromRecords(filtered);
    const groups = groupByCustomer(filtered, "expiry_asc");
    expect(totals.customers).toBe(1);
    expect(groups).toHaveLength(1);
    expect(totals.entitlements).toBe(1);
  });
});
