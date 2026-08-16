// Feature Pack B — Service Job workflow rules (server-side).
//
// SPEC (verbatim from Feature Pack B §2 Transition matrix):
//   Draft -> Open | Pending Approval | Cancelled
//   Pending Approval -> Open | Cancelled                (via approve/reject)
//   Open -> Assigned | In Progress | Cancelled
//   Assigned -> Open | In Progress | Cancelled
//   In Progress -> Waiting Customer | Waiting Vendor | Completed | Cancelled
//   Waiting Customer -> In Progress | Cancelled
//   Waiting Vendor -> In Progress | Cancelled
//   Completed, Cancelled -> no normal transition
//
// Assignment coordination (§3):
//   - Assign to Open  → Open becomes Assigned
//   - Assign to Draft → REJECTED (do not silently release)
//   - Pending Approval cannot proceed to Assigned/In Progress
//   - Unassign an Assigned job → back to Open
//   - Reassign keeps Assigned (or In Progress) unchanged
//   - Start work → In Progress
//
// Customer summary counts (§10):
//   Service Jobs      = all non-deleted for customer
//   Active            = non-deleted AND status IN
//                       (Open, Assigned, In Progress, Waiting Customer, Waiting Vendor)
//   Pending Approval  = non-deleted AND status = 'Pending Approval'
//   Assigned          = non-deleted AND assigned_user_id NOT NULL
//                       AND status NOT IN (Completed, Cancelled)
//   Completed         = non-deleted AND status = 'Completed'
//   Draft & Cancelled included in total, NOT in Active.

export type JobStatus =
  | "Draft"
  | "Pending Approval"
  | "Open"
  | "Assigned"
  | "In Progress"
  | "Waiting Customer"
  | "Waiting Vendor"
  | "Completed"
  | "Cancelled";

export const ALL_STATUSES: readonly JobStatus[] = [
  "Draft",
  "Pending Approval",
  "Open",
  "Assigned",
  "In Progress",
  "Waiting Customer",
  "Waiting Vendor",
  "Completed",
  "Cancelled",
];

export const ACTIVE_STATUSES: readonly JobStatus[] = [
  "Open",
  "Assigned",
  "In Progress",
  "Waiting Customer",
  "Waiting Vendor",
];

// User-driven transitions via POST /status. Approve/Reject are separate.
//
// WP0E: `Completed` is intentionally NOT a generic user transition.
// WP0E-R: `Cancelled` is likewise removed — cancellation runs only through
// the dedicated cancellation process (policy + optional Admin approval). Completion
// returns only through its dedicated completion vertical; the generic /status
// route must reject it so there is no hidden API bypass.
const USER_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  Draft: ["Open", "Assigned"],
  "Pending Approval": [], // approve/reject handled separately
  Open: ["In Progress"],
  Assigned: ["In Progress"],
  "In Progress": ["Waiting Customer", "Waiting Vendor"],
  "Waiting Customer": ["In Progress"],
  "Waiting Vendor": ["In Progress"],
  Completed: [],
  Cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
  const allow = USER_TRANSITIONS[from as JobStatus];
  return !!allow && allow.includes(to as JobStatus);
}

export function allowedTransitions(from: string): JobStatus[] {
  return [...(USER_TRANSITIONS[from as JobStatus] ?? [])];
}

export function isTerminal(status: string): boolean {
  return status === "Completed" || status === "Cancelled";
}
