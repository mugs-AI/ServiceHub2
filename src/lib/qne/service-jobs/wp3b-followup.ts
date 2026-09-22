// WP3B — Follow-up Open / Clear / Reopen: pure rules (no I/O, isomorphic).
//
// Owner-accepted accounting contract for the CURRENT completion cycle:
//   Completed total = Resolved + Follow-up Open + Reopen Pending
// where Resolved = resolved_at_completion + resolved_after_follow_up.
//
// A Completed Job with no modern completion evidence for its current cycle is
// Legacy/Unknown. It is never counted as Resolved and never backfilled.
//
// The server re-checks every rule here inside the follow-up transaction; the
// UI uses the same helpers so the two cannot drift.

export const MAX_FOLLOWUP_NOTE = 2000;

export const FOLLOWUP_STATES = ["open", "resolved", "reopened"] as const;
export type FollowupState = (typeof FOLLOWUP_STATES)[number];

export const COMPLETION_OUTCOMES = [
  "resolved_at_completion",
  "follow_up_open",
  "resolved_after_follow_up",
  "reopen_pending",
  "legacy_unknown",
] as const;
export type CompletionOutcome = (typeof COMPLETION_OUTCOMES)[number];

/** Compact semantic badge label for the locked completion card. */
export const OUTCOME_LABEL: Record<CompletionOutcome, string> = {
  resolved_at_completion: "Resolved",
  resolved_after_follow_up: "Resolved",
  follow_up_open: "Follow-up Open",
  reopen_pending: "Reopen Pending",
  legacy_unknown: "Legacy completion",
};

/** Outcomes that belong to the "Resolved" bucket of the accounting contract. */
export const RESOLVED_OUTCOMES: readonly CompletionOutcome[] = [
  "resolved_at_completion",
  "resolved_after_follow_up",
];

export interface FollowupRow {
  id: string;
  completion_cycle: number;
  state: FollowupState;
  opened_at: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolved_by_name_snapshot: string | null;
  resolution_note: string | null;
  reopened_at: string | null;
}

export interface OutcomeFacts {
  /** Current Job status (only "Completed" produces an outcome). */
  jobStatus: string;
  isDeleted: boolean;
  /** Completion evidence for the Job's CURRENT cycle, or null. */
  completion: { follow_up_required: boolean } | null;
  /** Follow-up evidence for the Job's CURRENT cycle, or null. */
  followup: Pick<FollowupRow, "state"> | null;
  hasPendingReopen: boolean;
}

/**
 * The single derivation used by the Job card, the dashboards and the Pending
 * Queue. Returns null when the Job is not part of Completed totals at all.
 */
export function deriveOutcome(facts: OutcomeFacts): CompletionOutcome | null {
  if (facts.isDeleted) return null;
  if (facts.jobStatus !== "Completed") return null;
  if (!facts.completion) return "legacy_unknown";
  if (facts.hasPendingReopen) return "reopen_pending";
  if (!facts.completion.follow_up_required) return "resolved_at_completion";
  const state = facts.followup?.state ?? "open";
  if (state === "resolved") return "resolved_after_follow_up";
  if (state === "reopened") return "reopen_pending";
  return "follow_up_open";
}

export function isResolvedOutcome(outcome: CompletionOutcome | null): boolean {
  return outcome !== null && RESOLVED_OUTCOMES.includes(outcome);
}

/** Formula parity helper: modern (non-legacy) completed cycles only. */
export function outcomeTotals(outcomes: readonly (CompletionOutcome | null)[]): {
  completed: number;
  resolved: number;
  followUpOpen: number;
  reopenPending: number;
  legacyUnknown: number;
} {
  let resolved = 0;
  let followUpOpen = 0;
  let reopenPending = 0;
  let legacyUnknown = 0;
  for (const o of outcomes) {
    if (o === null) continue;
    if (o === "legacy_unknown") legacyUnknown += 1;
    else if (o === "follow_up_open") followUpOpen += 1;
    else if (o === "reopen_pending") reopenPending += 1;
    else resolved += 1;
  }
  return {
    completed: resolved + followUpOpen + reopenPending,
    resolved,
    followUpOpen,
    reopenPending,
    legacyUnknown,
  };
}

/* ---------------- clear follow-up ---------------- */

export interface FollowupJobFacts {
  status: string;
  is_deleted: boolean;
  assigned_user_id: string | null;
}

export interface FollowupActorFacts {
  actorUserId: string | null;
  isAdmin: boolean;
}

/** Only the Job's assigned technician or an Owner/Admin may clear. */
export function canClearFollowup(actor: FollowupActorFacts, job: FollowupJobFacts): boolean {
  if (!actor.actorUserId) return false;
  if (actor.isAdmin) return true;
  return job.assigned_user_id === actor.actorUserId;
}

/** Null when the follow-up may be cleared, otherwise a user-facing reason. */
export function followupBlockedReason(
  job: FollowupJobFacts,
  followup: Pick<FollowupRow, "state"> | null,
): string | null {
  if (job.is_deleted) return "Deleted jobs have no follow-up to clear.";
  if (job.status !== "Completed") {
    return "Only a Completed Job can have its follow-up cleared.";
  }
  if (!followup) return "This Job has no follow-up for its current completion cycle.";
  if (followup.state === "resolved") return "This follow-up has already been cleared.";
  if (followup.state !== "open") return "This follow-up is no longer open.";
  return null;
}

export type FollowupClearResult = { ok: true; value: string } | { ok: false; error: string };

/** Strict parse: the result note is mandatory, trimmed and bounded. */
export function parseFollowupClearInput(body: unknown): FollowupClearResult {
  const raw = (body ?? {}) as Record<string, unknown>;
  const note = raw.resolution_note;
  if (typeof note !== "string" || !note.trim()) {
    return { ok: false, error: "A follow-up result is required." };
  }
  const trimmed = note.trim();
  if (trimmed.length > MAX_FOLLOWUP_NOTE) {
    return {
      ok: false,
      error: `The follow-up result must be ${MAX_FOLLOWUP_NOTE} characters or fewer.`,
    };
  }
  return { ok: true, value: trimmed };
}

/* ---------------- card view ---------------- */

export type FollowupView =
  | { mode: "hidden" }
  | { mode: "open"; canClear: boolean }
  | { mode: "resolved"; record: FollowupRow }
  | { mode: "reopened" };

/**
 * What the locked completion card should render for the follow-up area.
 *
 * Defensive rule: an action is offered ONLY when durable follow-up evidence
 * exists for the current cycle. A ticked completion with no row still shows a
 * "Follow-up Open" badge (the outcome derivation owns that), but it is never
 * presented as actionable, because the server would reject the clear. The
 * candidate migration's additive materialisation creates the missing rows, at
 * which point those jobs become both open and clearable.
 */
export function followupView(input: {
  job: FollowupJobFacts;
  followup: FollowupRow | null;
  actor: FollowupActorFacts;
}): FollowupView {
  const fu = input.followup;
  if (!fu) return { mode: "hidden" };
  if (fu.state === "resolved") return { mode: "resolved", record: fu };
  if (fu.state === "reopened") return { mode: "reopened" };
  if (input.job.status !== "Completed" || input.job.is_deleted) return { mode: "hidden" };
  return { mode: "open", canClear: canClearFollowup(input.actor, input.job) };
}
