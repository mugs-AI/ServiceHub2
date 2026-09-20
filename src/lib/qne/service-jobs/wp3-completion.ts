// WP3 — Simple Atomic Completion: pure rules (no I/O, isomorphic).
//
// The server re-checks every rule in this file inside the completion
// transaction; the UI uses the same helpers so the two cannot drift.
//
// Deliberately NOT part of WP3: checklist, diagnosis, action taken, test
// result, customer acknowledgement, waiver, signature, follow-up date and
// service-report generation. Those legacy fields stay in the database for
// historical rows but are never collected or shown as evidence.

export const MAX_RESOLUTION_SUMMARY = 4000;

/** Statuses from which a Job can never be completed. */
export const COMPLETION_BLOCKED_STATUSES: readonly string[] = [
  "Completed",
  "Cancelled",
  "Pending Approval",
];

export interface CompletionJobFacts {
  status: string;
  is_deleted: boolean;
  assigned_user_id: string | null;
}

export interface CompletionActorFacts {
  actorUserId: string | null;
  isAdmin: boolean;
}

/**
 * Only the Job's canonical Primary PIC (assigned technician) or an
 * Owner/Admin may complete. A teammate who merely helped is denied.
 */
export function canCompleteJob(actor: CompletionActorFacts, job: CompletionJobFacts): boolean {
  if (!actor.actorUserId) return false;
  if (actor.isAdmin) return true;
  return job.assigned_user_id === actor.actorUserId;
}

/**
 * Readiness, in priority order. Returns null when the Job may be completed.
 * `openAttendanceCount` is the number of on-site attendance rows for this Job
 * whose clock_out_at is still null.
 */
export function completionBlockedReason(
  job: CompletionJobFacts,
  openAttendanceCount: number,
): string | null {
  if (job.is_deleted) return "Deleted jobs cannot be completed.";
  if (job.status === "Completed") return "This Job is already completed.";
  if (job.status === "Cancelled" || job.status === "Pending Approval") {
    return `${job.status} jobs cannot be completed.`;
  }
  if (openAttendanceCount > 0) {
    return "Clock out of on-site attendance before completing this Job.";
  }
  return null;
}

export interface CompletionInput {
  resolution_summary: string;
  follow_up_required: boolean;
}

export type CompletionInputResult =
  | { ok: true; value: CompletionInput }
  | { ok: false; error: string };

/**
 * Strict parse: nothing is coerced. The summary must be a trimmed non-empty
 * string within the bound, and the follow-up flag must be a real boolean
 * when present.
 */
export function parseCompletionInput(body: unknown): CompletionInputResult {
  const raw = (body ?? {}) as Record<string, unknown>;
  const summary = raw.resolution_summary;
  if (typeof summary !== "string" || !summary.trim()) {
    return { ok: false, error: "A resolution summary is required." };
  }
  const trimmed = summary.trim();
  if (trimmed.length > MAX_RESOLUTION_SUMMARY) {
    return {
      ok: false,
      error: `The resolution summary must be ${MAX_RESOLUTION_SUMMARY} characters or fewer.`,
    };
  }
  const follow = raw.follow_up_required;
  if (follow !== undefined && typeof follow !== "boolean") {
    return { ok: false, error: "Invalid follow-up value." };
  }
  return { ok: true, value: { resolution_summary: trimmed, follow_up_required: follow === true } };
}

/* ---------------- display state ---------------- */

export interface CompletionRecord {
  resolution_summary: string | null;
  follow_up_required: boolean;
  completed_by_name_snapshot: string | null;
  completed_by_user_id: string | null;
  completed_at: string | null;
}

export const LEGACY_COMPLETION_LABEL = "Legacy completion — no completion evidence";

export type CompletionView =
  | { mode: "form" }
  | { mode: "blocked"; reason: string }
  | { mode: "locked"; record: CompletionRecord }
  | { mode: "legacy"; label: string };

/**
 * What the card should render. A Job that is Completed without a completion
 * record is a legacy completion: it is labelled, never backfilled.
 */
export function completionView(input: {
  status: string;
  is_deleted: boolean;
  record: CompletionRecord | null;
  blockedReason: string | null;
}): CompletionView {
  if (input.status === "Completed") {
    if (input.record) return { mode: "locked", record: input.record };
    return { mode: "legacy", label: LEGACY_COMPLETION_LABEL };
  }
  if (input.blockedReason) return { mode: "blocked", reason: input.blockedReason };
  return { mode: "form" };
}
