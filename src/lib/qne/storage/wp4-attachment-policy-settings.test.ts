// WP4 correction — tenant-configurable Job attachment policy, inquiry save
// UX and System Options tabs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ALLOWED_EXTENSION_KEYS,
  DEFAULT_JOB_ATTACHMENT_LIMITS,
  HARD_POLICY,
  MAX_ACTIVE_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  POLICY_BOUNDS,
  acceptAttributeFor,
  resolveEffectivePolicy,
  validateCandidate,
  validateJobAttachmentLimits,
  validateQuota,
} from "./attachment-policy";
import {
  DEFAULT_TENANT_SETTINGS,
  mergeTenantSettings,
} from "@/lib/qne/service-jobs/tenant-settings";
import { SECTION_NAV, sectionFromHash } from "@/lib/qne/settings-sections";
import { validateInquiryPermission } from "@/lib/qne/inquiry/permissions";

const MB = 1024 * 1024;
const read = (p: string) => readFileSync(p, "utf8");
const limits = (over: Record<string, unknown> = {}) => ({
  maxFileMB: 5,
  maxFiles: 3,
  maxTotalMB: 10,
  allowedExtensions: ["pdf", "jpg"],
  ...over,
});

describe("tenant attachment limits — validation", () => {
  it("defaults equal today's hard caps and full allowlist", () => {
    expect(DEFAULT_JOB_ATTACHMENT_LIMITS.maxFileMB * MB).toBe(MAX_FILE_BYTES);
    expect(DEFAULT_JOB_ATTACHMENT_LIMITS.maxFiles).toBe(MAX_ACTIVE_FILES);
    expect(DEFAULT_JOB_ATTACHMENT_LIMITS.maxTotalMB * MB).toBe(MAX_TOTAL_BYTES);
    expect(DEFAULT_TENANT_SETTINGS.jobAttachments.allowedExtensions).toEqual([
      ...ALLOWED_EXTENSION_KEYS,
    ]);
    expect(resolveEffectivePolicy(undefined)).toEqual(HARD_POLICY);
  });

  it("accepts a valid lowered policy and normalises extensions", () => {
    const v = validateJobAttachmentLimits(limits({ allowedExtensions: ["JPG", "pdf", "pdf"] }));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.allowedExtensions).toEqual(["jpg", "pdf"]);
  });

  it("rejects values above the hard caps, non-integers and zero", () => {
    expect(
      validateJobAttachmentLimits(limits({ maxFileMB: POLICY_BOUNDS.maxFileMB.max + 1 })).ok,
    ).toBe(false);
    expect(validateJobAttachmentLimits(limits({ maxFiles: MAX_ACTIVE_FILES + 1 })).ok).toBe(false);
    expect(validateJobAttachmentLimits(limits({ maxTotalMB: 101 })).ok).toBe(false);
    expect(validateJobAttachmentLimits(limits({ maxFileMB: 2.5 })).ok).toBe(false);
    expect(validateJobAttachmentLimits(limits({ maxFiles: 0 })).ok).toBe(false);
    expect(validateJobAttachmentLimits(limits({ maxFileMB: "5" })).ok).toBe(false);
  });

  it("rejects invalid combinations and unsafe or unknown types", () => {
    expect(validateJobAttachmentLimits(limits({ maxFileMB: 20, maxTotalMB: 10 })).ok).toBe(false);
    expect(validateJobAttachmentLimits(limits({ allowedExtensions: [] })).ok).toBe(false);
    for (const bad of ["exe", "js", "docm", "mp4", "svg", "image/png", "*"]) {
      expect(validateJobAttachmentLimits(limits({ allowedExtensions: [bad] })).ok).toBe(false);
    }
  });

  it("invalid stored data falls back to hard caps, never wider", () => {
    expect(resolveEffectivePolicy({ maxFileMB: 999, maxFiles: 99, maxTotalMB: 999 })).toEqual(
      HARD_POLICY,
    );
    const merged = mergeTenantSettings({ jobAttachments: { maxFiles: 50 } });
    const eff = resolveEffectivePolicy(merged.jobAttachments);
    expect(eff.maxActiveFiles).toBeLessThanOrEqual(MAX_ACTIVE_FILES);
    expect(eff.maxFileBytes).toBeLessThanOrEqual(MAX_FILE_BYTES);
  });
});

describe("effective policy — upload and quota enforcement", () => {
  const eff = resolveEffectivePolicy(limits());

  it("enforces the lowered per-file limit", () => {
    expect(
      validateCandidate({ name: "a.pdf", type: "application/pdf", size: 5 * MB }, eff).ok,
    ).toBe(true);
    const over = validateCandidate(
      { name: "a.pdf", type: "application/pdf", size: 5 * MB + 1 },
      eff,
    );
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toContain("5 MB");
  });

  it("refuses types outside the tenant subset while hard allowlist would allow them", () => {
    const png = { name: "a.png", type: "image/png", size: 1000 };
    expect(validateCandidate(png).ok).toBe(true);
    expect(validateCandidate(png, eff).ok).toBe(false);
  });

  it("never weakens the blocklist or MIME matching even if a policy lists it", () => {
    const forged = { ...eff, allowedExtensions: ["exe", "pdf"] };
    expect(validateCandidate({ name: "x.exe", type: "application/pdf", size: 10 }, forged).ok).toBe(
      false,
    );
    expect(validateCandidate({ name: "x.pdf", type: "image/png", size: 10 }, eff).ok).toBe(false);
  });

  it("hard caps apply even to a forged over-cap policy object", () => {
    const forged = {
      ...HARD_POLICY,
      maxFileBytes: 10 * MAX_FILE_BYTES,
      maxActiveFiles: 999,
      maxTotalBytes: 10 * MAX_TOTAL_BYTES,
    };
    expect(
      validateCandidate(
        { name: "a.pdf", type: "application/pdf", size: MAX_FILE_BYTES + 1 },
        forged,
      ).ok,
    ).toBe(false);
    expect(validateQuota({ activeCount: MAX_ACTIVE_FILES, activeBytes: 0 }, 1, forged).ok).toBe(
      false,
    );
  });

  it("enforces the lowered file count and total bytes", () => {
    expect(validateQuota({ activeCount: 2, activeBytes: 0 }, MB, eff).ok).toBe(true);
    expect(validateQuota({ activeCount: 3, activeBytes: 0 }, MB, eff).ok).toBe(false);
    expect(validateQuota({ activeCount: 1, activeBytes: 9 * MB }, MB, eff).ok).toBe(true);
    expect(validateQuota({ activeCount: 1, activeBytes: 9 * MB }, MB + 1, eff).ok).toBe(false);
  });

  it("a Job already over a tightened limit blocks new uploads only", () => {
    // 5 existing files under a new max of 3: further uploads refused, but the
    // policy has no bearing on listing/reading (see route contract below).
    expect(validateQuota({ activeCount: 5, activeBytes: 50 * MB }, 1, eff).ok).toBe(false);
  });

  it("accept attribute mirrors the effective subset", () => {
    expect(acceptAttributeFor(eff)).toBe(".jpg,.pdf");
  });
});

describe("server wiring", () => {
  const route = read("src/routes/api/workspace/jobs.$jobId.attachments.ts");
  const tenant = read("src/routes/api/settings/tenant.ts");
  const content = read("src/routes/api/workspace/jobs.$jobId.attachments.$attachmentId.content.ts");

  it("upload and quota use the server-resolved tenant policy", () => {
    expect(route).toMatch(/effectivePolicyFor\(user\.tenantCode\)/);
    expect(route).toMatch(/validateCandidate\(candidate, effective\)/);
    expect(route).toMatch(/file\.size,\s*effective,/);
    expect(route).toMatch(/maxFiles: effective\.maxActiveFiles/);
    expect(route).not.toMatch(/searchParams\.get\(["']tenant/);
  });

  it("listing and content reads are not filtered by the policy", () => {
    expect(route).toMatch(/loadActiveAttachments\(user\.tenantCode, params\.jobId\)/);
    expect(content).not.toMatch(/validateCandidate|resolveEffectivePolicy|validateQuota/);
  });

  it("settings PUT is admin-only, validates limits and uses the verified tenant", () => {
    const put = tenant.slice(tenant.indexOf("PUT:"));
    expect(put.indexOf("isAdministrator")).toBeLessThan(put.indexOf("validateJobAttachmentLimits"));
    expect(put).toMatch(/status: 403/);
    expect(put).toMatch(/saveTenantSettings\(\s*user\.tenantCode/);
    expect(put).not.toMatch(/body\.tenant/);
  });

  it("Google Drive card no longer says attachments are unimplemented", () => {
    const drive = read("src/lib/qne/storage/google-drive.ts");
    expect(drive).not.toMatch(/not yet implemented/i);
    expect(read("src/components/qne/GoogleDriveCard.tsx")).toContain("ATTACHMENTS_STORAGE_NOTICE");
  });
});

describe("Inquiry & Export Access", () => {
  const ui = read("src/components/qne/SystemOptionsCards.tsx");
  it("View is the only prerequisite; ticking it unlocks the rest", () => {
    const base = {
      can_view: false,
      scope: "own",
      can_export_excel: false,
      view_private_notes: false,
      view_gps: false,
    };
    expect(validateInquiryPermission(base).ok).toBe(true);
    expect(validateInquiryPermission({ ...base, can_export_excel: true }).ok).toBe(false);
    expect(
      validateInquiryPermission({
        ...base,
        can_view: true,
        can_export_excel: true,
        scope: "all",
        view_gps: true,
      }).ok,
    ).toBe(true);
  });
  it("explains the dependency, shows save errors and reloads after save", () => {
    expect(ui).toContain("Tick View first");
    expect(ui).toMatch(/role="alert"/);
    expect(ui).toMatch(/onSaved=\{\(\) => void load\(\)\}/);
    expect(ui).toMatch(/body\.normalUser \?\? value/);
  });
});

describe("System Options tabs", () => {
  const page = read("src/routes/settings.tsx");
  it("four sections in order, legacy anchors map, default Renewals", () => {
    expect(SECTION_NAV.map((s) => s.label)).toEqual([
      "Renewals & Coverage",
      "Field Work & Jobs",
      "Storage & Attachments",
      "Access",
    ]);
    expect(sectionFromHash("#grp-access")).toBe("grp-access");
    expect(sectionFromHash("")).toBe("grp-renewal");
    expect(sectionFromHash("#nope")).toBe("grp-renewal");
  });
  it("uses a real tablist with hidden panels and keeps every card mounted", () => {
    expect(page).toMatch(/role="tablist"/);
    expect(page).toMatch(/role="tab"/);
    expect(page).toMatch(/role="tabpanel"/);
    expect(page).toMatch(/hidden=\{!active\}/);
    expect(page).toMatch(/ArrowRight/);
    for (const card of [
      "SubscriptionCategoriesPanel",
      "EntitlementPolicyCard",
      "MappingTab",
      "TravelGpsCard",
      "CancellationSettingsCard",
      "GoogleDriveCard",
      "AttachmentPolicyCard onNotify",
      "InquiryAccessCard",
      "AdminAllowlistPanel",
    ]) {
      expect(page).toContain(card);
    }
    expect(page).not.toMatch(/href=\{`#\$\{s\.id\}`\}/);
  });
});
