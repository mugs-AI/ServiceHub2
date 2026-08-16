// Client-safe mirror of workflow.server.ts allowed transitions.
// Keep in sync with the server file (single source of truth for the matrix
// still lives server-side; server re-validates on every /status call).

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

// WP0E: `Completed` is intentionally NOT a generic user transition.
// WP0E-R: `Cancelled` is likewise removed — cancellation runs only through
// the dedicated cancellation process (policy + optional Admin approval).
const USER_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  Draft: ["Open", "Assigned"],
  "Pending Approval": [],
  Open: ["In Progress"],
  Assigned: ["In Progress"],
  "In Progress": ["Waiting Customer", "Waiting Vendor"],
  "Waiting Customer": ["In Progress"],
  "Waiting Vendor": ["In Progress"],
  Completed: [],
  Cancelled: [],
};

export function allowedTransitionsClient(from: string): JobStatus[] {
  return [...(USER_TRANSITIONS[from as JobStatus] ?? [])];
}

export function isTerminalClient(status: string): boolean {
  return status === "Completed" || status === "Cancelled";
}
