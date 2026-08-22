// WP1 Field Operations — support mode, permissions, lifecycle and waiting.

import { describe, expect, it } from "vitest";

import {
  actionAllowedForMode,
  availableFieldActions,
  canMutateField,
  canSetSupportMode,
  computeWorkMinutes,
  fieldActionsBlocked,
  supportModeMissing,
  workSessionState,
} from "./field-ops";
import type { WorkSessionRow } from "./field-ops";

const REMOTE = "remote_support";
const ONSITE = "onsite_support";

describe("support mode gating", () => {
  it("blocks every field action when support mode is missing", () => {
    const state = { status: "Assigned", supportMode: null };
    expect(supportModeMissing(state)).toBe(true);
    expect(fieldActionsBlocked(state)).toMatch(/Support mode/i);
    expect(availableFieldActions(state)).toEqual([]);
  });

  it("never treats a missing mode as onsite", () => {
    expect(actionAllowedForMode("travel_started", null)).toMatch(/Support mode/i);
    expect(actionAllowedForMode("arrived_on_site", undefined)).toBeTruthy();
  });

  it("hides travel and arrival for remote work but keeps work actions", () => {
    expect(actionAllowedForMode("travel_started", REMOTE)).toBeTruthy();
    expect(actionAllowedForMode("work_started", REMOTE)).toBeNull();
    const actions = availableFieldActions({ status: "Assigned", supportMode: REMOTE });
    expect(actions).not.toContain("travel_started");
    expect(actions).not.toContain("arrived_on_site");
    expect(actions).not.toContain("leave_site");
    expect(actions).toContain("work_started");
  });

  it("enforces the onsite lifecycle order and prevents overwrite", () => {
    const base = { status: "Assigned", supportMode: ONSITE };
    expect(availableFieldActions(base)).toContain("travel_started");
    expect(availableFieldActions(base)).not.toContain("leave_site");

    const travelled = { ...base, travelStartedAt: "2026-08-22T01:00:00Z" };
    expect(availableFieldActions(travelled)).not.toContain("travel_started");
    expect(availableFieldActions(travelled)).toContain("arrived_on_site");

    const arrived = { ...travelled, arrivedAt: "2026-08-22T02:00:00Z" };
    expect(availableFieldActions(arrived)).not.toContain("arrived_on_site");
    expect(availableFieldActions(arrived)).toContain("leave_site");

    const left = { ...arrived, leftAt: "2026-08-22T05:00:00Z" };
    expect(availableFieldActions(left)).not.toContain("leave_site");
  });
});

describe("field mutation permissions", () => {
  const job = { assigned_user_id: "PIC-1" };
  it("allows the Primary PIC and Owner/Admin only", () => {
    expect(canMutateField(job, { isAdmin: false, actorUserId: "PIC-1" })).toBe(true);
    expect(canMutateField(job, { isAdmin: true, actorUserId: "OTHER" })).toBe(true);
    expect(canMutateField(job, { isAdmin: false, actorUserId: "OTHER" })).toBe(false);
    expect(canMutateField({ assigned_user_id: null }, { isAdmin: false, actorUserId: "X" })).toBe(
      false,
    );
  });

  it("locks support mode once field evidence exists", () => {
    const noEvidence = { sessionCount: 0, waitingCount: 0, workNoteCount: 0 };
    expect(
      canSetSupportMode({ assigned_user_id: "PIC-1", support_mode: null }, {
        isAdmin: false,
        actorUserId: "PIC-1",
      }, noEvidence).ok,
    ).toBe(true);
    expect(
      canSetSupportMode({ assigned_user_id: "PIC-1", support_mode: ONSITE }, {
        isAdmin: true,
        actorUserId: "ADMIN",
      }, { ...noEvidence, sessionCount: 1 }).ok,
    ).toBe(false);
    expect(
      canSetSupportMode({ assigned_user_id: "PIC-1", support_mode: ONSITE }, {
        isAdmin: true,
        actorUserId: "ADMIN",
      }, { ...noEvidence, travelStartedAt: "2026-08-22T01:00:00Z" }).ok,
    ).toBe(false);
    expect(
      canSetSupportMode({ assigned_user_id: "PIC-1", support_mode: null }, {
        isAdmin: false,
        actorUserId: "OTHER",
      }, noEvidence).ok,
    ).toBe(false);
  });
});

describe("work session lifecycle", () => {
  const row = (over: Partial<WorkSessionRow> & { id: string }): WorkSessionRow => ({
    status: "completed",
    started_at: "2026-08-22T01:00:00Z",
    ended_at: "2026-08-22T02:00:00Z",
    duration_minutes: 60,
    ...over,
  });

  it("reports a single open segment", () => {
    const s = workSessionState([
      row({ id: "a" }),
      row({ id: "b", status: "active", ended_at: null, duration_minutes: null }),
    ]);
    expect(s.status).toBe("active");
    expect(s.activeSegment?.id).toBe("b");
  });

  it("reports paused when the latest segment is paused", () => {
    const s = workSessionState([
      row({ id: "a", status: "paused", started_at: "2026-08-22T03:00:00Z" }),
    ]);
    expect(s.status).toBe("paused");
    expect(s.activeSegment).toBeNull();
  });

  it("reports nothing open after Stop Work", () => {
    expect(workSessionState([row({ id: "a" })]).status).toBeNull();
  });

  it("excludes paused time and cancelled segments from total duration", () => {
    const total = computeWorkMinutes([
      row({ id: "a", duration_minutes: 30 }),
      // paused gap between 02:00 and 04:00 is never stored
      row({
        id: "b",
        started_at: "2026-08-22T04:00:00Z",
        ended_at: "2026-08-22T04:30:00Z",
        duration_minutes: null,
      }),
      row({ id: "c", status: "cancelled", duration_minutes: 999 }),
      row({ id: "d", status: "active", ended_at: null, duration_minutes: null }),
    ]);
    expect(total).toBe(60);
  });

  it("offers pause and stop while active, resume and stop while paused", () => {
    const active = availableFieldActions({
      status: "In Progress",
      supportMode: REMOTE,
      activeSession: { status: "active" },
    });
    expect(active).toContain("work_paused");
    expect(active).toContain("work_stopped");
    expect(active).not.toContain("work_started");

    const paused = availableFieldActions({
      status: "In Progress",
      supportMode: REMOTE,
      activeSession: { status: "paused" },
    });
    expect(paused).toContain("work_resumed");
    expect(paused).toContain("work_stopped");
    expect(paused).not.toContain("work_started");
  });
});

describe("waiting periods", () => {
  it("offers start then resolve for each waiting type", () => {
    const open = availableFieldActions({
      status: "In Progress",
      supportMode: REMOTE,
      openWaiting: { customer: true, vendor: false },
    });
    expect(open).toContain("waiting_customer_resolved");
    expect(open).toContain("waiting_vendor_started");
    expect(open).not.toContain("waiting_customer_started");
  });
});
