// WP3C — the Admin Dashboard card catalogue.
//
// Label, the summary field a card counts and the destination scope it opens
// are declared once here, so an Admin card can never open a broader or
// narrower Job set than the number it displayed. The route file only adds
// icons; every semantic decision lives in this pure module.

import type { AdminDashboardQueueKey } from "./admin-scope";

export type AdminSummaryKey =
  | "jobsToday"
  | "activeJobs"
  | "inProgress"
  | "pendingApproval"
  | "cancellationRequests"
  | "reopenRequests"
  | "followUpOpen"
  | "reopenPending"
  | "resolvedToday"
  | "completedCurrentCycle"
  | "legacyCompleted"
  | "waitingCustomer"
  | "waitingVendor"
  | "dueSoonCustomers"
  | "overdueCustomers";

export type AdminTone =
  | "blue"
  | "cyan"
  | "emerald"
  | "amber"
  | "orange"
  | "violet"
  | "rose"
  | "navy";

export interface AdminCardDef {
  label: string;
  key: AdminSummaryKey;
  tone: AdminTone;
  meaning: string;
  /** Pending Queue scope this card opens (mutually exclusive with `to`). */
  queueType?: AdminDashboardQueueKey | string;
  /** Dedicated list page for customer-coverage cards. */
  to?: "/customers/due-soon" | "/customers/overdue";
}

export const ADMIN_ACTION_CENTRE: readonly AdminCardDef[] = [
  {
    label: "Job Approvals",
    key: "pendingApproval",
    tone: "amber",
    meaning: "Jobs awaiting your approval",
    queueType: "pending_approval",
  },
  {
    label: "Cancellation Requests",
    key: "cancellationRequests",
    tone: "rose",
    meaning: "Awaiting an Owner/Admin decision",
    queueType: "cancellation_requests",
  },
  {
    label: "Reopen Requests",
    key: "reopenRequests",
    tone: "amber",
    meaning: "Completed jobs asked to reopen",
    queueType: "reopen_requests",
  },
  {
    label: "Follow-up Open",
    key: "followUpOpen",
    tone: "orange",
    meaning: "Completed, follow-up not yet cleared",
    queueType: "follow_up_open",
  },
] as const;

export const ADMIN_LIVE_OPERATIONS: readonly AdminCardDef[] = [
  {
    label: "Jobs Today",
    key: "jobsToday",
    tone: "blue",
    meaning: "Created today (Malaysia time)",
    queueType: "jobs_today",
  },
  {
    label: "Active Jobs",
    key: "activeJobs",
    tone: "navy",
    meaning: "Every non-terminal job",
    queueType: "active",
  },
  {
    label: "In Progress",
    key: "inProgress",
    tone: "cyan",
    meaning: "Being worked on right now",
    queueType: "in_progress",
  },
  {
    label: "Waiting Customer",
    key: "waitingCustomer",
    tone: "amber",
    meaning: "Blocked on the customer",
    queueType: "waiting_customer",
  },
  {
    label: "Waiting Vendor",
    key: "waitingVendor",
    tone: "violet",
    meaning: "Blocked on a vendor",
    queueType: "waiting_vendor",
  },
  {
    label: "Resolved Today",
    key: "resolvedToday",
    tone: "emerald",
    meaning: "Resolved today (Malaysia time)",
    queueType: "resolved_today",
  },
] as const;

export const ADMIN_COVERAGE: readonly AdminCardDef[] = [
  {
    label: "Due Soon Customers",
    key: "dueSoonCustomers",
    tone: "amber",
    meaning: "Entitlements expiring soon",
    to: "/customers/due-soon",
  },
  {
    label: "Overdue Customers",
    key: "overdueCustomers",
    tone: "rose",
    meaning: "Entitlements already expired",
    to: "/customers/overdue",
  },
] as const;

export const ADMIN_COMPLETION_INTEGRITY: readonly AdminCardDef[] = [
  {
    label: "Completed Current Cycle",
    key: "completedCurrentCycle",
    tone: "emerald",
    meaning: "Resolved + Follow-up Open + Reopen Pending",
    queueType: "completed_current_cycle",
  },
] as const;

/**
 * WP3C UAT — audit-oriented alert. It keeps its exact count and click-through
 * scope (`legacy_completed`), but lives in the lower System / Integration
 * health area instead of the prospect-facing business card groups. It is never
 * hidden when non-zero.
 */
export const ADMIN_COMPLETION_DATA_ALERT: AdminCardDef = {
  label: "Completion Data Alert",
  key: "legacyCompleted",
  tone: "navy",
  meaning: "Completed jobs missing completion records",
  queueType: "legacy_completed",
} as const;

export const ADMIN_CARD_GROUPS: readonly {
  title: string;
  description: string;
  cards: readonly AdminCardDef[];
}[] = [
  {
    title: "Action Centre",
    description: "Decisions waiting on an Owner or Administrator.",
    cards: ADMIN_ACTION_CENTRE,
  },
  {
    title: "Live Operations",
    description: "What the team is working on right now.",
    cards: ADMIN_LIVE_OPERATIONS,
  },
  {
    title: "Customer Coverage",
    description: "Entitlement attention across your customer base.",
    cards: ADMIN_COVERAGE,
  },
  {
    title: "Completion Integrity",
    description: "Completed = Resolved + Follow-up Open + Reopen Pending for the current cycle.",
    cards: ADMIN_COMPLETION_INTEGRITY,
  },
] as const;

export const ALL_ADMIN_CARDS: readonly AdminCardDef[] = [
  ...ADMIN_CARD_GROUPS.flatMap((g) => g.cards),
  ADMIN_COMPLETION_DATA_ALERT,
];
