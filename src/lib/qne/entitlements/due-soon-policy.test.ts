// Run SH2.2-DUESOON — Due Soon Policy Settings.
// Policy validation, stored-value normalization, immediate runtime effect on
// the shared current-time classifier, and structural contracts for the
// Settings API / Settings UI wiring. (No DOM or Supabase harness exists in
// this project, so wiring is asserted at source level as elsewhere.)

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DUE_SOON_DAYS,
  MAX_DUE_SOON_DAYS,
  MIN_DUE_SOON_DAYS,
  isValidDueSoonDays,
  normalizeStoredDueSoonDays,
  parseDueSoonDaysInput,
} from "./due-soon-policy";
import { classifyEntitlement } from "./temporal";

const read = (p: string) => readFileSync(p, "utf8");

describe("due soon policy contract", () => {
  it("exposes the canonical default and range", () => {
    expect(DEFAULT_DUE_SOON_DAYS).toBe(30);
    expect(MIN_DUE_SOON_DAYS).toBe(0);
    expect(MAX_DUE_SOON_DAYS).toBe(365);
  });

  it.each([0, 7, 14, 30, 365])("accepts %s", (v) => {
    expect(isValidDueSoonDays(v)).toBe(true);
    expect(parseDueSoonDaysInput(v)).toEqual({ ok: true, value: v });
  });

  it.each([-1, 366, 14.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s", (v) => {
    expect(isValidDueSoonDays(v)).toBe(false);
    expect(parseDueSoonDaysInput(v).ok).toBe(false);
  });

  it.each(["30", null, undefined, {}, [], true])("rejects non-number %s", (v) => {
    expect(parseDueSoonDaysInput(v).ok).toBe(false);
  });

  it("rejects a missing value on PUT", () => {
    const body: Record<string, unknown> = {};
    expect(parseDueSoonDaysInput(body.dueSoonDays).ok).toBe(false);
  });

  it("never clamps — invalid input is an error, not a coerced value", () => {
    const r = parseDueSoonDaysInput(500);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/between 0 and 365/);
  });

  it("resolves invalid stored values to the default 30", () => {
    expect(normalizeStoredDueSoonDays(null)).toBe(30);
    expect(normalizeStoredDueSoonDays(undefined)).toBe(30);
    expect(normalizeStoredDueSoonDays(-5)).toBe(30);
    expect(normalizeStoredDueSoonDays(1000)).toBe(30);
    expect(normalizeStoredDueSoonDays(7.5)).toBe(30);
    expect(normalizeStoredDueSoonDays("14")).toBe(30);
    expect(normalizeStoredDueSoonDays(14)).toBe(14);
    expect(normalizeStoredDueSoonDays(0)).toBe(0);
  });
});

describe("immediate runtime effect (no snapshot recalculation)", () => {
  const today = "2026-08-21";

  it("remaining 10 flips Due Soon -> Active when the window drops to 7", () => {
    const row = { expiryDate: "2026-08-31", todayMalaysiaDate: today };
    expect(classifyEntitlement({ ...row, dueSoonDays: 30 })).toEqual({
      remainingDays: 10,
      status: "Due Soon",
    });
    expect(classifyEntitlement({ ...row, dueSoonDays: 7 })).toEqual({
      remainingDays: 10,
      status: "Active",
    });
  });

  it("expired rows stay Overdue at every threshold", () => {
    const row = { expiryDate: "2026-08-20", todayMalaysiaDate: today };
    for (const dueSoonDays of [0, 7, 30, 365]) {
      const r = classifyEntitlement({ ...row, dueSoonDays });
      expect(r.remainingDays).toBe(-1);
      expect(r.status).toBe("Overdue");
    }
  });

  it("boundary days follow the canonical inclusive rule", () => {
    const at = (expiry: string, dueSoonDays: number) =>
      classifyEntitlement({ expiryDate: expiry, todayMalaysiaDate: today, dueSoonDays }).status;
    expect(at("2026-09-20", 30)).toBe("Due Soon"); // remaining 30
    expect(at("2026-09-21", 30)).toBe("Active"); // remaining 31
    expect(at("2026-08-21", 0)).toBe("Due Soon"); // remaining 0
    expect(at("2026-08-22", 0)).toBe("Active"); // remaining 1
  });
});

describe("server policy path wiring", () => {
  it("the entitlement clock resolves the tenant threshold via the shared normalizer", () => {
    const src = read("src/lib/qne/entitlements/temporal.server.ts");
    expect(src).toContain("normalizeStoredDueSoonDays(data?.due_soon_days)");
    expect(src).toContain('.eq("tenant_code", tenantCode)');
    // No second literal default.
    expect(src).not.toContain("v >= 0 ? v : 30");
  });

  it("every operational surface reaches the threshold through entitlementClock", () => {
    expect(read("src/routes/api/workspace/customer-subscriptions.ts")).toContain(
      "entitlementClock(user.tenantCode)",
    );
    expect(read("src/routes/api/admin/dashboard.ts")).toContain(
      "entitlementClock(user.tenantCode)",
    );
    expect(read("src/routes/api/workspace/jobs.ts")).toContain("entitlementClock");
    const query = read("src/lib/qne/entitlements/query.server.ts");
    expect(query).toContain("entitlementClock(tenantCode)");
    expect(query).toContain("deriveRows(candidates, c)");
  });
});

describe("settings API contract", () => {
  const src = read("src/routes/api/settings/entitlement-policy.ts");

  it("is Owner/Administrator only for both methods", () => {
    expect(src.match(/requireAdministrator\(request\)/g)?.length).toBe(2);
  });

  it("resolves the tenant server-side and accepts no browser tenant", () => {
    expect(src).toContain("user.tenantCode");
    expect(src).not.toContain("body.tenant");
    expect(src).not.toContain("searchParams.get(\"tenant");
  });

  it("validates through the shared policy contract and returns 400", () => {
    expect(src).toContain("parseDueSoonDaysInput(body.dueSoonDays)");
    expect(src).toContain("status: 400");
  });

  it("writes only due_soon_days and never rewrites extra", () => {
    expect(src).toContain("due_soon_days: parsed.value");
    expect(src).not.toContain("extra");
  });

  it("audits changes with old/new value and actor, skipping no-change saves", () => {
    expect(src).toContain("auditSettings");
    expect(src).toContain("entitlement_policy");
    expect(src).toContain("{ dueSoonDays: before }");
    expect(src).toContain("{ dueSoonDays: parsed.value }");
    expect(src).toContain("changed: false");
  });

  it("returns the persisted effective value", () => {
    expect(src).toContain("const saved = await resolveDueSoonDays(user.tenantCode)");
    expect(src).toContain("dueSoonDays: saved");
  });

  it("leaks no secrets", () => {
    expect(src).not.toMatch(/SERVICE_ROLE|bearer|N3_PASSWORD/i);
  });
});

describe("settings UI contract", () => {
  const card = read("src/components/qne/EntitlementPolicyCard.tsx");
  const settings = read("src/routes/settings.tsx");

  it("mounts the Entitlement Policy card between Categories and Cancellation", () => {
    expect(settings).toContain("<EntitlementPolicyCard onNotify={notify} />");
    const cat = settings.indexOf("<SubscriptionCategoriesPanel");
    const ent = settings.indexOf("<EntitlementPolicyCard");
    const can = settings.indexOf("<CancellationSettingsCard");
    expect(cat).toBeGreaterThan(-1);
    expect(ent).toBeGreaterThan(cat);
    expect(can).toBeGreaterThan(ent);
  });

  it("keeps the existing Settings surfaces", () => {
    expect(settings).toContain("<CancellationSettingsCard");
    expect(settings).toContain("<RoleDiagnostics />");
    expect(settings).toContain('"renewal", "adhoc", "diagnostics"');
    expect(settings).toContain("AdminOnly");
  });

  it("loads, validates, saves and reflects the server value", () => {
    expect(card).toContain("/api/settings/entitlement-policy");
    expect(card).toContain('method: "PUT"');
    expect(card).toContain("Loading…");
    expect(card).toContain("Saving…");
    expect(card).toContain("isValidDueSoonDays(parsed)");
    expect(card).toContain("DUE_SOON_RANGE_MESSAGE");
    expect(card).toContain("setSaved(persisted)");
    expect(card).toContain("Snapshot recalculation is not required");
  });
});
