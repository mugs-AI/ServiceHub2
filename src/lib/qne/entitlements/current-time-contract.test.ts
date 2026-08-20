// Structural contract tests: every operational entitlement surface must use
// the ONE shared current-time classifier, not the cached snapshot status.
// (The project has no DOM/Supabase test harness, so wiring is asserted at the
// source level — the same technique used by calendar-ui-contract.test.ts.)

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { classifyEntitlement } from "./temporal";
import { filterRecords, groupByCustomer, totalsFromRecords } from "./grouping";

const read = (p: string) => readFileSync(p, "utf8");

describe("shared classifier wiring", () => {
  it("customer-subscriptions API derives current status server-side", () => {
    const src = read("src/routes/api/workspace/customer-subscriptions.ts");
    expect(src).toContain("entitlements/temporal.server");
    expect(src).toContain("entitlementClock(user.tenantCode)");
    expect(src).toContain("deriveRows(data ?? [], clock)");
    // Candidate lifecycle filtering is preserved.
    expect(src).toContain('.in("subscription_status", ["Active", "Due Soon", "Overdue"])');
    // Tenant is server-resolved.
    expect(src).toContain('.eq("tenant_code", user.tenantCode)');
  });

  it("shared entitlement query filters on derived, not stored, status", () => {
    const src = read("src/lib/qne/entitlements/query.server.ts");
    expect(src).toContain("loadCandidateRecords");
    expect(src).toContain("deriveRows(candidates, c)");
    expect(src).not.toContain('.eq("subscription_status", STATUS_LABEL[status])');
    expect(src).toContain("CANDIDATE_SNAPSHOT_STATUSES");
  });

  it("admin dashboard KPIs use the shared derived candidates", () => {
    const src = read("src/routes/api/admin/dashboard.ts");
    expect(src).toContain("entitlementClock(user.tenantCode)");
    expect(src).toContain("loadCandidateRecords(user.tenantCode)");
    expect(src).toContain('r.subscription_status === "Due Soon"');
    expect(src).toContain('r.subscription_status === "Overdue"');
    // No dashboard-specific classifier.
    expect(src).not.toContain("dueSoonDays >");
  });

  it("POST /api/workspace/jobs derives status server-side", () => {
    const src = read("src/routes/api/workspace/jobs.ts");
    expect(src).toContain("entitlements/temporal.server");
    expect(src).toContain("deriveRows(subsRaw ?? [], entClock)");
    // Browser-supplied status is never read.
    expect(src).not.toContain("body.subscription_status");
    expect(src).not.toContain("body.remaining_days");
    // Selected entitlement stays tenant + customer bound.
    expect(src).toContain('.eq("tenant_code", user.tenantCode)');
    expect(src).toContain('.eq("customer_code", customerCode)');
    expect(src).toContain("(subs ?? []).find((s) => s.id === selectedId)");
    // Snapshot stores the derived status.
    expect(src).toContain("entitlement_status_snapshot: entitlementSnap?.status ?? null");
  });

  it("subscription sync reuses the shared classifier", () => {
    const src = read("src/lib/qne/sync/subscription-sync.server.ts");
    expect(src).toContain("classifyEntitlement");
    expect(src).toContain("malaysiaToday()");
    expect(src).not.toContain("function computeStatus(");
    // Expiry / quantity logic untouched.
    expect(src).toContain("resolveEffectiveQuantity");
  });

  it("New Job UI reads status from the API, not from a browser clock", () => {
    const src = read("src/routes/jobs.new.tsx");
    expect(src).toContain("s.subscription_status");
    expect(src).not.toMatch(/Date\.now\(\)[^\n]*expiry/);
    expect(src).not.toContain("classifyEntitlement");
  });
});

describe("approval matrix over derived status", () => {
  const clock = { todayMalaysiaDate: "2026-08-20", dueSoonDays: 30 };
  const derive = (expiry: string | null) =>
    classifyEntitlement({ expiryDate: expiry, ...clock }).status;

  function classifyJob(
    selected: string | null,
    all: string[],
  ): { status: string; reason: string | null } {
    if (selected !== null) {
      const s = derive(selected).toLowerCase();
      if (s === "overdue")
        return { status: "Pending Approval", reason: "Overdue Entitlement" };
      if (s !== "active" && s !== "due soon")
        return { status: "Pending Approval", reason: "No Active Entitlement" };
      return { status: "Draft", reason: null };
    }
    const derived = all.map(derive);
    const hasActiveish = derived.some((s) => s === "Active" || s === "Due Soon");
    const hasOverdue = derived.some((s) => s === "Overdue");
    if (hasActiveish) return { status: "Draft", reason: null };
    if (hasOverdue)
      return { status: "Pending Approval", reason: "Overdue Entitlement" };
    return { status: "Pending Approval", reason: "No Active Entitlement" };
  }

  it("stale stored Due Soon with expired date -> Pending Approval", () => {
    expect(classifyJob("2026-07-29", ["2026-07-29"])).toEqual({
      status: "Pending Approval",
      reason: "Overdue Entitlement",
    });
  });

  it("selected Due Soon -> Draft", () => {
    expect(classifyJob("2026-09-01", ["2026-09-01"]).status).toBe("Draft");
  });

  it("no selection, only overdue -> Pending Approval / Overdue Entitlement", () => {
    expect(classifyJob(null, ["2026-07-29", "2026-01-01"])).toEqual({
      status: "Pending Approval",
      reason: "Overdue Entitlement",
    });
  });

  it("no selection with an active row -> Draft", () => {
    expect(classifyJob(null, ["2026-07-29", "2027-01-01"]).status).toBe("Draft");
  });

  it("no qualifying entitlement -> Pending Approval / No Active Entitlement", () => {
    expect(classifyJob(null, [])).toEqual({
      status: "Pending Approval",
      reason: "No Active Entitlement",
    });
  });
});

describe("derived lists and KPI agreement", () => {
  const clock = { todayMalaysiaDate: "2026-08-20", dueSoonDays: 30 };
  const rows = [
    { code: "XIANGFOO", expiry: "2026-07-29" }, // stale Due Soon -> Overdue
    { code: "ALPHA", expiry: "2026-09-19" }, // Due Soon boundary
    { code: "BETA", expiry: "2026-09-20" }, // Active boundary
  ].map((r, i) => ({
    id: `r${i}`,
    customer_code: r.code,
    customer_name: r.code,
    subscription_category: "Software",
    stock_code: "S1",
    stock_name: "S1",
    latest_document_no: null,
    latest_document_date: null,
    contract_start_date: null,
    expiry_date: r.expiry,
    remaining_days: 10,
    subscription_status: "Due Soon", // stale cache on every row
  }));

  const derived = rows.map((r) => {
    const t = classifyEntitlement({ expiryDate: r.expiry_date, ...clock });
    return { ...r, remaining_days: t.remainingDays, subscription_status: t.status };
  });

  it("Due Soon excludes the newly overdue row; Overdue includes it", () => {
    const dueSoon = derived.filter((r) => r.subscription_status === "Due Soon");
    const overdue = derived.filter((r) => r.subscription_status === "Overdue");
    expect(dueSoon.map((r) => r.customer_code)).toEqual(["ALPHA"]);
    expect(overdue.map((r) => r.customer_code)).toEqual(["XIANGFOO"]);
    expect(overdue[0].remaining_days).toBe(-22);
  });

  it("Active boundary row is Active", () => {
    expect(
      derived.filter((r) => r.subscription_status === "Active").map((r) => r.customer_code),
    ).toEqual(["BETA"]);
  });

  it("KPI totals equal the grouped list totals", () => {
    const overdue = derived.filter((r) => r.subscription_status === "Overdue");
    const totals = totalsFromRecords(overdue);
    const groups = groupByCustomer(overdue, "expiry_desc");
    expect(totals.customers).toBe(groups.length);
    expect(totals.entitlements).toBe(
      groups.reduce((n, g) => n + g.entitlement_count, 0),
    );
  });

  it("filtering still works over derived rows", () => {
    const filtered = filterRecords(derived, { q: "xiang" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].subscription_status).toBe("Overdue");
  });
});
