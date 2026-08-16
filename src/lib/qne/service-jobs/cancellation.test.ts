// WP0E-R — cancellation policy unit coverage.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_CANCELLATION_SETTINGS,
  canRequestCancellation,
  cancelActionLabel,
  evaluateCancellationRequest,
  isCancellableStatus,
  mergeCancellationSettings,
  normalizeReason,
  type CancelRequesterPolicy,
} from "./cancellation";
import { DEFAULT_TENANT_SETTINGS, mergeTenantSettings } from "./tenant-settings";

const job = {
  status: "In Progress",
  isDeleted: false,
  createdByUserId: "u-creator",
  assignedUserId: "u-pic",
};

describe("R.1 cancellation settings defaults & merge", () => {
  it("defaults are backward compatible", () => {
    expect(DEFAULT_CANCELLATION_SETTINGS).toEqual({
      requesterPolicy: "primary_pic_or_creator",
      approvalMode: "admin_approval_required",
    });
    expect(DEFAULT_TENANT_SETTINGS.cancellation).toEqual(DEFAULT_CANCELLATION_SETTINGS);
  });

  it("a tenant with no cancellation settings merges to the defaults", () => {
    const merged = mergeTenantSettings({ travelGps: { mode: "off" } });
    expect(merged.cancellation).toEqual(DEFAULT_CANCELLATION_SETTINGS);
    expect(merged.travelGps.mode).toBe("off");
  });

  it("stored values survive a merge round-trip", () => {
    const merged = mergeTenantSettings({
      cancellation: { requesterPolicy: "admin_only", approvalMode: "direct" },
    });
    expect(merged.cancellation).toEqual({
      requesterPolicy: "admin_only",
      approvalMode: "direct",
    });
  });

  it("invalid stored values fall back to defaults", () => {
    expect(mergeCancellationSettings({ requesterPolicy: "everyone", approvalMode: "yolo" })).toEqual(
      DEFAULT_CANCELLATION_SETTINGS,
    );
    expect(mergeCancellationSettings(null)).toEqual(DEFAULT_CANCELLATION_SETTINGS);
  });
});

describe("R.2 requester policies", () => {
  const admin = { isAdministrator: true, actorUserId: "u-admin" };
  const pic = { isAdministrator: false, actorUserId: "u-pic" };
  const creator = { isAdministrator: false, actorUserId: "u-creator" };
  const helper = { isAdministrator: false, actorUserId: "u-helper" };
  const anon = { isAdministrator: false, actorUserId: null };

  it("admin_only: Admin allowed, Normal User denied", () => {
    expect(canRequestCancellation("admin_only", admin, job)).toBe(true);
    expect(canRequestCancellation("admin_only", pic, job)).toBe(false);
    expect(canRequestCancellation("admin_only", creator, job)).toBe(false);
  });

  it("primary_pic_or_creator: creator and PIC allowed, unrelated helper denied", () => {
    expect(canRequestCancellation("primary_pic_or_creator", creator, job)).toBe(true);
    expect(canRequestCancellation("primary_pic_or_creator", pic, job)).toBe(true);
    expect(canRequestCancellation("primary_pic_or_creator", helper, job)).toBe(false);
    expect(canRequestCancellation("primary_pic_or_creator", admin, job)).toBe(true);
  });

  it("any_support_user: any authenticated same-tenant support user allowed", () => {
    expect(canRequestCancellation("any_support_user", helper, job)).toBe(true);
  });

  it("an unidentified actor is denied under every non-admin policy", () => {
    for (const p of [
      "admin_only",
      "primary_pic_or_creator",
      "any_support_user",
    ] as CancelRequesterPolicy[]) {
      expect(canRequestCancellation(p, anon, job)).toBe(false);
    }
  });
});

describe("R.3 state and reason validation", () => {
  const settings = DEFAULT_CANCELLATION_SETTINGS;
  const actor = { isAdministrator: true, actorUserId: "u-admin" };

  it("terminal jobs cannot be cancelled", () => {
    for (const status of ["Completed", "Cancelled"]) {
      expect(isCancellableStatus(status)).toBe(false);
      const r = evaluateCancellationRequest({
        settings,
        actor,
        job: { ...job, status },
        reason: "stop",
        hasActiveRequest: false,
      });
      expect(r).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("deleted jobs cannot be cancelled", () => {
    const r = evaluateCancellationRequest({
      settings,
      actor,
      job: { ...job, isDeleted: true },
      reason: "stop",
      hasActiveRequest: false,
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("missing and blank reasons are rejected", () => {
    for (const reason of [null, "", "   "]) {
      const r = evaluateCancellationRequest({
        settings,
        actor,
        job,
        reason,
        hasActiveRequest: false,
      });
      expect(r).toMatchObject({ ok: false, status: 400 });
    }
    expect(normalizeReason("  ")).toBeNull();
    expect(normalizeReason(" ok ")).toBe("ok");
  });

  it("an unrelated helper is denied with 403 under the default policy", () => {
    const r = evaluateCancellationRequest({
      settings,
      actor: { isAdministrator: false, actorUserId: "u-helper" },
      job,
      reason: "customer changed mind",
      hasActiveRequest: false,
    });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("a second active request is rejected with 409", () => {
    const r = evaluateCancellationRequest({
      settings,
      actor,
      job,
      reason: "duplicate",
      hasActiveRequest: true,
    });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
});

describe("R.4 effect selection and wording", () => {
  it("direct mode cancels now", () => {
    const r = evaluateCancellationRequest({
      settings: { requesterPolicy: "any_support_user", approvalMode: "direct" },
      actor: { isAdministrator: false, actorUserId: "u-helper" },
      job,
      reason: "duplicate job",
      hasActiveRequest: false,
    });
    expect(r).toEqual({ ok: true, effect: "cancel_now" });
    expect(cancelActionLabel("direct")).toBe("Cancel Job");
  });

  it("approval mode requests approval", () => {
    const r = evaluateCancellationRequest({
      settings: DEFAULT_CANCELLATION_SETTINGS,
      actor: { isAdministrator: false, actorUserId: "u-pic" },
      job,
      reason: "customer withdrew",
      hasActiveRequest: false,
    });
    expect(r).toEqual({ ok: true, effect: "request_approval" });
    expect(cancelActionLabel("admin_approval_required")).toBe("Request Cancellation");
  });
});
