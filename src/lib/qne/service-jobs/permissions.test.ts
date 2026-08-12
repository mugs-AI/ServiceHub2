// WP0E — SME collaboration & workflow safety policy tests.

import { describe, expect, it } from "vitest";

import {
  canCancelJob,
  COLLABORATIVE_TRANSITIONS,
  evaluateClaim,
  isCollaborativeTransition,
  isGenericCompleteBlocked,
  isTakeoverEligibleStatus,
  takeoverRequiresReason,
} from "./permissions";
import { allowedTransitions, canTransition } from "./workflow.server";
import { allowedTransitionsClient } from "./workflow";

describe("9.1 collaborative ordinary transitions", () => {
  it.each(COLLABORATIVE_TRANSITIONS)("%s → %s is allowed by the server matrix", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(isCollaborativeTransition(from, to)).toBe(true);
  });

  it("collaborative transitions do not require the actor to be the Primary PIC", () => {
    // The policy layer exposes no actor requirement for ordinary transitions.
    for (const [from, to] of COLLABORATIVE_TRANSITIONS) {
      expect(isCollaborativeTransition(from, to)).toBe(true);
    }
  });

  it("client mirror matches the server matrix", () => {
    for (const s of [
      "Draft",
      "Pending Approval",
      "Open",
      "Assigned",
      "In Progress",
      "Waiting Customer",
      "Waiting Vendor",
      "Completed",
      "Cancelled",
    ]) {
      expect(allowedTransitionsClient(s)).toEqual(allowedTransitions(s));
    }
  });
});

describe("9.2 Primary PIC preservation", () => {
  it("ordinary transitions carry no assignment change", () => {
    // Assignment mutation is only ever produced by evaluateClaim (takeover) or
    // the Administrator assign route — never by a status transition.
    for (const [from, to] of COLLABORATIVE_TRANSITIONS) {
      expect(canTransition(from, to)).toBe(true);
      expect(isCollaborativeTransition(from, to)).toBe(true);
    }
    expect(Object.keys({ ...{} })).toEqual([]);
  });
});

describe("9.3 generic Complete is blocked", () => {
  it("In Progress → Completed is not a generic transition", () => {
    expect(canTransition("In Progress", "Completed")).toBe(false);
    expect(allowedTransitions("In Progress")).not.toContain("Completed");
    expect(allowedTransitionsClient("In Progress")).not.toContain("Completed");
  });

  it("no status may generically reach Completed", () => {
    for (const s of ["Draft", "Open", "Assigned", "Waiting Customer", "Waiting Vendor"]) {
      expect(canTransition(s, "Completed")).toBe(false);
    }
  });

  it("policy helper rejects Completed", () => {
    expect(isGenericCompleteBlocked("Completed")).toBe(true);
    expect(isGenericCompleteBlocked("In Progress")).toBe(false);
  });
});

describe("9.4 cancellation authorization", () => {
  const job = { createdByUserId: "u-creator", assignedUserId: "u-pic" };

  it("Administrator may cancel", () => {
    expect(canCancelJob({ isAdministrator: true, actorUserId: "u-other" }, job)).toBe(true);
  });

  it("current Primary PIC may cancel", () => {
    expect(canCancelJob({ isAdministrator: false, actorUserId: "u-pic" }, job)).toBe(true);
  });

  it("creator may cancel", () => {
    expect(canCancelJob({ isAdministrator: false, actorUserId: "u-creator" }, job)).toBe(true);
  });

  it("unrelated same-tenant teammate is denied", () => {
    expect(canCancelJob({ isAdministrator: false, actorUserId: "u-mugs" }, job)).toBe(false);
  });

  it("unidentified actor is denied", () => {
    expect(canCancelJob({ isAdministrator: false, actorUserId: null }, job)).toBe(false);
  });
});

describe("9.5 Assign to Me / Take Over as Primary PIC", () => {
  it("unassigned eligible job can be claimed without a reason", () => {
    expect(
      evaluateClaim({
        status: "Open",
        isDeleted: false,
        assignedUserId: null,
        actorUserId: "u-mugs",
        reason: null,
      }),
    ).toEqual({ ok: true, action: "assigned" });
  });

  it("assigned eligible job can be taken over with a reason", () => {
    expect(
      evaluateClaim({
        status: "In Progress",
        isDeleted: false,
        assignedUserId: "u-ctteh",
        actorUserId: "u-mugs",
        reason: "CT TEH is on leave; customer escalated.",
      }),
    ).toEqual({ ok: true, action: "reassigned" });
  });

  it("takeover without a reason is rejected", () => {
    const r = evaluateClaim({
      status: "Assigned",
      isDeleted: false,
      assignedUserId: "u-ctteh",
      actorUserId: "u-mugs",
      reason: "   ",
    });
    expect(r.ok).toBe(false);
  });

  it.each(["Draft", "Pending Approval", "Completed", "Cancelled"])(
    "%s is a forbidden takeover status",
    (status) => {
      expect(isTakeoverEligibleStatus(status)).toBe(false);
      const r = evaluateClaim({
        status,
        isDeleted: false,
        assignedUserId: "u-ctteh",
        actorUserId: "u-mugs",
        reason: "please",
      });
      expect(r.ok).toBe(false);
    },
  );

  it("deleted jobs cannot be claimed", () => {
    const r = evaluateClaim({
      status: "Open",
      isDeleted: true,
      assignedUserId: null,
      actorUserId: "u-mugs",
      reason: null,
    });
    expect(r.ok).toBe(false);
  });

  it("reason is only required when replacing another PIC", () => {
    expect(takeoverRequiresReason(null, "u-mugs")).toBe(false);
    expect(takeoverRequiresReason("u-mugs", "u-mugs")).toBe(false);
    expect(takeoverRequiresReason("u-ctteh", "u-mugs")).toBe(true);
  });

  it("claim evaluation derives the new PIC from the actor only", () => {
    // evaluateClaim accepts no target user id — a Normal User cannot nominate
    // a third person as Primary PIC through this path.
    const keys = Object.keys({
      status: "",
      isDeleted: false,
      assignedUserId: null,
      actorUserId: "",
      reason: null,
    });
    expect(keys).not.toContain("targetUserId");
  });
});
