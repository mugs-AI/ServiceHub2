// WP3C-2 — consolidated Pending Queue taxonomy.
//
// Six primary groups replace the long row of competing scope tabs. Every old
// scope key (including dashboard deep links) still resolves to one group +
// sub-filter, and the server list is always asked for with an exact,
// validated scope key — the browser never invents a broader or narrower set.

import { QUEUE_REOPEN_REQUESTS } from "@/lib/qne/service-jobs/wp3a-queues";

export type QueueGroup = "pending" | "waiting" | "approvals" | "completed" | "cancelled" | "all";

export const QUEUE_GROUPS: readonly { key: QueueGroup; label: string }[] = [
  { key: "pending", label: "All Pending" },
  { key: "waiting", label: "Waiting" },
  { key: "approvals", label: "Approvals" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All Jobs" },
] as const;

/** Every non-terminal, non-deleted lifecycle status. In Progress included. */
export const ALL_PENDING_STATUSES = [
  "Draft",
  "Pending Approval",
  "Open",
  "Assigned",
  "In Progress",
  "Waiting Customer",
  "Waiting Vendor",
] as const;

/** Every non-deleted lifecycle status (All Jobs). */
export const ALL_JOB_STATUSES = [...ALL_PENDING_STATUSES, "Completed", "Cancelled"] as const;

export const WAITING_SUBFILTERS = [
  { key: "", label: "All Waiting" },
  { key: "waiting_customer", label: "Customer" },
  { key: "waiting_vendor", label: "Vendor" },
] as const;

/** Approval request types. `""` = all three types together. */
export const APPROVAL_TYPES = [
  { key: "", label: "All" },
  { key: "pending_approval", label: "Job Approval" },
  { key: "cancellation_requests", label: "Cancellation" },
  { key: QUEUE_REOPEN_REQUESTS, label: "Reopen" },
] as const;

/** Completed outcome sub-filters (one list, not competing tabs). */
export const COMPLETED_SUBFILTERS = [
  { key: "completed", label: "All" },
  { key: "resolved", label: "Resolved" },
  { key: "follow_up_open", label: "Follow-up Open" },
  { key: "reopen_pending", label: "Reopen Pending" },
  { key: "legacy_completed", label: "Legacy/Data Alert" },
] as const;

export interface QueueView {
  group: QueueGroup;
  /** Exact scope key; `""` means the group default. */
  scope: string;
  /** Visible active-filter chip for deep-link scopes outside the sub-filters. */
  chip: string | null;
}

/** Deep-link scopes surfaced as an obvious active filter chip. */
export const DEEP_LINK_CHIPS: Record<string, { group: QueueGroup; label: string }> = {
  draft: { group: "pending", label: "Draft" },
  open_unassigned: { group: "pending", label: "Open · Unassigned" },
  assigned_not_started: { group: "pending", label: "Assigned" },
  in_progress: { group: "pending", label: "In Progress" },
  active: { group: "pending", label: "Active Jobs" },
  jobs_today: { group: "pending", label: "Jobs Today" },
  resolved_today: { group: "completed", label: "Resolved Today" },
  completed_current_cycle: { group: "completed", label: "Current Cycle" },
};

/**
 * Map any stable queue key (old tabs, dashboard deep links) into the
 * consolidated view. Unknown keys fall back to All Pending.
 */
export function viewForQueueKey(key: string | null | undefined): QueueView {
  const k = key ?? "";
  const chip = DEEP_LINK_CHIPS[k];
  if (chip) return { group: chip.group, scope: k, chip: chip.label };
  if (k === "waiting_customer" || k === "waiting_vendor") {
    return { group: "waiting", scope: k, chip: null };
  }
  if (k === "waiting") return { group: "waiting", scope: "", chip: null };
  if (k === "approvals") return { group: "approvals", scope: "", chip: null };
  if (k === "pending_approval" || k === QUEUE_REOPEN_REQUESTS) {
    return { group: "approvals", scope: k, chip: null };
  }
  if (k === "cancellation_requests" || k === "cancellation_requested") {
    return { group: "approvals", scope: "cancellation_requests", chip: null };
  }
  // completed_followup no longer implies "still needs follow-up": it maps to
  // the outcome-derived Follow-up Open list, so a cleared follow-up drops out.
  if (k === "completed_followup" || k === "follow_up_open") {
    return { group: "completed", scope: "follow_up_open", chip: null };
  }
  if (k === "completed" || k === "resolved" || k === "reopen_pending" || k === "legacy_completed") {
    return { group: "completed", scope: k, chip: null };
  }
  if (k === "cancelled") return { group: "cancelled", scope: "cancelled", chip: null };
  if (k === "all_jobs") return { group: "all", scope: "all_jobs", chip: null };
  return { group: "pending", scope: "", chip: null };
}

/** Default scope when a primary group is clicked. */
export function defaultScopeForGroup(group: QueueGroup): string {
  if (group === "completed") return "completed";
  if (group === "cancelled") return "cancelled";
  if (group === "all") return "all_jobs";
  return "";
}

/**
 * The exact `queueType` sent to /api/workspace/jobs/pending for a view, or
 * null when the view reads a dedicated request list (approvals by type).
 */
export function serverQueueTypeFor(view: QueueView): string | null {
  if (view.group === "pending") return view.scope || "";
  if (view.group === "waiting") return view.scope || "waiting";
  if (view.group === "approvals") return view.scope === "pending_approval" ? view.scope : null;
  return view.scope || defaultScopeForGroup(view.group);
}

export const COMPLETED_PAGE_SIZES = [20, 50, 100] as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Default Completed range: the latest three Malaysia calendar months
 * (first day of the month two months back → today), as yyyy-mm-dd.
 */
export function defaultCompletedRange(now: Date = new Date()): { from: string; to: string } {
  const my = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = my.getUTCFullYear();
  const m = my.getUTCMonth();
  const start = new Date(Date.UTC(y, m - 2, 1));
  return {
    from: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-01`,
    to: `${y}-${pad(m + 1)}-${pad(my.getUTCDate())}`,
  };
}

/**
 * Dashboard deep links keep count/list parity, so the default three-month
 * window only applies when the Completed group is entered directly.
 */
export function usesDefaultCompletedRange(initialKey: string | null | undefined): boolean {
  return !initialKey || initialKey === "completed";
}

/** Malaysia day range (inclusive yyyy-mm-dd) → [fromIso, toIso) UTC. */
export function malaysiaDayRangeToUtc(
  from: string | null,
  to: string | null,
): { fromIso: string | null; toIso: string | null } {
  const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
  const conv = (d: string, plusDays: number) => {
    const m = DAY.exec(d);
    if (!m) return null;
    const ms =
      Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + plusDays) - 8 * 60 * 60 * 1000;
    return new Date(ms).toISOString();
  };
  return {
    fromIso: from ? conv(from, 0) : null,
    toIso: to ? conv(to, 1) : null,
  };
}
