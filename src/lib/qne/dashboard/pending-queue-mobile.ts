// WP3C UAT — mobile Pending Queue simplification.
//
// The Pending Queue keeps every scope it already had, with byte-identical
// scope keys and query semantics. On small screens only a compact primary set
// is shown inline; every remaining scope stays reachable through the
// "More Filters" control. This module is the single source of truth for which
// scopes are primary, so a UI change can never quietly drop a scope.

import { QUEUE_REOPEN_REQUESTS } from "@/lib/qne/service-jobs/wp3a-queues";

/** Compact mobile set, in display order. `""` is the All Pending scope. */
export const MOBILE_PRIMARY_QUEUE_KEYS: readonly string[] = [
  "",
  "assigned_not_started",
  "in_progress",
  "waiting_customer",
  "waiting_vendor",
  QUEUE_REOPEN_REQUESTS,
] as const;

export function isPrimaryMobileQueue(key: string): boolean {
  return MOBILE_PRIMARY_QUEUE_KEYS.includes(key);
}

/** Every scope that moves into "More Filters" on mobile, order preserved. */
export function secondaryMobileQueues<T extends { key: string }>(all: readonly T[]): T[] {
  return all.filter((t) => !isPrimaryMobileQueue(t.key));
}

/** Primary scopes in display order, resolved against the full tab list. */
export function primaryMobileQueues<T extends { key: string }>(all: readonly T[]): T[] {
  return MOBILE_PRIMARY_QUEUE_KEYS.map((k) => all.find((t) => t.key === k)).filter(
    (t): t is T => t !== undefined,
  );
}
