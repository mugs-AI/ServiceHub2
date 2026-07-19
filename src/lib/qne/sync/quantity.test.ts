// Phase 1.1.6c — regression tests for quantity-driven expiry.
//
// Pins the resolveEffectiveQuantity rules AND the qty × cycle expiry
// math that Workspace entitlements depend on.

import { describe, expect, it } from "vitest";
import {
  computeInclusiveExpiry,
  resolveEffectiveQuantity,
} from "./subscription-sync.server";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("resolveEffectiveQuantity", () => {
  it("treats null / undefined as qty = 1", () => {
    expect(resolveEffectiveQuantity(null)).toEqual({ effective: 1 });
    expect(resolveEffectiveQuantity(undefined)).toEqual({ effective: 1 });
  });

  it("accepts positive integers verbatim", () => {
    for (const q of [1, 2, 3, 12, 60]) {
      expect(resolveEffectiveQuantity(q)).toEqual({ effective: q });
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

  it("skips fractions without rounding", () => {
    for (const q of [0.5, 1.5, 2.25, 12.75]) {
      expect(resolveEffectiveQuantity(q)).toEqual({
        effective: null,
        skipReason: "fractional_quantity",
      });
    }
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

describe("computeInclusiveExpiry with qty × cycle", () => {
  // Acceptance: M1D2604002 doc date 2026-06-01, 1y cycle.
  const start = new Date(Date.UTC(2026, 5, 1));

  it("qty=1 × 1y → 2027-05-31", () => {
    expect(iso(computeInclusiveExpiry(start, 1 * 1, "year"))).toBe("2027-05-31");
  });

  it("qty=2 × 1y → 2028-05-31 (QCA--PRO acceptance)", () => {
    expect(iso(computeInclusiveExpiry(start, 1 * 2, "year"))).toBe("2028-05-31");
  });

  it("qty=3 × 1y → 2029-05-31 (QCA-VIP acceptance)", () => {
    expect(iso(computeInclusiveExpiry(start, 1 * 3, "year"))).toBe("2029-05-31");
  });

  it("qty=6 × 1mo → +6 months − 1 day", () => {
    const s = new Date(Date.UTC(2026, 0, 15));
    expect(iso(computeInclusiveExpiry(s, 1 * 6, "month"))).toBe("2026-07-14");
  });

  it("qty=12 × 1mo uses calendar arithmetic, not 365 days", () => {
    const s = new Date(Date.UTC(2026, 0, 15));
    expect(iso(computeInclusiveExpiry(s, 1 * 12, "month"))).toBe("2027-01-14");
  });

  it("leap-year rollover: 2028-02-29 + 1y − 1d", () => {
    const s = new Date(Date.UTC(2028, 1, 29));
    expect(iso(computeInclusiveExpiry(s, 1, "year"))).toBe("2029-02-27");
  });
});
