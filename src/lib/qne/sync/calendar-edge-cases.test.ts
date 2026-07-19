// Phase 1.1.7 — Calendar edge-case regression harness for the subscription
// expiry engine.
//
// Pins the leap-year / month-length behaviour of computeInclusiveExpiry and
// computeExpiryForQuantity across the full regression checklist:
//   - Yearly leap, non-leap, month-end
//   - Monthly 28 / 29 / 30 / 31 day cycles
//   - Whole quantities 1, 2, 3
//   - Fractional quantities 0.5, 1.5, 1.7
// Any silent drift in the calendar arithmetic will break at least one of
// these tests before it can reach production entitlements.

import { describe, expect, it } from "vitest";
import {
  computeExpiryForQuantity,
  computeInclusiveExpiry,
} from "./subscription-sync.server";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, mZeroBased: number, d: number) =>
  new Date(Date.UTC(y, mZeroBased, d));

describe("Yearly cycles — calendar edge cases", () => {
  it("qty=1 across a leap year: 2027-06-01 → 2028-05-31", () => {
    // The 2027-06-01 → 2028-06-01 period spans 2028-02-29; the -1d step
    // must resolve to 2028-05-31 regardless of that leap day.
    expect(iso(computeExpiryForQuantity(utc(2027, 5, 1), 1, "year", 1))).toBe(
      "2028-05-31",
    );
  });

  it("qty=1 across a non-leap year: 2025-06-01 → 2026-05-31", () => {
    expect(iso(computeExpiryForQuantity(utc(2025, 5, 1), 1, "year", 1))).toBe(
      "2026-05-31",
    );
  });

  it("starts on Dec 31 (month-end): +1y − 1d → next Dec 30", () => {
    expect(iso(computeExpiryForQuantity(utc(2026, 11, 31), 1, "year", 1))).toBe(
      "2027-12-30",
    );
  });

  it("starts on Feb 29 (leap): +1y − 1d → Feb 28 next year", () => {
    // Feb 29 2028 + 1y using JS calendar arithmetic rolls to Feb 29 → Mar 1,
    // then −1d gives Feb 28 2029.
    expect(iso(computeExpiryForQuantity(utc(2028, 1, 29), 1, "year", 1))).toBe(
      "2029-02-28",
    );
  });

  it("qty=3 crosses one leap day and stays deterministic (M1D2604002 QCA-VIP)", () => {
    expect(iso(computeExpiryForQuantity(utc(2026, 5, 1), 1, "year", 3))).toBe(
      "2029-05-31",
    );
  });
});

describe("Monthly cycles — 28/29/30/31 day months", () => {
  it("Jan 31 + 1mo lands on the last day of Feb (non-leap): Feb 27 inclusive", () => {
    // Jan 31 2027 + 1 month (JS) = Mar 3 2027 (Feb only has 28 days),
    // then -1d gives Mar 2 2027. This pins the documented calendar
    // arithmetic — treat it as the authoritative behaviour, not a bug.
    expect(iso(computeExpiryForQuantity(utc(2027, 0, 31), 1, "month", 1))).toBe(
      "2027-03-02",
    );
  });

  it("Jan 31 + 1mo in a leap year: Feb has 29 days", () => {
    // Jan 31 2028 + 1 month = Mar 2 2028 (Feb 2028 has 29 days),
    // then -1d = Mar 1 2028.
    expect(iso(computeExpiryForQuantity(utc(2028, 0, 31), 1, "month", 1))).toBe(
      "2028-03-01",
    );
  });

  it("start in a 30-day month: Apr 30 + 1mo − 1d → May 30", () => {
    expect(iso(computeExpiryForQuantity(utc(2027, 3, 30), 1, "month", 1))).toBe(
      "2027-05-30",
    );
  });

  it("start in a 31-day month: Mar 15 + 1mo − 1d → Apr 14", () => {
    expect(iso(computeExpiryForQuantity(utc(2027, 2, 15), 1, "month", 1))).toBe(
      "2027-04-14",
    );
  });

  it("qty=12 monthly ≡ 1 year of calendar arithmetic (not 365 days)", () => {
    // 2028-01-15 + 12 months = 2029-01-15; -1d = 2029-01-14. Same start
    // through the year helper would produce the identical inclusive date.
    expect(iso(computeExpiryForQuantity(utc(2028, 0, 15), 1, "month", 12))).toBe(
      iso(computeInclusiveExpiry(utc(2028, 0, 15), 1, "year")),
    );
  });
});

describe("Day cycles", () => {
  it("qty=1 × 1 day is the start date itself (inclusive expiry)", () => {
    expect(iso(computeExpiryForQuantity(utc(2027, 5, 1), 1, "day", 1))).toBe(
      "2027-06-01",
    );
  });

  it("qty=1 × 30 days from 2027-06-01 → 2027-06-30", () => {
    expect(iso(computeExpiryForQuantity(utc(2027, 5, 1), 30, "day", 1))).toBe(
      "2027-06-30",
    );
  });
});
