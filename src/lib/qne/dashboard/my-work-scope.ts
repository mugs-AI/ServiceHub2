// Shared "My Work" status scopes.
//
// The User Dashboard cards and /api/dashboard/my-work MUST agree: a card count
// and the list it opens are the same scope, expressed once here so they can
// never drift apart again (an "Assigned to Me" count of 1 must never open a
// list of 0 because the job happened to be In Progress).

/** Every non-terminal status counted by the "Assigned to Me" card. */
export const ASSIGNED_TO_ME_STATUSES = [
  "Draft",
  "Pending Approval",
  "Open",
  "Assigned",
  "In Progress",
  "Waiting Customer",
  "Waiting Vendor",
] as const;

/** "My Pending Tasks" — the same scope minus Pending Approval. */
export const MY_PENDING_STATUSES = [
  "Draft",
  "Assigned",
  "In Progress",
  "Waiting Customer",
  "Waiting Vendor",
] as const;

export type MyWorkStatus = (typeof ASSIGNED_TO_ME_STATUSES)[number];

/** Terminal statuses are never part of a My Work card scope. */
export const TERMINAL_STATUSES = ["Completed", "Cancelled"] as const;

/**
 * The status list a My Work card must apply when it is clicked. Returning a
 * copy keeps callers from mutating the shared constant.
 */
export function cardStatusScope(card: "assignedToMe" | "myPendingTasks"): string[] {
  return card === "assignedToMe"
    ? [...ASSIGNED_TO_ME_STATUSES]
    : [...MY_PENDING_STATUSES];
}
