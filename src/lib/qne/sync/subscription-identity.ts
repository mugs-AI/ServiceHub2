// Phase 1.1.7 — Pure identity-key helpers for subscription snapshots.
//
// Kept side-effect free so the immutable-vs-legacy rule can be pinned by
// regression tests without touching the live rebuild pipeline. The rule
// itself is unchanged from Phase 1.1.4:
//
//   • Immutable key wins when BOTH n3_customer_id AND n3_stock_id exist
//     on the renewal event / snapshot row:
//         id::<n3_customer_id>::<category>::<n3_stock_id>
//
//   • Legacy key is used purely for migration — matches the mutable
//     (customer_code, category, stock_code) triple:
//         legacy::<customer_code>::<category>::<stock_code|"">
//
// Both keys are case-sensitive on category on purpose: the sync engine
// preserves the exact category name the mapping was configured with, and
// two categories that differ only in case would be two distinct
// subscriptions in the UI.

export function subscriptionImmutableKey(
  n3CustomerId: string | null | undefined,
  category: string,
  n3StockId: string | null | undefined,
): string | null {
  if (!n3CustomerId || !n3StockId) return null;
  return `id::${n3CustomerId}::${category}::${n3StockId}`;
}

export function subscriptionLegacyKey(
  customerCode: string,
  category: string,
  stockCode: string | null | undefined,
): string {
  return `legacy::${customerCode}::${category}::${stockCode ?? ""}`;
}

/**
 * Resolve the effective identity key for a renewal event / snapshot row.
 * Immutable IDs are preferred; the legacy key is a strict fallback.
 */
export function subscriptionIdentityKey(input: {
  n3CustomerId: string | null | undefined;
  n3StockId: string | null | undefined;
  customerCode: string;
  category: string;
  stockCode: string | null | undefined;
}): string {
  return (
    subscriptionImmutableKey(input.n3CustomerId, input.category, input.n3StockId) ??
    subscriptionLegacyKey(input.customerCode, input.category, input.stockCode)
  );
}
