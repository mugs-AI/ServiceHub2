import { describe, expect, it } from "vitest";

import {
  canScheduleJob,
  dayPartOf,
  formatDuration,
  intervalsOverlap,
  myDayUtcRange,
  myLocalToUtcIso,
  shiftDayKey,
  utcIsoToMyLocal,
  validateWindow,
} from "./scheduling";

describe("Malaysia time conversion", () => {
  it("converts local input to UTC", () => {
    expect(myLocalToUtcIso("2026-08-01T10:00")).toBe("2026-08-01T02:00:00.000Z");
  });
  it("round-trips", () => {
    expect(utcIsoToMyLocal("2026-08-01T02:00:00.000Z")).toBe("2026-08-01T10:00");
  });
  it("computes the Malaysia day range in UTC", () => {
    expect(myDayUtcRange("2026-08-01")).toEqual({
      fromIso: "2026-07-31T16:00:00.000Z",
      toIso: "2026-08-01T16:00:00.000Z",
    });
  });
  it("shifts day keys", () => {
    expect(shiftDayKey("2026-08-01", 1)).toBe("2026-08-02");
    expect(shiftDayKey("2026-08-01", -1)).toBe("2026-07-31");
  });
});

describe("day parts", () => {
  it("buckets by Malaysia hour", () => {
    expect(dayPartOf("2026-08-01T02:00:00.000Z")).toBe("morning"); // 10:00 MYT
    expect(dayPartOf("2026-08-01T06:00:00.000Z")).toBe("afternoon"); // 14:00
    expect(dayPartOf("2026-08-01T11:00:00.000Z")).toBe("evening"); // 19:00
    expect(dayPartOf(null)).toBe("unscheduled");
  });
});

describe("overlap + validation", () => {
  it("detects overlaps, half-open", () => {
    expect(intervalsOverlap("2026-08-01T02:00Z", "2026-08-01T03:00Z", "2026-08-01T02:30Z", "2026-08-01T04:00Z")).toBe(true);
    expect(intervalsOverlap("2026-08-01T02:00Z", "2026-08-01T03:00Z", "2026-08-01T03:00Z", "2026-08-01T04:00Z")).toBe(false);
  });
  it("requires end after start", () => {
    expect(validateWindow("2026-08-01T03:00Z", "2026-08-01T02:00Z").ok).toBe(false);
    expect(validateWindow("2026-08-01T02:00Z", "2026-08-01T03:00Z").ok).toBe(true);
  });
  it("flags past windows without blocking", () => {
    const v = validateWindow("2020-01-01T02:00Z", "2020-01-01T03:00Z");
    expect(v.ok).toBe(true);
    expect(v.isPast).toBe(true);
  });
  it("formats duration", () => {
    expect(formatDuration("2026-08-01T02:00Z", "2026-08-01T03:30Z")).toBe("1h 30m");
  });
});

describe("schedulable statuses", () => {
  it("allows operational statuses", () => {
    for (const status of ["Open", "Assigned", "In Progress", "Waiting Customer", "Waiting Vendor"]) {
      expect(canScheduleJob({ status }).ok).toBe(true);
    }
  });
  it("blocks approval/terminal statuses", () => {
    for (const status of ["Pending Approval", "Completed", "Cancelled"]) {
      expect(canScheduleJob({ status }).ok).toBe(false);
    }
    expect(canScheduleJob({ status: "Open", is_deleted: true }).ok).toBe(false);
  });
  it("allows Draft only with a technician", () => {
    expect(canScheduleJob({ status: "Draft" }).ok).toBe(false);
    expect(canScheduleJob({ status: "Draft", assigned_user_id: "u1" }).ok).toBe(true);
  });
});
