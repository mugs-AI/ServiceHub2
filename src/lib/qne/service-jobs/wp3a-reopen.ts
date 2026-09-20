// WP3A — Completed Job reopen request + Owner/Admin decision: pure rules.
//
// A reopen request never changes the Job by itself. Approval is the only path
// back to In Progress, and prior completion evidence is immutable in every
// case: reopening advances a completion cycle instead of rewriting history.

export const MAX_REOPEN_REASON = 2000;
export const MAX_REOPEN_NOTE = 2000;

export const REOPEN_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReopenStatus = (typeof REOPEN_STATUSES)[number];

export interface ReopenRequestRow {
  id: string;
  status: ReopenStatus;
  reason: string;
  prior_status: string;
  completion_cycle_at_request: number;
  requested_by_user_id: string | null;
  requested_by_name_snapshot: string | null;
  requested_at: string;
  decision_note: string | null;
  decided_by_name_snapshot: string | null;
  decided_at: string | null;
}

export type ReopenReasonResult = { ok: true; value: string } | { ok: false; error: string };

/** Strict parse of the requester's reason — 1..2000 characters after trimming. */
export function parseReopenReason(body: unknown): ReopenReasonResult {
  const raw = (body ?? {}) as Record<string, unknown>;
  const reason = raw.reason;
  if (typeof reason !== "string" || !reason.trim()) {
    return { ok: false, error: "A reopen reason is required." };
  }
  const trimmed = reason.trim();
  if (trimmed.length > MAX_REOPEN_REASON) {
    return { ok: false, error: `The reopen reason must be ${MAX_REOPEN_REASON} characters or fewer.` };
  }
  return { ok: true, value: trimmed };
}

export interface ReopenDecisionInput {
  decision: "approve" | "reject";
  note: string | null;
}

export type ReopenDecisionResult =
  | { ok: true; value: ReopenDecisionInput }
  | { ok: false; error: string };

/** Strict parse of an Owner/Admin decision. The note is optional, bounded. */
export function parseReopenDecision(body: unknown): ReopenDecisionResult {
  const raw = (body ?? {}) as Record<string, unknown>;
  const decision = raw.decision;
  if (decision !== "approve" && decision !== "reject") {
    return { ok: false, error: "Invalid decision." };
  }
  const note = raw.note;
  if (note !== undefined && note !== null && typeof note !== "string") {
    return { ok: false, error: "Invalid decision note." };
  }
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (trimmed.length > MAX_REOPEN_NOTE) {
    return { ok: false, error: `The decision note must be ${MAX_REOPEN_NOTE} characters or fewer.` };
  }
  return { ok: true, value: { decision, note: trimmed || null } };
}

export interface ReopenJobFacts {
  status: string;
  is_deleted: boolean;
}

/**
 * Whether an authenticated user may ask for this Job to be reopened. Any
 * authenticated user of the tenant may ask; only Owner/Admin may decide.
 * A legacy Completed Job with no completion evidence is reopenable too — no
 * historical completion is ever invented to make that possible.
 */
export function canRequestReopen(job: ReopenJobFacts, hasPending: boolean): boolean {
  return !job.is_deleted && job.status === "Completed" && !hasPending;
}

/** Null when a reopen request may be created, otherwise the user-facing reason. */
export function reopenBlockedReason(job: ReopenJobFacts, hasPending: boolean): string | null {
  if (job.is_deleted) return "Deleted jobs cannot be reopened.";
  if (job.status !== "Completed") return "Only a Completed Job can be reopened.";
  if (hasPending) return "A reopen request is already awaiting an Owner/Admin decision.";
  return null;
}

export type ReopenView =
  | { mode: "hidden" }
  | { mode: "request" }
  | { mode: "pending"; request: ReopenRequestRow; canDecide: boolean }
  | { mode: "blocked"; reason: string };

/** What the completion card should render for the reopen area. */
export function reopenView(input: {
  job: ReopenJobFacts;
  pending: ReopenRequestRow | null;
  isAdmin: boolean;
}): ReopenView {
  if (input.pending) {
    return { mode: "pending", request: input.pending, canDecide: input.isAdmin };
  }
  if (input.job.is_deleted || input.job.status !== "Completed") return { mode: "hidden" };
  const blocked = reopenBlockedReason(input.job, false);
  return blocked ? { mode: "blocked", reason: blocked } : { mode: "request" };
}
