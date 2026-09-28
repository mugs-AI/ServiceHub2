import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  INQUIRY_KEYS,
  NORMAL_USER_DEFAULT,
  NORMAL_USER_ROLE,
  OWNER_ADMIN_ACCESS,
  isInquiryKey,
  permissionFromRow,
  resolveInquiryAccess,
  validateInquiryPermission,
  type StoredInquiryRow,
} from "./permissions";
import { validateTravelGpsPatch } from "@/lib/qne/service-jobs/tenant-settings";

const read = (p: string) => readFileSync(p, "utf8");
const row = (over: Partial<StoredInquiryRow> = {}): StoredInquiryRow => ({
  report_code: "job_details_inquiry",
  role: NORMAL_USER_ROLE,
  can_view: true,
  can_export_excel: false,
  data_scope: "own",
  view_private_notes: false,
  view_gps: false,
  ...over,
});

describe("WP4 inquiry keys", () => {
  it("exposes exactly the two WP5 keys", () => {
    expect([...INQUIRY_KEYS]).toEqual(["job_details_inquiry", "timeline_history_inquiry"]);
  });
  it("resolver accepts only the two keys", () => {
    expect(isInquiryKey("job_details_inquiry")).toBe(true);
    expect(isInquiryKey("timeline_history_inquiry")).toBe(true);
    for (const bad of ["audit_trail", "service_job_listing", "", null, 1]) {
      expect(isInquiryKey(bad)).toBe(false);
    }
  });
});

describe("Owner/Admin immutable full access", () => {
  it("ignores any stored restriction", () => {
    const stored = row({ can_view: false, data_scope: "own" });
    expect(resolveInquiryAccess({ isOwnerAdmin: true }, stored)).toEqual(OWNER_ADMIN_ACCESS);
    expect(OWNER_ADMIN_ACCESS.scope).toBe("all");
    expect(Object.isFrozen(OWNER_ADMIN_ACCESS)).toBe(true);
  });
});

describe("Normal User fail-closed defaults", () => {
  it("no row means no access", () => {
    expect(resolveInquiryAccess({ isOwnerAdmin: false }, null)).toEqual(NORMAL_USER_DEFAULT);
    expect(NORMAL_USER_DEFAULT).toEqual({
      can_view: false,
      scope: "own",
      can_export_excel: false,
      view_private_notes: false,
      view_gps: false,
    });
  });
  it("rows for other roles are ignored", () => {
    expect(permissionFromRow(row({ role: "coordinator" }))).toEqual(NORMAL_USER_DEFAULT);
  });
  it("contradictory stored rows fail closed", () => {
    expect(permissionFromRow(row({ can_view: false, can_export_excel: true }))).toEqual(
      NORMAL_USER_DEFAULT,
    );
  });
  it.each([
    ["can_export_excel", { can_export_excel: true }],
    ["view_private_notes", { view_private_notes: true }],
    ["view_gps", { view_gps: true }],
  ])("grants %s only when stored", (key, over) => {
    const p = permissionFromRow(row(over));
    expect(p.can_view).toBe(true);
    expect(p[key as keyof typeof p]).toBe(true);
  });
  it("scope own vs all", () => {
    expect(permissionFromRow(row()).scope).toBe("own");
    expect(permissionFromRow(row({ data_scope: "all" })).scope).toBe("all");
    expect(permissionFromRow(row({ data_scope: "team" })).scope).toBe("own");
  });
});

describe("contradiction validation", () => {
  const base = { ...NORMAL_USER_DEFAULT };
  it("accepts closed default and a valid grant", () => {
    expect(validateInquiryPermission(base).ok).toBe(true);
    expect(
      validateInquiryPermission({ ...base, can_view: true, scope: "all", view_gps: true }).ok,
    ).toBe(true);
  });
  it.each([
    { can_export_excel: true },
    { view_private_notes: true },
    { view_gps: true },
    { scope: "all" },
  ])("rejects %o without view", (over) => {
    expect(validateInquiryPermission({ ...base, ...over }).ok).toBe(false);
  });
  it("rejects malformed input", () => {
    expect(validateInquiryPermission(null).ok).toBe(false);
    expect(validateInquiryPermission({ ...base, can_view: "yes" }).ok).toBe(false);
    expect(validateInquiryPermission({ ...base, scope: "team" }).ok).toBe(false);
  });
});

describe("server boundaries", () => {
  const api = read("src/routes/api/settings/reports.ts");
  const guard = read("src/lib/qne/inquiry/permissions.server.ts");
  it("API rejects non-admin writes and never reads tenant from the body", () => {
    expect(api).toMatch(/if \(!user\.isAdministrator\)[\s\S]*status: 403/);
    expect(api).toContain("tenant_code: user.tenantCode");
    expect(api).not.toMatch(/body\.tenant/);
    expect(api).toContain("validateInquiryPermission");
    expect(api).toContain("isInquiryKey(body.key)");
  });
  it("API audits before/after with actor", () => {
    expect(api).toMatch(/auditSettings\([\s\S]*before[\s\S]*next[\s\S]*matchedN3UserId/);
  });
  it("guard is tenant-scoped, server-only and fails closed", () => {
    expect(guard).toContain('.eq("tenant_code", tenantCode)');
    expect(guard).toContain("client.server");
    expect(guard).toContain("throw new ForbiddenError()");
  });
  it("tenant PUT validates Travel/GPS", () => {
    expect(read("src/routes/api/settings/tenant.ts")).toContain("validateTravelGpsPatch");
    expect(validateTravelGpsPatch(undefined)).toBeNull();
    expect(
      validateTravelGpsPatch({ mode: "optional", events: { travel_started: true } }),
    ).toBeNull();
    expect(validateTravelGpsPatch({ mode: "always" })).not.toBeNull();
    expect(validateTravelGpsPatch({ mode: "off", events: { hack: true } })).not.toBeNull();
  });
});

describe("settings UI", () => {
  const ui = read("src/components/qne/SystemOptionsCards.tsx");
  const page = read("src/routes/settings.tsx");
  it("mounts the WP4 cards", () => {
    for (const c of [
      "TravelGpsCard",
      "InquiryAccessCard",
      "AttachmentPolicyCard",
      "CompletionPolicyCard",
      "CancellationSettingsCard",
      "GoogleDriveCard",
      "EntitlementPolicyCard",
      "SubscriptionCategoriesPanel",
    ]) {
      expect(page).toContain(`<${c}`);
    }
  });
  it("exposes no speculative roles or unsupported providers", () => {
    for (const bad of [
      "coordinator",
      "support_pic",
      "reports_viewer",
      "S3",
      "Google Cloud Storage",
    ]) {
      expect(ui).not.toContain(bad);
      expect(page).not.toContain(bad);
    }
  });
  it("creates no WP5 inquiry route", () => {
    expect(() => read("src/routes/inquiry.tsx")).toThrow();
    expect(read("src/routeTree.gen.ts")).not.toMatch(/inquiry/i);
  });
});
