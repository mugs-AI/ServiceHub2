// WP3B — follow-up lifecycle: pure rule and accounting tests.

import { describe, expect, it } from "vitest";

import {
  countScopes,
  outcomesForQueue,
  queueForCard,
  resolvedAtFor,
} from "@/lib/qne/dashboard/followup-scope";
import {
  canClearFollowup,
  deriveOutcome,
  followupBlockedReason,
  followupView,
  isResolvedOutcome,
  MAX_FOLLOWUP_NOTE,
  outcomeTotals,
  OUTCOME_LABEL,
  parseFollowupClearInput,
} from "./wp3b-followup";

import type { FollowupRow } from "./wp3b-followup";

const completedJob = {
  status: "Completed",
  is_deleted: false,
  assigned_user_id: "TECH1",
};

function followup(over: Partial<FollowupRow> = {}): FollowupRow {
  return {
    id: "fu-1",
    completion_cycle: 1,
    state: "open",
    opened_at: "2026-09-01T02:00:00.000Z",
    resolved_at: null,
    resolved_by_user_id: null,
    resolved_by_name_snapshot: null,
    resolution_note: null,
    reopened_at: null,
    ...over,
  };
}

describe("WP3B outcome derivation", () => {
  it("no follow-up tick is Resolved at Completion", () => {
    expect(
      deriveOutcome({
        jobStatus: "Completed",
        isDeleted: false,
        completion: { follow_up_required: false },
        followup: null,
        hasPendingReopen: false,
      }),
    ).toBe("resolved_at_completion");
  });

  it("a ticked follow-up is Follow-up Open", () => {
    expect(
      deriveOutcome({
        jobStatus: "Completed",
        isDeleted: false,
        completion: { follow_up_required: true },
        followup: { state: "open" },
        hasPendingReopen: false,
      }),
    ).toBe("follow_up_open");
  });

  it("clearing the follow-up becomes Resolved after Follow-up", () => {
    expect(
      deriveOutcome({
        jobStatus: "Completed",
        isDeleted: false,
        completion: { follow_up_required: true },
        followup: { state: "resolved" },
        hasPendingReopen: false,
      }),
    ).toBe("resolved_after_follow_up");
  });

  it("a pending reopen request is Reopen Pending and does not touch evidence", () => {
    expect(
      deriveOutcome({
        jobStatus: "Completed",
        isDeleted: false,
        completion: { follow_up_required: true },
        followup: { state: "open" },
        hasPendingReopen: true,
      }),
    ).toBe("reopen_pending");
  });

  it("rejection returns to the previous closure outcome", () => {
    const before = deriveOutcome({
      jobStatus: "Completed",
      isDeleted: false,
      completion: { follow_up_required: false },
      followup: null,
      hasPendingReopen: false,
    });
    const pending = deriveOutcome({
      jobStatus: "Completed",
      isDeleted: false,
      completion: { follow_up_required: false },
      followup: null,
      hasPendingReopen: true,
    });
    const after = deriveOutcome({
      jobStatus: "Completed",
      isDeleted: false,
      completion: { follow_up_required: false },
      followup: null,
      hasPendingReopen: false,
    });
    expect(pending).toBe("reopen_pending");
    expect(after).toBe(before);
  });

  it("approval leaves the Job outside Completed totals", () => {
    expect(
      deriveOutcome({
        jobStatus: "In Progress",
        isDeleted: false,
        completion: { follow_up_required: true },
        followup: { state: "reopened" },
        hasPendingReopen: false,
      }),
    ).toBeNull();
  });

  it("a Completed Job without modern evidence is Legacy/Unknown, never Resolved", () => {
    const outcome = deriveOutcome({
      jobStatus: "Completed",
      isDeleted: false,
      completion: null,
      followup: null,
      hasPendingReopen: false,
    });
    expect(outcome).toBe("legacy_unknown");
    expect(isResolvedOutcome(outcome)).toBe(false);
    expect(OUTCOME_LABEL.legacy_unknown).toBe("Legacy completion");
  });

  it("formula parity: Completed = Resolved + Follow-up Open + Reopen Pending", () => {
    const totals = outcomeTotals([
      "resolved_at_completion",
      "resolved_after_follow_up",
      "follow_up_open",
      "reopen_pending",
      "legacy_unknown",
      null,
    ]);
    expect(totals.resolved).toBe(2);
    expect(totals.followUpOpen).toBe(1);
    expect(totals.reopenPending).toBe(1);
    expect(totals.legacyUnknown).toBe(1);
    expect(totals.completed).toBe(totals.resolved + totals.followUpOpen + totals.reopenPending);
  });
});

describe("WP3B clear follow-up rules", () => {
  it("requires a trimmed, bounded result note", () => {
    expect(parseFollowupClearInput({}).ok).toBe(false);
    expect(parseFollowupClearInput({ resolution_note: "   " }).ok).toBe(false);
    expect(parseFollowupClearInput({ resolution_note: 12 as unknown }).ok).toBe(false);
    expect(parseFollowupClearInput({ resolution_note: "x".repeat(MAX_FOLLOWUP_NOTE + 1) }).ok).toBe(
      false,
    );
    const ok = parseFollowupClearInput({ resolution_note: "  done  " });
    expect(ok).toEqual({ ok: true, value: "done" });
  });

  it("only the assigned technician or an administrator may clear", () => {
    expect(canClearFollowup({ actorUserId: "TECH1", isAdmin: false }, completedJob)).toBe(true);
    expect(canClearFollowup({ actorUserId: "OTHER", isAdmin: false }, completedJob)).toBe(false);
    expect(canClearFollowup({ actorUserId: "OTHER", isAdmin: true }, completedJob)).toBe(true);
    expect(canClearFollowup({ actorUserId: null, isAdmin: true }, completedJob)).toBe(false);
  });

  it("blocks clearing outside a Completed Job with an open follow-up", () => {
    expect(followupBlockedReason(completedJob, followup())).toBeNull();
    expect(followupBlockedReason({ ...completedJob, status: "In Progress" }, followup())).toMatch(
      /Completed/,
    );
    expect(followupBlockedReason({ ...completedJob, is_deleted: true }, followup())).toMatch(
      /Deleted/,
    );
    expect(followupBlockedReason(completedJob, null)).toMatch(/no follow-up/);
    expect(followupBlockedReason(completedJob, followup({ state: "resolved" }))).toMatch(
      /already been cleared/,
    );
    expect(followupBlockedReason(completedJob, followup({ state: "reopened" }))).toMatch(
      /no longer open/,
    );
  });

  it("the card view exposes exactly one follow-up control per state", () => {
    expect(
      followupView({
        job: completedJob,
        followup: null,
        actor: { actorUserId: "TECH1", isAdmin: false },
      }),
    ).toEqual({ mode: "hidden" });

    expect(
      followupView({
        job: completedJob,
        followup: followup(),
        actor: { actorUserId: "TECH1", isAdmin: false },
      }),
    ).toEqual({ mode: "open", canClear: true });

    expect(
      followupView({
        job: completedJob,
        followup: followup(),
        actor: { actorUserId: "OTHER", isAdmin: false },
      }),
    ).toEqual({ mode: "open", canClear: false });

    const resolved = followup({
      state: "resolved",
      resolved_at: "2026-09-02T03:00:00.000Z",
      resolution_note: "Patched",
    });
    expect(
      followupView({
        job: completedJob,
        followup: resolved,
        actor: { actorUserId: "TECH1", isAdmin: false },
      }),
    ).toEqual({ mode: "resolved", record: resolved });

    expect(
      followupView({
        job: { ...completedJob, status: "In Progress" },
        followup: followup({ state: "reopened", reopened_at: "2026-09-03T00:00:00.000Z" }),
        actor: { actorUserId: "TECH1", isAdmin: true },
      }),
    ).toEqual({ mode: "reopened" });
  });
});

describe("WP3B dashboard scopes", () => {
  const from = "2026-09-10T16:00:00.000Z"; // MYT day start
  const to = "2026-09-11T16:00:00.000Z";

  const rows = [
    {
      outcome: "resolved_at_completion" as const,
      assigned_user_id: "ME",
      completed_at: "2026-09-10T20:00:00.000Z",
      followup_resolved_at: null,
    },
    {
      outcome: "resolved_after_follow_up" as const,
      assigned_user_id: "ME",
      completed_at: "2026-08-01T00:00:00.000Z",
      followup_resolved_at: "2026-09-10T22:00:00.000Z",
    },
    {
      outcome: "follow_up_open" as const,
      assigned_user_id: "ME",
      completed_at: "2026-09-01T00:00:00.000Z",
      followup_resolved_at: null,
    },
    {
      outcome: "reopen_pending" as const,
      assigned_user_id: "OTHER",
      completed_at: "2026-09-02T00:00:00.000Z",
      followup_resolved_at: null,
    },
    {
      outcome: "legacy_unknown" as const,
      assigned_user_id: "OTHER",
      completed_at: null,
      followup_resolved_at: null,
    },
  ];

  it("counts each card scope from one shared definition", () => {
    const c = countScopes(rows, { meUserId: "ME", todayFromIso: from, todayToIso: to });
    expect(c).toMatchObject({
      completed: 4,
      resolved: 2,
      followUpOpen: 1,
      reopenPending: 1,
      legacyUnknown: 1,
      resolvedToday: 2,
      myFollowUps: 1,
      myReopenPending: 0,
      resolvedByMeToday: 2,
    });
    expect(c.completed).toBe(c.resolved + c.followUpOpen + c.reopenPending);
  });

  it("Resolved Today uses the clear time for a cleared follow-up", () => {
    expect(resolvedAtFor(rows[1]!)).toBe("2026-09-10T22:00:00.000Z");
    expect(resolvedAtFor(rows[0]!)).toBe("2026-09-10T20:00:00.000Z");
    expect(resolvedAtFor(rows[2]!)).toBeNull();
  });

  it("each card opens the queue that selects exactly the outcomes it counted", () => {
    expect(outcomesForQueue(queueForCard("followUpOpen"))).toEqual(["follow_up_open"]);
    expect(outcomesForQueue(queueForCard("myFollowUps"))).toEqual(["follow_up_open"]);
    expect(outcomesForQueue(queueForCard("reopenPending"))).toEqual(["reopen_pending"]);
    expect(outcomesForQueue(queueForCard("resolvedToday"))).toEqual([
      "resolved_at_completion",
      "resolved_after_follow_up",
    ]);
    // Legacy/Unknown is never selected by a WP3B queue.
    for (const key of ["follow_up_open", "reopen_pending", "resolved"] as const) {
      expect(outcomesForQueue(key)).not.toContain("legacy_unknown");
    }
  });
});
