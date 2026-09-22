// WP3C — shared tenant-wide dashboard/list scopes.
// The Admin Dashboard counts and Pending Queue destinations consume these
// definitions so a card can never open a broader or narrower Job set.

export const ADMIN_ACTIVE_STATUSES = [
  "Draft",
  "Pending Approval",
  "Open",
  "Assigned",
  "In Progress",
  "Waiting Customer",
  "Waiting Vendor",
] as const;

export const ADMIN_DASHBOARD_QUEUE_KEYS = [
  "jobs_today",
  "active",
  "in_progress",
  "resolved_today",
  "legacy_completed",
] as const;

export type AdminDashboardQueueKey = (typeof ADMIN_DASHBOARD_QUEUE_KEYS)[number];

export function isAdminDashboardQueueKey(value: unknown): value is AdminDashboardQueueKey {
  return (
    typeof value === "string" &&
    (ADMIN_DASHBOARD_QUEUE_KEYS as readonly string[]).includes(value)
  );
}

export function statusesForAdminQueue(key: AdminDashboardQueueKey): readonly string[] | null {
  if (key === "active") return ADMIN_ACTIVE_STATUSES;
  if (key === "in_progress") return ["In Progress"];
  if (key === "jobs_today") return null;
  return ["Completed"];
}