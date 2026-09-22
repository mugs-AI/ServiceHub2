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

/* ---------------- shared counting ---------------- */

export interface ScopeRow {
  outcome: CompletionOutcome;
  assigned_user_id: string | null;
  completed_at: string | null;
  /** Follow-up clear timestamp, when the cycle had a follow-up. */
  followup_resolved_at?: string | null;
  /**
   * The ACTUAL resolution actor for this cycle — completion actor when it
   * resolved at completion, clearing actor when it resolved after a follow-up.
   * Never the current assignee.
   */
  resolved_by_user_id?: string | null;
}

/**
 * When a completed cycle became Resolved: the completion timestamp for a
 * no-tick completion, the clear timestamp for a cleared follow-up.
 */
export function resolvedAtFor(row: ScopeRow): string | null {
  if (row.outcome === "resolved_after_follow_up") return row.followup_resolved_at ?? null;
  if (row.outcome === "resolved_at_completion") return row.completed_at ?? null;
  return null;
}

/**
 * Who gets performance credit for a resolved cycle. Reassigning a Job after
 * completion must never move this away from the person who actually resolved
 * it, so the assignee is deliberately not consulted here.
 */
export function resolvedByFor(row: ScopeRow): string | null {
  if (row.outcome === "resolved_at_completion" || row.outcome === "resolved_after_follow_up") {
    return row.resolved_by_user_id ?? null;
  }
  return null;
}

export interface ScopeCounts {
  completed: number;
  resolved: number;
  followUpOpen: number;
  reopenPending: number;
  legacyUnknown: number;
  resolvedToday: number;
  myFollowUps: number;
  myReopenPending: number;
  resolvedByMeToday: number;
}

/**
 * The one definition every WP3B card count uses. The destination list applies
 * the same predicates (see outcomesForQueue), so a count and its list agree.
 */
export function countScopes(
  rows: readonly ScopeRow[],
  opts: { meUserId?: string | null; todayFromIso?: string; todayToIso?: string } = {},
): ScopeCounts {
  const me = opts.meUserId ?? null;
  const inToday = (iso: string | null): boolean => {
    if (!iso || !opts.todayFromIso || !opts.todayToIso) return false;
    return iso >= opts.todayFromIso && iso < opts.todayToIso;
  };

  const counts: ScopeCounts = {
    completed: 0,
    resolved: 0,
    followUpOpen: 0,
    reopenPending: 0,
    legacyUnknown: 0,
    resolvedToday: 0,
    myFollowUps: 0,
    myReopenPending: 0,
    resolvedByMeToday: 0,
  };

  for (const row of rows) {
    // Workload scopes ("My Follow-ups", "My Reopen Pending") follow the
    // currently assigned technician. The performance scope below does not.
    const mine = me !== null && row.assigned_user_id === me;
    if (row.outcome === "legacy_unknown") {
      counts.legacyUnknown += 1;
      continue;
    }
    counts.completed += 1;
    if (row.outcome === "follow_up_open") {
      counts.followUpOpen += 1;
      if (mine) counts.myFollowUps += 1;
    } else if (row.outcome === "reopen_pending") {
      counts.reopenPending += 1;
      if (mine) counts.myReopenPending += 1;
    } else {
      counts.resolved += 1;
      if (inToday(resolvedAtFor(row))) {
        counts.resolvedToday += 1;
        // "Resolved by Me Today" credits the ACTUAL resolution actor.
        if (me !== null && resolvedByFor(row) === me) counts.resolvedByMeToday += 1;
      }
    }
  }

  return counts;
}
