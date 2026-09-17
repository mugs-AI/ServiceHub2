// WP2C — On-Site GPS Attendance pure rules.

import { describe, expect, it } from "vitest";

import {
  ATTENDANCE_BLOCKED_STATUSES,
  LOW_ACCURACY_THRESHOLD_M,
  actorState,
  attendanceBlockedReason,
  canViewAllVisits,
  formatElapsed,
  gpsResultFromError,
  gpsSummary,
  isLocationCaptured,
  validateCapture,
  visibleVisits,
} from "./onsite-attendance";
import type { AttendanceVisit } from "./onsite-attendance";

function visit(
  over: Partial<AttendanceVisit> & { id: string; actor_user_id: string },
): AttendanceVisit {
  return {
    service_job_id: "job-1",
    actor_name_snapshot: "Staff",
    clock_in_at: "2026-09-17T01:00:00.000Z",
    clock_out_at: null,
    duration_minutes: null,
    clock_in_latitude: 3.1,
    clock_in_longitude: 101.6,
    clock_in_accuracy_m: 25,
    clock_in_gps_result: "ok",
    clock_in_exception_reason: null,
    clock_out_latitude: null,
    clock_out_longitude: null,
    clock_out_accuracy_m: null,
    clock_out_gps_result: null,
    clock_out_exception_reason: null,
    has_gps_exception: false,
    ...over,
  } as AttendanceVisit;
}

describe("lifecycle locks", () => {
  it("blocks deleted, Completed, Cancelled and Pending Approval jobs", () => {
    expect(attendanceBlockedReason({ status: "In Progress", is_deleted: true })).toBeTruthy();
    for (const status of ATTENDANCE_BLOCKED_STATUSES) {
      expect(attendanceBlockedReason({ status, is_deleted: false })).toBeTruthy();
    }
  });

  it("allows an active job", () => {
    expect(attendanceBlockedReason({ status: "Assigned", is_deleted: false })).toBeNull();
    expect(attendanceBlockedReason({ status: "In Progress", is_deleted: false })).toBeNull();
  });
});

describe("location capture and mandatory exception reason", () => {
  it("maps browser geolocation error codes to distinct results", () => {
    expect(gpsResultFromError({ code: 1 })).toBe("permission_denied");
    expect(gpsResultFromError({ code: 2 })).toBe("unavailable");
    expect(gpsResultFromError({ code: 3 })).toBe("timeout");
    expect(gpsResultFromError(null)).toBe("unavailable");
  });

  it("treats coordinates as captured only for ok / low accuracy", () => {
    expect(isLocationCaptured({ gps_result: "ok", latitude: 3, longitude: 101 })).toBe(true);
    expect(isLocationCaptured({ gps_result: "low_accuracy", latitude: 3, longitude: 101 })).toBe(
      true,
    );
    expect(isLocationCaptured({ gps_result: "timeout", latitude: 3, longitude: 101 })).toBe(false);
    expect(isLocationCaptured({ gps_result: "ok", latitude: null, longitude: null })).toBe(false);
  });

  it("requires a non-empty reason when location is missing", () => {
    expect(validateCapture({ gps_result: "permission_denied" }).ok).toBe(false);
    expect(validateCapture({ gps_result: "timeout", exception_reason: "   " }).ok).toBe(false);
    expect(validateCapture({ gps_result: "unsupported", exception_reason: "no gps" }).ok).toBe(
      true,
    );
    expect(validateCapture({ gps_result: "ok", latitude: 3, longitude: 101 }).ok).toBe(true);
  });

  it("shows accuracy or a flagged exception", () => {
    expect(gpsSummary("ok", 25)).toBe("GPS captured · ±25 m");
    expect(gpsSummary("low_accuracy", 400)).toContain("low accuracy");
    expect(gpsSummary("permission_denied", null)).toContain("GPS exception");
    expect(LOW_ACCURACY_THRESHOLD_M).toBeGreaterThan(0);
  });
});

describe("visibility", () => {
  const rows = [
    visit({ id: "a", actor_user_id: "u1" }),
    visit({ id: "b", actor_user_id: "u2" }),
    visit({
      id: "c",
      actor_user_id: "u1",
      clock_out_at: "2026-09-17T02:00:00.000Z",
      duration_minutes: 60,
    }),
  ];

  it("lets Admin and the current Primary PIC see all visits", () => {
    expect(canViewAllVisits({ actorUserId: "u9", isAdmin: true, assignedUserId: "u1" })).toBe(true);
    expect(canViewAllVisits({ actorUserId: "u1", isAdmin: false, assignedUserId: "u1" })).toBe(
      true,
    );
    expect(
      visibleVisits(rows, { actorUserId: "u1", isAdmin: false, assignedUserId: "u1" }),
    ).toHaveLength(3);
  });

  it("limits an ordinary teammate to their own visits", () => {
    const seen = visibleVisits(rows, { actorUserId: "u2", isAdmin: false, assignedUserId: "u1" });
    expect(seen.map((r) => r.id)).toEqual(["b"]);
  });

  it("returns nothing when the actor cannot be resolved (fail closed)", () => {
    expect(
      visibleVisits(rows, { actorUserId: null, isAdmin: false, assignedUserId: "u1" }),
    ).toEqual([]);
  });
});

describe("multi-visit / multi-staff state", () => {
  const rows = [
    visit({
      id: "a",
      actor_user_id: "u1",
      clock_out_at: "2026-09-17T02:00:00.000Z",
      duration_minutes: 60,
    }),
    visit({ id: "b", actor_user_id: "u1", clock_in_at: "2026-09-17T03:00:00.000Z" }),
    visit({ id: "c", actor_user_id: "u2" }),
  ];

  it("reports the actor's own open visit and latest completed visit", () => {
    const s = actorState(rows, "u1");
    expect(s.openVisit?.id).toBe("b");
    expect(s.lastCompleted?.id).toBe("a");
    expect(s.visitCount).toBe(2);
  });

  it("keeps separate staff sessions independent on one job", () => {
    expect(actorState(rows, "u2").openVisit?.id).toBe("c");
    expect(actorState(rows, "u3").openVisit).toBeNull();
  });
});

describe("elapsed formatting", () => {
  it("never renders a negative elapsed time", () => {
    expect(formatElapsed(-5000)).toBe("00:00:00");
    expect(formatElapsed(3_661_000)).toBe("01:01:01");
  });
});
