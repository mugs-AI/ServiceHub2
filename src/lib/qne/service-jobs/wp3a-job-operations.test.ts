// WP3A — pure rule tests for waiting references and completion reopen.

import { describe, expect, it } from "vitest";

import {
  MAX_WAITING_REF,
  WAITING_TARGET_STATUS,
  parseWaitingInput,
  refDisplay,
  waitingBlockedReason,
  waitingPartyForStatus,
} from "./wp3a-waiting";
import {
  MAX_REOPEN_NOTE,
  MAX_REOPEN_REASON,
  canRequestReopen,
  parseReopenDecision,
  parseReopenReason,
  reopenBlockedReason,
  reopenView,
  type ReopenRequestRow,
} from "./wp3a-reopen";

const pending: ReopenRequestRow = {
  id: "r1",
  status: "pending",
  reason: "Customer reported the same fault again",
  prior_status: "Completed",
  completion_cycle_at_request: 1,
  requested_by_user_id: "u2",
  requested_by_name_snapshot: "Tech Two",
  requested_at: "2026-09-20T01:00:00Z",
  decision_note: null,
  decided_by_name_snapshot: null,
  decided_at: null,
};

describe("waiting reference validation", () => {
  it("requires a non-empty trimmed reference", () => {
    expect(parseWaitingInput({ party: "customer" })).toEqual({
      ok: false,
      error: "A reference number is required.",
    });
    expect(parseWaitingInput({ party: "customer", ref_no: "   " }).ok).toBe(false);
  });

  it("rejects non-string and coercible references", () => {
    expect(parseWaitingInput({ party: "vendor", ref_no: 12345 }).ok).toBe(false);
    expect(parseWaitingInput({ party: "vendor", ref_no: true }).ok).toBe(false);
    expect(parseWaitingInput({ party: "vendor", ref_no: null }).ok).toBe(false);
  });

  it("rejects an unknown party", () => {
    expect(parseWaitingInput({ party: "supplier", ref_no: "A1" }).ok).toBe(false);
    expect(parseWaitingInput({ ref_no: "A1" }).ok).toBe(false);
  });

  it("accepts 1..200 characters and trims", () => {
    const ok = parseWaitingInput({ party: "customer", ref_no: "  CR-001  " });
    expect(ok).toEqual({ ok: true, value: { party: "customer", ref_no: "CR-001" } });
    expect(parseWaitingInput({ party: "vendor", ref_no: "x".repeat(MAX_WAITING_REF) }).ok).toBe(true);
    expect(parseWaitingInput({ party: "vendor", ref_no: "x".repeat(MAX_WAITING_REF + 1) }).ok).toBe(
      false,
    );
  });

  it("maps party to the exact target status and back", () => {
    expect(WAITING_TARGET_STATUS.customer).toBe("Waiting Customer");
    expect(WAITING_TARGET_STATUS.vendor).toBe("Waiting Vendor");
    expect(waitingPartyForStatus("Waiting Customer")).toBe("customer");
    expect(waitingPartyForStatus("Waiting Vendor")).toBe("vendor");
    expect(waitingPartyForStatus("In Progress")).toBeNull();
  });

  it("only allows a waiting transition from In Progress on a live Job", () => {
    expect(waitingBlockedReason({ status: "In Progress", is_deleted: false })).toBeNull();
    expect(waitingBlockedReason({ status: "Assigned", is_deleted: false })).toMatch(/In Progress/);
    expect(waitingBlockedReason({ status: "Completed", is_deleted: false })).toMatch(/In Progress/);
    expect(waitingBlockedReason({ status: "In Progress", is_deleted: true })).toMatch(/Deleted/);
  });

  it("shows an em dash for an unset latest reference", () => {
    expect(refDisplay(null)).toBe("—");
    expect(refDisplay("  ")).toBe("—");
    expect(refDisplay("CR-001")).toBe("CR-001");
  });
});

describe("reopen request validation", () => {
  it("requires a reason of 1..2000 characters", () => {
    expect(parseReopenReason({}).ok).toBe(false);
    expect(parseReopenReason({ reason: "  " }).ok).toBe(false);
    expect(parseReopenReason({ reason: 5 }).ok).toBe(false);
    expect(parseReopenReason({ reason: " needs rework " })).toEqual({
      ok: true,
      value: "needs rework",
    });
    expect(parseReopenReason({ reason: "x".repeat(MAX_REOPEN_REASON) }).ok).toBe(true);
    expect(parseReopenReason({ reason: "x".repeat(MAX_REOPEN_REASON + 1) }).ok).toBe(false);
  });

  it("accepts only approve/reject with an optional bounded note", () => {
    expect(parseReopenDecision({ decision: "approve" })).toEqual({
      ok: true,
      value: { decision: "approve", note: null },
    });
    expect(parseReopenDecision({ decision: "reject", note: " ok " })).toEqual({
      ok: true,
      value: { decision: "reject", note: "ok" },
    });
    expect(parseReopenDecision({ decision: "cancel" }).ok).toBe(false);
    expect(parseReopenDecision({ decision: "approve", note: 3 }).ok).toBe(false);
    expect(
      parseReopenDecision({ decision: "approve", note: "x".repeat(MAX_REOPEN_NOTE + 1) }).ok,
    ).toBe(false);
  });
});

describe("reopen eligibility", () => {
  it("allows a Completed Job with no pending request", () => {
    expect(canRequestReopen({ status: "Completed", is_deleted: false }, false)).toBe(true);
  });

  it("allows a legacy Completed Job with no completion evidence", () => {
    // Evidence is irrelevant to eligibility: no historical completion is ever
    // invented to make a reopen possible.
    expect(reopenBlockedReason({ status: "Completed", is_deleted: false }, false)).toBeNull();
  });

  it("blocks non-completed, deleted and already-pending Jobs", () => {
    expect(canRequestReopen({ status: "In Progress", is_deleted: false }, false)).toBe(false);
    expect(canRequestReopen({ status: "Completed", is_deleted: true }, false)).toBe(false);
    expect(canRequestReopen({ status: "Completed", is_deleted: false }, true)).toBe(false);
    expect(reopenBlockedReason({ status: "Completed", is_deleted: false }, true)).toMatch(
      /already awaiting/,
    );
  });
});

describe("reopen view", () => {
  it("hides the section entirely on an active Job", () => {
    expect(
      reopenView({ job: { status: "In Progress", is_deleted: false }, pending: null, isAdmin: true }),
    ).toEqual({ mode: "hidden" });
  });

  it("offers the request action on a Completed Job", () => {
    expect(
      reopenView({ job: { status: "Completed", is_deleted: false }, pending: null, isAdmin: false }),
    ).toEqual({ mode: "request" });
  });

  it("exposes decision controls to an admin only", () => {
    const job = { status: "Completed", is_deleted: false };
    expect(reopenView({ job, pending, isAdmin: true })).toEqual({
      mode: "pending",
      request: pending,
      canDecide: true,
    });
    expect(reopenView({ job, pending, isAdmin: false })).toEqual({
      mode: "pending",
      request: pending,
      canDecide: false,
    });
  });
});
