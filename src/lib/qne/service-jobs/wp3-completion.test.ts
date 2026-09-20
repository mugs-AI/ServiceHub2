// WP3 — pure rules: authority, readiness, strict input, display state.

import { describe, expect, it } from "vitest";

import {
  COMPLETION_BLOCKED_STATUSES,
  LEGACY_COMPLETION_LABEL,
  MAX_RESOLUTION_SUMMARY,
  canCompleteJob,
  completionBlockedReason,
  completionView,
  parseCompletionInput,
} from "./wp3-completion";

const job = (over: Partial<Parameters<typeof completionBlockedReason>[0]> = {}) => ({
  status: "In Progress",
  is_deleted: false,
  assigned_user_id: "tech-1",
  ...over,
});

describe("authority", () => {
  it("allows the canonical assigned technician", () => {
    expect(canCompleteJob({ actorUserId: "tech-1", isAdmin: false }, job())).toBe(true);
  });

  it("allows Owner/Admin even when not assigned", () => {
    expect(canCompleteJob({ actorUserId: "boss", isAdmin: true }, job())).toBe(true);
  });

  it("denies an unassigned teammate", () => {
    expect(canCompleteJob({ actorUserId: "helper", isAdmin: false }, job())).toBe(false);
  });

  it("denies an unresolved actor, admin flag or not", () => {
    expect(canCompleteJob({ actorUserId: null, isAdmin: false }, job())).toBe(false);
    expect(canCompleteJob({ actorUserId: null, isAdmin: true }, job())).toBe(false);
  });

  it("denies when the Job has no assignee and the actor is not an admin", () => {
    expect(
      canCompleteJob({ actorUserId: "tech-1", isAdmin: false }, job({ assigned_user_id: null })),
    ).toBe(false);
  });
});

describe("readiness", () => {
  it("allows an eligible active Job with no open attendance", () => {
    expect(completionBlockedReason(job(), 0)).toBeNull();
  });

  it("blocks deleted, cancelled, pending approval and already completed Jobs", () => {
    expect(completionBlockedReason(job({ is_deleted: true }), 0)).toMatch(/Deleted/);
    expect(completionBlockedReason(job({ status: "Cancelled" }), 0)).toMatch(/Cancelled/);
    expect(completionBlockedReason(job({ status: "Pending Approval" }), 0)).toMatch(/Pending/);
    expect(completionBlockedReason(job({ status: "Completed" }), 0)).toMatch(/already completed/);
    for (const s of COMPLETION_BLOCKED_STATUSES) {
      expect(completionBlockedReason(job({ status: s }), 0)).not.toBeNull();
    }
  });

  it("blocks while on-site attendance is still open, and not once closed", () => {
    expect(completionBlockedReason(job(), 1)).toMatch(/Clock out/);
    expect(completionBlockedReason(job(), 0)).toBeNull();
  });
});

describe("strict input parsing", () => {
  it("requires a trimmed non-empty summary", () => {
    for (const bad of [undefined, null, "", "   ", 5, true, [], {}]) {
      expect(parseCompletionInput({ resolution_summary: bad }).ok).toBe(false);
    }
  });

  it("rejects an over-limit summary and accepts the maximum", () => {
    const max = "x".repeat(MAX_RESOLUTION_SUMMARY);
    expect(parseCompletionInput({ resolution_summary: max }).ok).toBe(true);
    expect(parseCompletionInput({ resolution_summary: max + "x" }).ok).toBe(false);
  });

  it("does not coerce the follow-up flag", () => {
    expect(parseCompletionInput({ resolution_summary: "done", follow_up_required: "yes" }).ok).toBe(
      false,
    );
    const r = parseCompletionInput({ resolution_summary: " done ", follow_up_required: true });
    expect(r).toEqual({
      ok: true,
      value: { resolution_summary: "done", follow_up_required: true },
    });
    const d = parseCompletionInput({ resolution_summary: "done" });
    expect(d.ok && d.value.follow_up_required).toBe(false);
  });
});

describe("display state", () => {
  const record = {
    resolution_summary: "Reinstalled module",
    follow_up_required: true,
    completed_by_user_id: "tech-1",
    completed_by_name_snapshot: "Tech One",
    completed_at: "2026-09-17T06:00:00.000Z",
  };

  it("shows the form for an eligible active Job", () => {
    expect(
      completionView({
        status: "In Progress",
        is_deleted: false,
        record: null,
        blockedReason: null,
      }),
    ).toEqual({ mode: "form" });
  });

  it("locks a completed Job with its evidence", () => {
    expect(
      completionView({ status: "Completed", is_deleted: false, record, blockedReason: null }),
    ).toEqual({ mode: "locked", record });
  });

  it("labels a historically completed Job with no completion record", () => {
    expect(
      completionView({ status: "Completed", is_deleted: false, record: null, blockedReason: null }),
    ).toEqual({ mode: "legacy", label: LEGACY_COMPLETION_LABEL });
    expect(LEGACY_COMPLETION_LABEL).toBe("Legacy completion — no completion evidence");
  });

  it("surfaces a blocking reason instead of the form", () => {
    expect(
      completionView({
        status: "In Progress",
        is_deleted: false,
        record: null,
        blockedReason: "Clock out of on-site attendance before completing this Job.",
      }).mode,
    ).toBe("blocked");
  });
});
