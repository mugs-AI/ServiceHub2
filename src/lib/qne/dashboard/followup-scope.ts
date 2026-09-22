// WP3B — shared outcome scopes for dashboards and the Pending Queue.
//
// A card count and the list it opens MUST call the same scope definition, so
// both are expressed once here. Tenant and actor are always supplied by the
// server from the authenticated N3 session; the browser only names a scope.

import type { CompletionOutcome } from "@/lib/qne/service-jobs/wp3b-followup";

export const SCOPE_FOLLOW_UP_OPEN = "follow_up_open";
export const SCOPE_REOPEN_PENDING = "reopen_pending";
export const SCOPE_RESOLVED = "resolved";

/** Stable URL keys for Pending Queue deep links from dashboard cards. */
export const WP3B_QUEUE_KEYS = [
  SCOPE_FOLLOW_UP_OPEN,
  SCOPE_REOPEN_PENDING,
  SCOPE_RESOLVED,
] as const;
export type Wp3bQueueKey = (typeof WP3B_QUEUE_KEYS)[number];

export function isWp3bQueueKey(value: unknown): value is Wp3bQueueKey {
  return typeof value === "string" && (WP3B_QUEUE_KEYS as readonly string[]).includes(value);
}

/** The outcomes a queue key selects. Legacy/Unknown is never part of one. */
export function outcomesForQueue(key: Wp3bQueueKey): CompletionOutcome[] {
  if (key === SCOPE_FOLLOW_UP_OPEN) return ["follow_up_open"];
  if (key === SCOPE_REOPEN_PENDING) return ["reopen_pending"];
  return ["resolved_at_completion", "resolved_after_follow_up"];
}

/** Dashboard card keys, tenant-wide and personal. */
export const WP3B_CARDS = [
  "followUpOpen",
  "reopenPending",
  "resolvedToday",
  "myFollowUps",
  "myReopenPending",
  "resolvedByMeToday",
] as const;
export type Wp3bCard = (typeof WP3B_CARDS)[number];

/** The queue a card opens, so a count and its destination cannot drift. */
export function queueForCard(card: Wp3bCard): Wp3bQueueKey {
  if (card === "followUpOpen" || card === "myFollowUps") return SCOPE_FOLLOW_UP_OPEN;
  if (card === "reopenPending" || card === "myReopenPending") return SCOPE_REOPEN_PENDING;
  return SCOPE_RESOLVED;
}

/** Personal cards additionally scope to the signed-in technician. */
export function isPersonalCard(card: Wp3bCard): boolean {
  return card === "myFollowUps" || card === "myReopenPending" || card === "resolvedByMeToday";
}

/** Cards limited to the Malaysia calendar day. */
export function isTodayCard(card: Wp3bCard): boolean {
  return card === "resolvedToday" || card === "resolvedByMeToday";
}
