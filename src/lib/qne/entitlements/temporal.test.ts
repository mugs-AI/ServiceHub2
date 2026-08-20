import { describe, expect, it } from "vitest";

import { calendarDayDiff, classifyEntitlement, toCalendarDate } from "./temporal";

const D = 30;
function c(expiry: string | null | undefined, today = "2026-08-20", dueSoonDays = D) {
  return classifyEntitlement({ expiryDate: expiry, todayMalaysiaDate: today, dueSoonDays });
}

describe("entitlement temporal classifier", () => {
  it("stale Due Soon row expired 22 days ago is Overdue", () => {
    expect(c("2026-07-29")).toEqual({ remainingDays: -22, status: "Overdue" });
  });

  it("expiry day itself is 0 remaining / Due Soon", () => {
    expect(c("2026-08-20")).toEqual({ remainingDays: 0, status: "Due Soon" });
  });

  it("day after expiry is -1 / Overdue", () => {
    expect(c("2026-08-19")).toEqual({ remainingDays: -1, status: "Overdue" });
  });

  it("exactly dueSoonDays away is Due Soon", () => {
    expect(c("2026-09-19")).toEqual({ remainingDays: 30, status: "Due Soon" });
  });

  it("one day beyond dueSoonDays is Active", () => {
    expect(c("2026-09-20")).toEqual({ remainingDays: 31, status: "Active" });
  });

  it("dueSoonDays = 0 means only the expiry day is Due Soon", () => {
    expect(c("2026-08-20", "2026-08-20", 0).status).toBe("Due Soon");
    expect(c("2026-08-21", "2026-08-20", 0).status).toBe("Active");
    expect(c("2026-08-19", "2026-08-20", 0).status).toBe("Overdue");
  });

  it("handles month and year boundaries", () => {
    expect(c("2027-01-01", "2026-12-31", 0).remainingDays).toBe(1);
    expect(c("2026-09-01", "2026-08-31", 0).remainingDays).toBe(1);
    expect(c("2025-12-31", "2026-01-01").remainingDays).toBe(-1);
  });

  it("handles leap year February", () => {
    expect(c("2028-03-01", "2028-02-28", 0).remainingDays).toBe(2);
    expect(calendarDayDiff("2028-02-28", "2028-02-29")).toBe(1);
    expect(toCalendarDate("2027-02-29")).toBeNull();
  });

  it("invalid or missing expiry is Unknown", () => {
    for (const v of [null, undefined, "", "not-a-date", "2026-13-01", "2026-02-30"]) {
      expect(c(v as string | null).status).toBe("Unknown");
      expect(c(v as string | null).remainingDays).toBeNull();
    }
  });

  it("accepts ISO timestamps by taking the calendar date part", () => {
    expect(c("2026-07-29T16:00:00.000Z").remainingDays).toBe(-22);
  });

  it("is independent of the host timezone (pure calendar-date maths)", () => {
    const prev = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    expect(c("2026-08-20")).toEqual({ remainingDays: 0, status: "Due Soon" });
    process.env.TZ = "Pacific/Kiritimati";
    expect(c("2026-08-20")).toEqual({ remainingDays: 0, status: "Due Soon" });
    process.env.TZ = prev;
  });

  it("Malaysia midnight boundary flips Due Soon to Overdue", () => {
    // 2026-08-19 23:59 MYT -> today 2026-08-19; expiry same day = Due Soon.
    expect(c("2026-08-19", "2026-08-19").status).toBe("Due Soon");
    // 2026-08-20 00:01 MYT -> today 2026-08-20; same expiry = Overdue.
    expect(c("2026-08-19", "2026-08-20").status).toBe("Overdue");
  });
});

describe("stale snapshot supersession", () => {
  it("stored Due Soon / 10 days becomes Overdue / -22", () => {
    const stored = {
      expiry_date: "2026-07-29",
      remaining_days: 10,
      subscription_status: "Due Soon",
    };
    const derived = classifyEntitlement({
      expiryDate: stored.expiry_date,
      todayMalaysiaDate: "2026-08-20",
      dueSoonDays: 30,
    });
    expect(derived.status).toBe("Overdue");
    expect(derived.remainingDays).toBe(-22);
    expect(derived.status).not.toBe(stored.subscription_status);
  });

  it("stored Active with an expired date still becomes Overdue", () => {
    expect(c("2026-01-01").status).toBe("Overdue");
  });
});
