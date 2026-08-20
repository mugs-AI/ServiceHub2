import { describe, expect, it } from "vitest";

import {
  addDays,
  daysInMonth,
  dayHeading,
  displayDay,
  endOfMonth,
  endOfWeek,
  enumerateDays,
  isSameMonth,
  monthGridDays,
  monthLabel,
  rangeForView,
  shiftForView,
  shiftMonth,
  shiftWeek,
  startOfMonth,
  startOfWeek,
  weekLabel,
  weekdayMondayIndex,
} from "./calendar-range";

describe("week boundaries (Monday → Sunday, Asia/Kuala_Lumpur calendar)", () => {
  it("maps weekday indexes with Monday = 0", () => {
    expect(weekdayMondayIndex("2026-08-17")).toBe(0); // Monday
    expect(weekdayMondayIndex("2026-08-20")).toBe(3); // Thursday
    expect(weekdayMondayIndex("2026-08-23")).toBe(6); // Sunday
  });

  it("resolves a midweek day to its Monday and Sunday", () => {
    expect(startOfWeek("2026-08-20")).toBe("2026-08-17");
    expect(endOfWeek("2026-08-20")).toBe("2026-08-23");
  });

  it("keeps Monday and Sunday stable at the edges", () => {
    expect(startOfWeek("2026-08-17")).toBe("2026-08-17");
    expect(endOfWeek("2026-08-23")).toBe("2026-08-23");
    expect(startOfWeek("2026-08-23")).toBe("2026-08-17");
  });

  it("handles a week crossing a month boundary", () => {
    expect(startOfWeek("2026-09-01")).toBe("2026-08-31");
    expect(endOfWeek("2026-08-31")).toBe("2026-09-06");
  });

  it("handles a week crossing a year boundary", () => {
    expect(startOfWeek("2027-01-01")).toBe("2026-12-28");
    expect(endOfWeek("2026-12-28")).toBe("2027-01-03");
  });
});

describe("month boundaries", () => {
  it("returns first and last day of the month", () => {
    expect(startOfMonth("2026-08-20")).toBe("2026-08-01");
    expect(endOfMonth("2026-08-20")).toBe("2026-08-31");
    expect(endOfMonth("2026-09-10")).toBe("2026-09-30");
  });

  it("handles leap-year February", () => {
    expect(endOfMonth("2024-02-05")).toBe("2024-02-29");
    expect(daysInMonth("2024-02-05")).toBe(29);
    expect(endOfMonth("2026-02-05")).toBe("2026-02-28");
    expect(daysInMonth("2026-02-05")).toBe(28);
  });

  it("clamps day-of-month when shifting months", () => {
    expect(shiftMonth("2026-03-31", -1)).toBe("2026-02-28");
    expect(shiftMonth("2024-03-31", -1)).toBe("2024-02-29");
    expect(shiftMonth("2026-12-15", 1)).toBe("2027-01-15");
  });
});

describe("prev / next stepping", () => {
  it("steps one day in day view", () => {
    expect(shiftForView("day", "2026-08-20", 1)).toBe("2026-08-21");
    expect(shiftForView("day", "2026-08-01", -1)).toBe("2026-07-31");
  });

  it("steps one week in week view keeping the weekday", () => {
    expect(shiftForView("week", "2026-08-20", 1)).toBe("2026-08-27");
    expect(shiftWeek("2026-08-20", -1)).toBe("2026-08-13");
    expect(weekdayMondayIndex(shiftWeek("2026-08-20", 5))).toBe(weekdayMondayIndex("2026-08-20"));
  });

  it("steps one month in month view", () => {
    expect(shiftForView("month", "2026-08-20", 1)).toBe("2026-09-20");
    expect(shiftForView("month", "2026-01-20", -1)).toBe("2025-12-20");
  });
});

describe("rangeForView — the exact from/to sent to /api/workspace/calendar", () => {
  it("day view asks for a single Malaysia day", () => {
    expect(rangeForView("day", "2026-08-20")).toEqual({
      from: "2026-08-20",
      to: "2026-08-20",
    });
  });

  it("day → week produces the Monday..Sunday range for the same anchor", () => {
    expect(rangeForView("week", "2026-08-20")).toEqual({
      from: "2026-08-17",
      to: "2026-08-23",
    });
  });

  it("week → month produces the padded Monday-first grid range", () => {
    // August 2026: 1 Aug is a Saturday, 31 Aug is a Monday.
    expect(rangeForView("month", "2026-08-20")).toEqual({
      from: "2026-07-27",
      to: "2026-09-06",
    });
  });

  it("month range always starts on a Monday and ends on a Sunday", () => {
    for (const anchor of ["2024-02-10", "2026-01-01", "2026-12-31", "2027-05-15"]) {
      const r = rangeForView("month", anchor);
      expect(weekdayMondayIndex(r.from)).toBe(0);
      expect(weekdayMondayIndex(r.to)).toBe(6);
      expect(startOfMonth(anchor) >= r.from).toBe(true);
      expect(endOfMonth(anchor) <= r.to).toBe(true);
    }
  });
});

describe("grid + enumeration", () => {
  it("enumerates an inclusive week of 7 days", () => {
    const days = enumerateDays("2026-08-17", "2026-08-23");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-08-17");
    expect(days[6]).toBe("2026-08-23");
  });

  it("month grid is a whole number of 7-day rows and covers the month", () => {
    const grid = monthGridDays("2024-02-10");
    expect(grid.length % 7).toBe(0);
    expect(grid).toContain("2024-02-01");
    expect(grid).toContain("2024-02-29");
  });

  it("flags outside-month cells", () => {
    expect(isSameMonth("2026-07-27", "2026-08-20")).toBe(false);
    expect(isSameMonth("2026-08-01", "2026-08-20")).toBe(true);
  });
});

describe("Malaysia date stability in labels", () => {
  it("renders dd/mm/yyyy day labels", () => {
    expect(displayDay("2026-08-20")).toBe("20/08/2026");
    expect(addDays("2026-08-20", 0)).toBe("2026-08-20");
  });

  it("renders week and month headings", () => {
    expect(weekLabel("2026-08-20")).toBe("17 Aug – 23 Aug 2026");
    expect(weekLabel("2026-12-31")).toBe("28 Dec 2026 – 3 Jan 2027");
    expect(monthLabel("2026-08-20")).toBe("August 2026");
    expect(dayHeading("2026-08-20")).toBe("Thu, 20 Aug 2026");
  });
});
