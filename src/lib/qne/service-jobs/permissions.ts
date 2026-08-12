// WP0E — SME Collaborative permission policy (pure, isomorphic).
//
// ServiceHub is a shared SME service workspace. The assigned user is the
// Primary PIC, not the exclusive owner of the Job. Ordinary Software-support
// transitions may be performed by any authenticated same-tenant teammate,
// while high-risk / terminal / administrative actions keep stronger controls.
//
// This module holds the approved policy in one place so the server routes and
// the UI cannot drift apart. It is pure: no I/O, no Supabase, no session.

/** Ordinary collaborative Software-support transitions (teammate-allowed). */
export const COLLABORATIVE_TRANSITIONS: ReadonlyArray<readonly [string, string]> = [
  ["Open", "In Progress"],
  ["Assigned", "In Progress"],
  ["In Progress", "Waiting Customer"],
  ["In Progress", "Waiting Vendor"],
  ["Waiting Customer", "In Progress"],
  ["Waiting Vendor", "In Progress"],
];

export function isCollaborativeTransition(from: string, to: string): boolean {
  return COLLABORATIVE_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/**
 * Generic Complete is intentionally removed in WP0E. Completion will return
 * through its dedicated completion vertical; until then no generic path may
 * mark a Job Completed.
 */
export function isGenericCompleteBlocked(to: string): boolean {
  return to === "Completed";
}

/* ---------------- cancellation ---------------- */

export interface CancelActor {
  isAdministrator: boolean;
  /** Server-resolved authenticated N3 user id. */
  actorUserId: string | null;
}

export interface CancelJobFacts {
  createdByUserId: string | null;
  assignedUserId: string | null;
}

/**
 * Cancellation is responsibility-controlled: Owner/Admin always, otherwise
 * only the Job creator or the current Primary PIC. A teammate who is merely
 * helping is denied server-side (not just hidden in the UI).
 */
export function canCancelJob(actor: CancelActor, job: CancelJobFacts): boolean {
  if (actor.isAdministrator) return true;
  if (!actor.actorUserId) return false;
  return job.createdByUserId === actor.actorUserId || job.assignedUserId === actor.actorUserId;
}

/* ---------------- Primary PIC takeover ---------------- */

/** Statuses from which a Job may be claimed or taken over. */
export const TAKEOVER_STATUSES: readonly string[] = [
  "Open",
  "Assigned",
  "In Progress",
  "Waiting Customer",
  "Waiting Vendor",
];

export function isTakeoverEligibleStatus(status: string): boolean {
  return TAKEOVER_STATUSES.includes(status);
}

/** A reason is only required when replacing another person as Primary PIC. */
export function takeoverRequiresReason(
  currentAssignedUserId: string | null,
  actorUserId: string,
): boolean {
  return !!currentAssignedUserId && currentAssignedUserId !== actorUserId;
}

export type ClaimDecision =
  | { ok: true; action: "assigned" | "reassigned" }
  | { ok: false; error: string };

export function evaluateClaim(input: {
  status: string;
  isDeleted: boolean;
  assignedUserId: string | null;
  actorUserId: string;
  reason: string | null;
}): ClaimDecision {
  if (input.isDeleted) return { ok: false, error: "Deleted jobs cannot be claimed." };
  if (!isTakeoverEligibleStatus(input.status)) {
    return { ok: false, error: `Cannot claim a ${input.status} job.` };
  }
  if (takeoverRequiresReason(input.assignedUserId, input.actorUserId)) {
    if (!input.reason || !input.reason.trim()) {
      return {
        ok: false,
        error: "A takeover reason is required to replace the current Primary PIC.",
      };
    }
    return { ok: true, action: "reassigned" };
  }
  return { ok: true, action: "assigned" };
}
