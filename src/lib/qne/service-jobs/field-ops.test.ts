import { describe, expect, it } from "vitest";

import {
  availableFieldActions,
  canReadyForCompletion,
  defaultChecklist,
  fieldActionsBlocked,
  validateAttachment,
  validateCompletion,
} from "./field-ops";

describe("field action gating", () => {
  it("blocks approval and terminal statuses", () => {
    for (const status of ["Pending Approval", "Completed", "Cancelled"]) {
      expect(fieldActionsBlocked({ status })).toBeTruthy();
      expect(availableFieldActions({ status })).toEqual([]);
    }
    expect(fieldActionsBlocked({ status: "In Progress", is_deleted: true })).toBeTruthy();
  });

  it("offers travel/arrive/start when no session is open", () => {
    const actions = availableFieldActions({ status: "Assigned" });
    expect(actions).toContain("travel_started");
    expect(actions).toContain("work_started");
    expect(actions).not.toContain("work_paused");
  });

  it("offers pause while active and resume while paused", () => {
    expect(availableFieldActions({ status: "In Progress", activeSession: { status: "active" } }))
      .toContain("work_paused");
    expect(availableFieldActions({ status: "In Progress", activeSession: { status: "paused" } }))
      .toContain("work_resumed");
  });
});

describe("ready for completion", () => {
  const base = { status: "In Progress", workNoteCount: 1 };
  it("passes when clean", () => {
    expect(canReadyForCompletion(base).ok).toBe(true);
  });
  it("blocks unresolved waiting", () => {
    expect(
      canReadyForCompletion({ ...base, openWaiting: { customer: true, vendor: false } }).ok,
    ).toBe(false);
    expect(
      canReadyForCompletion({ ...base, openWaiting: { customer: false, vendor: true } }).ok,
    ).toBe(false);
  });
  it("blocks an open work session", () => {
    expect(canReadyForCompletion({ ...base, activeSession: { status: "active" } }).ok).toBe(false);
  });
  it("requires at least one work note", () => {
    expect(canReadyForCompletion({ status: "In Progress", workNoteCount: 0 }).ok).toBe(false);
  });
});

describe("attachment validation", () => {
  it("rejects executables and scripts", () => {
    expect(validateAttachment({ name: "a.exe", type: "image/png", size: 10 }).ok).toBe(false);
    expect(validateAttachment({ name: "a.svg", type: "image/png", size: 10 }).ok).toBe(false);
  });
  it("rejects disallowed mime types and oversize files", () => {
    expect(validateAttachment({ name: "a.zip", type: "application/zip", size: 10 }).ok).toBe(false);
    expect(
      validateAttachment({ name: "a.png", type: "image/png", size: 20 * 1024 * 1024 }).ok,
    ).toBe(false);
  });
  it("accepts a normal site photo", () => {
    expect(validateAttachment({ name: "site.jpg", type: "image/jpeg", size: 1000 }).ok).toBe(true);
  });
});

describe("completion gate", () => {
  function draft(over: Record<string, unknown> = {}): CompletionDraft {
    return {
      checklist: defaultChecklist().map((i) => ({ ...i, state: "done" as const })),
      resolution_summary: "Fixed",
      work_performed: "Replaced part",
      test_result: "Passed",
      follow_up_required: false,
      ack_customer_name: "Ali",
      ack_confirmed: true,
      signature_data_url: "data:image/png;base64,AAA",
      ...over,
    };
  }


  it("passes a complete draft", () => {
    expect(validateCompletion(draft(), { status: "In Progress" }).ok).toBe(true);
  });
  it("requires every checklist item to be resolved", () => {
    const d = draft();
    d.checklist[0]!.state = "pending" as never;
    expect(validateCompletion(d, { status: "In Progress" }).ok).toBe(false);
  });
  it("requires a note on Not Applicable items", () => {
    const d = draft();
    d.checklist[1] = { label: "System tested", state: "not_applicable", note: "" };
    expect(validateCompletion(d, { status: "In Progress" }).ok).toBe(false);
  });
  it("requires acknowledgement", () => {
    expect(validateCompletion(draft({ ack_confirmed: false }), { status: "In Progress" }).ok).toBe(
      false,
    );
  });
  it("requires a signature or a reasoned waiver", () => {
    expect(
      validateCompletion(draft({ signature_data_url: "" }), { status: "In Progress" }).ok,
    ).toBe(false);
    expect(
      validateCompletion(draft({ signature_data_url: "", signature_waived: true }), {
        status: "In Progress",
      }).ok,
    ).toBe(false);
    expect(
      validateCompletion(
        draft({
          signature_data_url: "",
          signature_waived: true,
          signature_waiver_reason: "Customer offsite",
        }),
        { status: "In Progress" },
      ).ok,
    ).toBe(true);
  });
  it("blocks unresolved waiting and open sessions", () => {
    expect(
      validateCompletion(draft(), {
        status: "In Progress",
        openWaiting: { customer: true, vendor: false },
      }).ok,
    ).toBe(false);
    expect(
      validateCompletion(draft(), {
        status: "In Progress",
        activeSession: { status: "paused" },
      }).ok,
    ).toBe(false);
  });
  it("requires a follow-up date when follow-up is needed", () => {
    expect(
      validateCompletion(draft({ follow_up_required: true }), { status: "In Progress" }).ok,
    ).toBe(false);
  });
});
