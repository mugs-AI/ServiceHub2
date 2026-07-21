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

const USER_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  Draft: ["Open", "Assigned", "Cancelled"],
  "Pending Approval": ["Cancelled"],
  Open: ["In Progress", "Cancelled"],
  Assigned: ["In Progress", "Cancelled"],
  "In Progress": ["Waiting Customer", "Waiting Vendor", "Completed", "Cancelled"],
  "Waiting Customer": ["In Progress", "Cancelled"],
  "Waiting Vendor": ["In Progress", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

export function allowedTransitionsClient(from: string): JobStatus[] {
  return [...(USER_TRANSITIONS[from as JobStatus] ?? [])];
}

export function isTerminalClient(status: string): boolean {
  return status === "Completed" || status === "Cancelled";
}
