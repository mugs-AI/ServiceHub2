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

export const MY_WORK_SCOPES = [
  "my_pending_tasks",
  "assigned_to_me",
  "my_in_progress",
  "waiting_approval",
  "waiting_customer",
  "waiting_vendor",
  "my_followups",
  "my_reopen_pending",
  "resolved_by_me_today",
] as const;

export type MyWorkScope = (typeof MY_WORK_SCOPES)[number];

export function isMyWorkScope(value: unknown): value is MyWorkScope {
  return typeof value === "string" && (MY_WORK_SCOPES as readonly string[]).includes(value);
}

export function statusesForMyWorkScope(scope: MyWorkScope): readonly string[] | null {
  if (scope === "my_pending_tasks") return MY_PENDING_STATUSES;
  if (scope === "assigned_to_me") return ASSIGNED_TO_ME_STATUSES;
  if (scope === "my_in_progress") return ["In Progress"];
  if (scope === "waiting_approval") return ["Pending Approval"];
  if (scope === "waiting_customer") return ["Waiting Customer"];
  if (scope === "waiting_vendor") return ["Waiting Vendor"];
  return null;
}

export function isLifecycleMyWorkScope(scope: MyWorkScope): boolean {
  return statusesForMyWorkScope(scope) === null;
}

/**
 * The status list a My Work card must apply when it is clicked. Returning a
 * copy keeps callers from mutating the shared constant.
 */
export function cardStatusScope(card: "assignedToMe" | "myPendingTasks"): string[] {
  return card === "assignedToMe" ? [...ASSIGNED_TO_ME_STATUSES] : [...MY_PENDING_STATUSES];
}
