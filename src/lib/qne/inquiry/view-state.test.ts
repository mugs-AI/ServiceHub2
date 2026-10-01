import { describe, expect, it } from "vitest";
import { createInquiryView, transitionInquiryView } from "./view-state";
import { normalizeInquiryPreferences } from "./preferences";
import { NORMAL_USER_DEFAULT, OWNER_ADMIN_ACCESS } from "./permissions";
const access = OWNER_ADMIN_ACCESS,
  preferences = normalizeInquiryPreferences(null, access);
const page = {
  rows: [{ id: "job-A", job_number: "SJ0001", internal_note: "private" }],
  total: 1,
  page: 1,
  pageSize: 20,
  access,
};
function applied() {
  let state = transitionInquiryView(createInquiryView(), {
    type: "identity",
    identity: "A",
    preferences,
    access,
  });
  state = transitionInquiryView(state, {
    type: "apply",
    identity: "A",
    query: preferences.applied,
  });
  return transitionInquiryView(state, {
    type: "received",
    identity: "A",
    requestRevision: state.requestRevision,
    data: page,
  });
}
describe("Inquiry session view", () => {
  it("hydrates controls cold, and preserves unapplied edits separately", () => {
    let state = transitionInquiryView(createInquiryView(), {
      type: "identity",
      identity: "A",
      preferences,
      access,
    });
    expect(state.snapshot.hasApplied).toBe(false);
    state = transitionInquiryView(state, {
      type: "patch",
      identity: "A",
      patch: { draft: { ...preferences.draft, q: "draft" } },
    });
    expect(state.snapshot.query.q).toBe("");
    expect(state.snapshot.draft.q).toBe("draft");
  });
  it("ignores responses for an old identity or revision", () => {
    const state = applied();
    for (const event of [
      {
        type: "received" as const,
        identity: "B",
        requestRevision: state.requestRevision,
        data: page,
      },
      {
        type: "received" as const,
        identity: "A",
        requestRevision: state.requestRevision - 1,
        data: page,
      },
    ])
      expect(transitionInquiryView(state, event)).toBe(state);
  });
  it("keeps rows for stable grants and clears/sanitizes them when rights narrow", () => {
    const state = applied();
    expect(transitionInquiryView(state, { type: "grants", identity: "A", access })).toBe(state);
    const narrowed = transitionInquiryView(state, {
      type: "grants",
      identity: "A",
      access: { ...NORMAL_USER_DEFAULT, can_view: true },
    });
    expect(narrowed.snapshot.data).toBeNull();
    expect(narrowed.snapshot.hasApplied).toBe(false);
    expect(narrowed.snapshot.selectedColumns).not.toContain("internal_note");
    expect(
      transitionInquiryView(state, { type: "grants", identity: "A", access: null }).snapshot.data,
    ).toBeNull();
  });
  it("keeps a stale view until explicit Apply and clears on close", () => {
    const state = applied(),
      stale = transitionInquiryView(state, { type: "stale", identity: "A" });
    expect(stale.snapshot.data).toBe(page);
    expect(stale.snapshot.stale).toBe(true);
    const closed = transitionInquiryView(stale, { type: "clear" });
    expect(closed.snapshot.hasApplied).toBe(false);
    expect(closed.snapshot.data).toBeNull();
    expect(closed.snapshot.selectedColumns).toEqual(state.snapshot.selectedColumns);
  });
});
