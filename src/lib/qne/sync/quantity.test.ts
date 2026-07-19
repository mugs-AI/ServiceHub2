// Phase 1.1.6c — regression tests for quantity-driven expiry.
//
// Pins the resolveEffectiveQuantity rules AND the qty × cycle expiry
// math (including fractional quantities) that Workspace entitlements
// depend on.

import { describe, expect, it } from "vitest";
import {
  computeExpiryForQuantity,
  computeInclusiveExpiry,
  resolveEffectiveQuantity,
} from "./subscription-sync.server";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, mZeroBased: number, d: number) => new Date(Date.UTC(y, mZeroBased, d));

describe("resolveEffectiveQuantity", () => {
  it("treats null / undefined as qty = 1", () => {
    expect(resolveEffectiveQuantity(null)).toEqual({ effective: 1, fractional: false });
    expect(resolveEffectiveQuantity(undefined)).toEqual({ effective: 1, fractional: false });
  });

  it("accepts positive integers verbatim", () => {
    for (const q of [1, 2, 3, 12, 60]) {
      expect(resolveEffectiveQuantity(q)).toEqual({ effective: q, fractional: false });
    }
  });

  it("accepts positive fractions without rounding (fractional flag set)", () => {
    for (const q of [0.5, 1.5, 1.7, 2.25, 12.75]) {
      expect(resolveEffectiveQuantity(q)).toEqual({ effective: q, fractional: true });
    }
  });

  it("skips zero as zero_quantity", () => {
    expect(resolveEffectiveQuantity(0)).toEqual({
      effective: null,
      skipReason: "zero_quantity",
    });
  });

  it("skips negatives as negative_quantity (no package exchange in this phase)", () => {
    expect(resolveEffectiveQuantity(-1)).toEqual({
      effective: null,
      skipReason: "negative_quantity",
    });
    expect(resolveEffectiveQuantity(-5)).toEqual({
      effective: null,
      skipReason: "negative_quantity",
    });
  });

  it("skips NaN / infinity as invalid_quantity", () => {
    expect(resolveEffectiveQuantity(Number.NaN)).toEqual({
      effective: null,
      skipReason: "invalid_quantity",
    });
    expect(resolveEffectiveQuantity(Number.POSITIVE_INFINITY)).toEqual({
      effective: null,
      skipReason: "invalid_quantity",
    });
  });
});

describe("computeInclusiveExpiry (whole-cycle helper)", () => {
  it("qty=1 × 1y from 2026-06-01 → 2027-05-31", () => {
    expect(iso(computeInclusiveExpiry(utc(2026, 5, 1), 1, "year"))).toBe("2027-05-31");
  });

  it("leap-year rollover: 2028-02-29 + 1y − 1d → 2029-02-28", () => {
    expect(iso(computeInclusiveExpiry(utc(2028, 1, 29), 1, "year"))).toBe("2029-02-28");
  });
});

describe("computeExpiryForQuantity — whole quantities (M1D2604002 acceptance)", () => {
  const start = utc(2026, 5, 1); // 2026-06-01, cycle=1y

  it("qty=1 → 2027-05-31", () => {
    expect(iso(computeExpiryForQuantity(start, 1, "year", 1))).toBe("2027-05-31");
  });

  it("qty=2 → 2028-05-31 (QCA--PRO)", () => {
    expect(iso(computeExpiryForQuantity(start, 1, "year", 2))).toBe("2028-05-31");
  });

  it("qty=3 → 2029-05-31 (QCA-VIP)", () => {
    expect(iso(computeExpiryForQuantity(start, 1, "year", 3))).toBe("2029-05-31");
  });

  it("qty=6 × 1mo from 2026-01-15 → 2026-07-14", () => {
    expect(iso(computeExpiryForQuantity(utc(2026, 0, 15), 1, "month", 6))).toBe("2026-07-14");
  });

  it("qty=12 × 1mo uses calendar arithmetic, not 365 days", () => {
    expect(iso(computeExpiryForQuantity(utc(2026, 0, 15), 1, "month", 12))).toBe("2027-01-14");
  });
});

describe("computeExpiryForQuantity — fractional quantities", () => {
  it("qty=1.5 × 1y from 2026-06-01 applies 1 whole year + rounded half of next-year period", () => {
    // wholeEnd = 2027-06-01. next-year period 2027-06-01→2028-06-01 = 366 days
    // (crosses 2028-02-29). extra = round(366 * 0.5) = 183. Final exclusive
    // 2027-06-01 + 183 days = 2027-12-01. Inclusive expiry = 2027-11-30.
    expect(iso(computeExpiryForQuantity(utc(2026, 5, 1), 1, "year", 1.5))).toBe("2027-11-30");
  });

  it("qty=1.7 × 1y from 2026-06-01 → adds ~256 fractional days", () => {
    // next-year period = 366 days. extra = round(366 * 0.7) = 256.
    // 2027-06-01 + 256 days = 2028-02-12. Inclusive = 2028-02-11.
    expect(iso(computeExpiryForQuantity(utc(2026, 5, 1), 1, "year", 1.7))).toBe("2028-02-11");
  });

  it("qty=1.7 × 1y from 2025-06-01 → 621 days total (spec sample)", () => {
    // wholeEnd = 2026-06-01. next-year period 2026-06-01→2027-06-01 = 365 days.
    // extra = round(365 * 0.7) = 256. Final exclusive = 2027-02-11.
    // From start 2025-06-01 to 2027-02-11 = 620 days; inclusive = 2027-02-10
    // spans 621 calendar days (start .. expiry inclusive).
    const expiry = computeExpiryForQuantity(utc(2025, 5, 1), 1, "year", 1.7);
    expect(iso(expiry)).toBe("2027-02-10");
    const spanDays =
      Math.round((expiry.getTime() - utc(2025, 5, 1).getTime()) / 86_400_000) + 1;
    expect(spanDays).toBe(621);
  });

  it("qty=1.5 × 1mo from 2026-01-01 uses actual next-month length (Feb 28) — inclusive 2026-02-14", () => {
    // wholeEnd = 2026-02-01. next month = 28 days (Feb 2026, non-leap).
    // extra = round(28 * 0.5) = 14. Final exclusive = 2026-02-15. Inclusive = 2026-02-14.
    expect(iso(computeExpiryForQuantity(utc(2026, 0, 1), 1, "month", 1.5))).toBe("2026-02-14");
  });

  it("qty=1.5 × 1mo from 2024-01-01 uses leap-year Feb (29 days)", () => {
    // wholeEnd = 2024-02-01. next month = 29 days. extra = round(29 * 0.5) = 15
    // (Math.round rounds 14.5 up). Final exclusive = 2024-02-16. Inclusive = 2024-02-15.
    expect(iso(computeExpiryForQuantity(utc(2024, 0, 1), 1, "month", 1.5))).toBe("2024-02-15");
  });

  it("qty=0.5 × 1y from 2026-06-01 → half a next-year period from start", () => {
    // whole=0, wholeEnd=start. next-year 2026-06-01→2027-06-01 = 365 days.
    // extra = round(365 * 0.5) = 183 (Math.round rounds 182.5 up).
    // exclusive = start+183 = 2026-12-01. inclusive = 2026-11-30.
    expect(iso(computeExpiryForQuantity(utc(2026, 5, 1), 1, "year", 0.5))).toBe("2026-11-30");
  });
});
