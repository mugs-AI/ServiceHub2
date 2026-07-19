// Phase 1.1.7 — Identity-key regression harness.
//
// Pins the immutable-vs-legacy identity rule that governs which existing
// customer_subscription_snapshots row a renewal event adopts during
// rebuildCurrentSnapshots. A silent drift here would surface as duplicate
// entitlements or Workspace rows that never update after rename.

import { describe, expect, it } from "vitest";
import {
  subscriptionIdentityKey,
  subscriptionImmutableKey,
  subscriptionLegacyKey,
} from "./subscription-identity";

describe("subscriptionImmutableKey", () => {
  it("returns null when either N3 ID is missing", () => {
    expect(subscriptionImmutableKey(null, "Maintenance", "S1")).toBeNull();
    expect(subscriptionImmutableKey("C1", "Maintenance", null)).toBeNull();
    expect(subscriptionImmutableKey(undefined, "Maintenance", undefined)).toBeNull();
    expect(subscriptionImmutableKey("", "Maintenance", "S1")).toBeNull();
    expect(subscriptionImmutableKey("C1", "Maintenance", "")).toBeNull();
  });

  it("returns a stable id-prefixed key when both IDs exist", () => {
    expect(subscriptionImmutableKey("C1", "Maintenance", "S1")).toBe(
      "id::C1::Maintenance::S1",
    );
  });

  it("treats category as case-sensitive", () => {
    expect(subscriptionImmutableKey("C1", "Maintenance", "S1")).not.toBe(
      subscriptionImmutableKey("C1", "maintenance", "S1"),
    );
  });

  it("keeps different stock IDs on the same customer/category distinct", () => {
    expect(subscriptionImmutableKey("C1", "Maintenance", "S1")).not.toBe(
      subscriptionImmutableKey("C1", "Maintenance", "S2"),
    );
  });
});

describe("subscriptionLegacyKey", () => {
  it("uses empty string when stock_code is missing", () => {
    expect(subscriptionLegacyKey("700-K051", "Maintenance", null)).toBe(
      "legacy::700-K051::Maintenance::",
    );
    expect(subscriptionLegacyKey("700-K051", "Maintenance", undefined)).toBe(
      "legacy::700-K051::Maintenance::",
    );
  });

  it("keeps customer_code + category + stock_code combinations distinct", () => {
    expect(subscriptionLegacyKey("A", "Maintenance", "S1")).not.toBe(
      subscriptionLegacyKey("A", "Maintenance", "S2"),
    );
    expect(subscriptionLegacyKey("A", "Maintenance", "S1")).not.toBe(
      subscriptionLegacyKey("B", "Maintenance", "S1"),
    );
  });
});

describe("subscriptionIdentityKey", () => {
  it("prefers the immutable key when both N3 IDs exist (rename-safe)", () => {
    // Customer code and stock code drift over time — identity must not.
    const before = subscriptionIdentityKey({
      n3CustomerId: "C1",
      n3StockId: "S1",
      customerCode: "700-OLD",
      category: "Maintenance",
      stockCode: "STK-OLD",
    });
    const after = subscriptionIdentityKey({
      n3CustomerId: "C1",
      n3StockId: "S1",
      customerCode: "700-NEW",
      category: "Maintenance",
      stockCode: "STK-NEW",
    });
    expect(before).toBe(after);
    expect(before.startsWith("id::")).toBe(true);
  });

  it("falls back to the legacy key when either N3 ID is missing", () => {
    expect(
      subscriptionIdentityKey({
        n3CustomerId: null,
        n3StockId: "S1",
        customerCode: "700-A",
        category: "Maintenance",
        stockCode: "STK",
      }),
    ).toBe("legacy::700-A::Maintenance::STK");
    expect(
      subscriptionIdentityKey({
        n3CustomerId: "C1",
        n3StockId: null,
        customerCode: "700-A",
        category: "Maintenance",
        stockCode: "STK",
      }),
    ).toBe("legacy::700-A::Maintenance::STK");
  });

  it("groups multi-stock same-category subscriptions independently (Phase 1.1)", () => {
    // Multi-entitlement rule: same customer + category, different stock =
    // two distinct subscription rows.
    const k1 = subscriptionIdentityKey({
      n3CustomerId: "C1",
      n3StockId: "S1",
      customerCode: "700-A",
      category: "Maintenance",
      stockCode: "QCA-STD",
    });
    const k2 = subscriptionIdentityKey({
      n3CustomerId: "C1",
      n3StockId: "S2",
      customerCode: "700-A",
      category: "Maintenance",
      stockCode: "QCA-PRO",
    });
    expect(k1).not.toBe(k2);
  });
});
