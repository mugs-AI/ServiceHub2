// WP2C — On-Site GPS Attendance pure rules.

import { describe, expect, it } from "vitest";

import {
  ATTENDANCE_BLOCKED_STATUSES,
  LOW_ACCURACY_THRESHOLD_M,
  MAX_ACCURACY_M,
  actorState,
  attendanceBlockedReason,
  canViewAllVisits,
  formatElapsed,
  gpsResultFromError,
  GPS_RESULT_CODES,
  gpsSummary,
  isLocationCaptured,
  parseCapturePayload,
  serverAlignedElapsedMs,
  serverClockOffsetMs,
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

  it("treats coordinates as captured only for ok / low accuracy with accuracy evidence", () => {
    expect(isLocationCaptured({ gps_result: "ok", latitude: 3, longitude: 101, accuracy: 20 })).toBe(
      true,
    );
    expect(
      isLocationCaptured({ gps_result: "low_accuracy", latitude: 3, longitude: 101, accuracy: 400 }),
    ).toBe(true);
    expect(
      isLocationCaptured({ gps_result: "timeout", latitude: 3, longitude: 101, accuracy: 20 }),
    ).toBe(false);
    expect(isLocationCaptured({ gps_result: "ok", latitude: null, longitude: null })).toBe(false);
    // No accuracy evidence means no captured position.
    expect(isLocationCaptured({ gps_result: "ok", latitude: 3, longitude: 101 })).toBe(false);
  });

  it("requires a non-empty reason when location is missing", () => {
    expect(validateCapture({ gps_result: "permission_denied" }).ok).toBe(false);
    expect(validateCapture({ gps_result: "timeout", exception_reason: "   " }).ok).toBe(false);
    expect(validateCapture({ gps_result: "unsupported", exception_reason: "no gps" }).ok).toBe(
      true,
    );
    expect(
      validateCapture({ gps_result: "ok", latitude: 3, longitude: 101, accuracy: 20 }).ok,
    ).toBe(true);
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

describe("strict GPS payload validation", () => {
  const ok = { gps_result: "ok", latitude: 3.1, longitude: 101.6, accuracy: 25 };

  it("accepts a valid captured position", () => {
    const r = parseCapturePayload(ok);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.capture).toMatchObject({ latitude: 3.1, longitude: 101.6, accuracy: 25 });
  });

  it("accepts valid zero latitude and longitude", () => {
    const r = parseCapturePayload({ gps_result: "ok", latitude: 0, longitude: 0, accuracy: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.capture.latitude).toBe(0);
  });

  it("rejects unknown or missing GPS result codes", () => {
    for (const gps_result of ["", "OK", "captured", undefined, null, 1, true]) {
      expect(parseCapturePayload({ ...ok, gps_result }).ok).toBe(false);
    }
  });

  it("never coerces null, empty string, booleans or arrays to 0", () => {
    for (const bad of [null, "", " ", true, false, [], [1], {}, "abc", NaN]) {
      expect(parseCapturePayload({ ...ok, latitude: bad }).ok).toBe(false);
      expect(parseCapturePayload({ ...ok, longitude: bad }).ok).toBe(false);
      expect(parseCapturePayload({ ...ok, accuracy: bad }).ok).toBe(false);
    }
  });

  it("enforces coordinate bounds", () => {
    expect(parseCapturePayload({ ...ok, latitude: 90.1 }).ok).toBe(false);
    expect(parseCapturePayload({ ...ok, latitude: -90.1 }).ok).toBe(false);
    expect(parseCapturePayload({ ...ok, longitude: 180.1 }).ok).toBe(false);
    expect(parseCapturePayload({ ...ok, longitude: -180.1 }).ok).toBe(false);
    expect(parseCapturePayload({ ...ok, latitude: 90, longitude: -180 }).ok).toBe(true);
  });

  it("requires a valid non-negative accuracy for a captured position", () => {
    expect(parseCapturePayload({ ...ok, accuracy: -1 }).ok).toBe(false);
    expect(parseCapturePayload({ ...ok, accuracy: Number.NaN }).ok).toBe(false);
    expect(
      parseCapturePayload({ gps_result: "low_accuracy", latitude: 3, longitude: 101 }).ok,
    ).toBe(false);
  });

  it("drops any coordinates sent with a failure code and demands a reason", () => {
    expect(parseCapturePayload({ gps_result: "timeout" }).ok).toBe(false);
    const r = parseCapturePayload({
      gps_result: "permission_denied",
      latitude: 3,
      longitude: 101,
      accuracy: 5,
      exception_reason: " no signal ",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.capture.latitude).toBeNull();
      expect(r.capture.longitude).toBeNull();
      expect(r.capture.accuracy).toBeNull();
      expect(r.capture.exception_reason).toBe("no signal");
    }
  });

  it("covers every known result code", () => {
    expect(GPS_RESULT_CODES).toEqual([
      "ok",
      "low_accuracy",
      "permission_denied",
      "timeout",
      "unavailable",
      "unsupported",
    ]);
  });
});

describe("server-aligned elapsed time", () => {
  it("derives the offset between server and device clocks", () => {
    expect(
      serverClockOffsetMs("2026-09-17T00:00:30.000Z", Date.parse("2026-09-17T00:00:00Z")),
    ).toBe(30_000);
    expect(serverClockOffsetMs("not-a-date", 1000)).toBe(0);
  });

  it("measures elapsed time on server time even when the phone clock is wrong", () => {
    const start = "2026-09-17T00:00:00.000Z";
    // Device clock is 10 minutes behind the server.
    const clientNow = Date.parse("2026-09-17T00:05:00Z");
    const offset = serverClockOffsetMs("2026-09-17T00:15:00.000Z", clientNow);
    expect(formatElapsed(serverAlignedElapsedMs(start, offset, clientNow))).toBe("00:15:00");
  });

  it("never returns a negative elapsed time or crashes on a bad timestamp", () => {
    expect(
      serverAlignedElapsedMs("2026-09-17T01:00:00Z", 0, Date.parse("2026-09-17T00:00:00Z")),
    ).toBe(0);
    expect(serverAlignedElapsedMs("nope", 0, 1000)).toBe(0);
  });
});

describe("accuracy evidence is never invented", () => {
  it("omits ±N m unless accuracy is a real finite reading", () => {
    expect(gpsSummary("ok", null)).toBe("GPS captured");
    expect(gpsSummary("ok", undefined)).toBe("GPS captured");
    expect(gpsSummary("ok", Number.NaN)).toBe("GPS captured");
    expect(gpsSummary("ok", -1)).toBe("GPS captured");
    expect(gpsSummary("ok", 0)).toBe("GPS captured · ±0 m");
    expect(gpsSummary("low_accuracy", 480)).toBe("GPS captured (low accuracy) · ±480 m");
  });

  it("treats out-of-range or accuracy-less positions as not captured", () => {
    const base = { gps_result: "ok" as const, latitude: 3.1, longitude: 101.6, accuracy: 25 };
    expect(isLocationCaptured(base)).toBe(true);
    expect(isLocationCaptured({ ...base, accuracy: null })).toBe(false);
    expect(isLocationCaptured({ ...base, accuracy: -1 })).toBe(false);
    expect(isLocationCaptured({ ...base, accuracy: MAX_ACCURACY_M + 1 })).toBe(false);
    expect(isLocationCaptured({ ...base, latitude: 91 })).toBe(false);
    expect(isLocationCaptured({ ...base, longitude: -181 })).toBe(false);
  });

  it("makes validateCapture demand a reason for those same cases", () => {
    const bad = { gps_result: "ok" as const, latitude: 3.1, longitude: 101.6, accuracy: null };
    expect(validateCapture(bad).ok).toBe(false);
    expect(validateCapture({ ...bad, exception_reason: "weak signal" }).ok).toBe(true);
  });

  it("rejects an absurd accuracy in the strict payload parse", () => {
    const r = parseCapturePayload({
      gps_result: "ok",
      latitude: 3.1,
      longitude: 101.6,
      accuracy: MAX_ACCURACY_M + 1,
    });
    expect(r.ok).toBe(false);
  });
});
