// WP0E-R — Software cancellation policy (pure, isomorphic).
//
// Cancellation is the only terminal action a Normal User can reach, so its
// policy is tenant-configurable and enforced server-side. This module is the
// single source of truth shared by the API routes, the tests and the UI.
// It performs no I/O and never trusts a browser-supplied actor or tenant.

export const CANCEL_REQUESTER_POLICIES = [
  "admin_only",
  "primary_pic_or_creator",
  "any_support_user",
] as const;
export type CancelRequesterPolicy = (typeof CANCEL_REQUESTER_POLICIES)[number];

export const CANCEL_APPROVAL_MODES = ["direct", "admin_approval_required"] as const;
export type CancelApprovalMode = (typeof CANCEL_APPROVAL_MODES)[number];

export const CANCEL_REQUESTER_POLICY_LABEL: Record<CancelRequesterPolicy, string> = {
  admin_only: "Owner / Administrator only",
  primary_pic_or_creator: "Owner / Admin, Primary PIC or Job creator",
  any_support_user: "Any support user in this company",
};

export const CANCEL_APPROVAL_MODE_LABEL: Record<CancelApprovalMode, string> = {
  direct: "Direct — eligible requester cancels immediately",
  admin_approval_required: "Owner/Admin approval required",
};

export interface CancellationSettings {
  requesterPolicy: CancelRequesterPolicy;
  approvalMode: CancelApprovalMode;
}

/** Backward-compatible defaults for tenants with no stored cancellation policy. */
export const DEFAULT_CANCELLATION_SETTINGS: CancellationSettings = {
  requesterPolicy: "primary_pic_or_creator",
  approvalMode: "admin_approval_required",
};

export function mergeCancellationSettings(raw: unknown): CancellationSettings {
  const src = (raw ?? {}) as Partial<CancellationSettings>;
  const requesterPolicy = (CANCEL_REQUESTER_POLICIES as readonly string[]).includes(
    String(src.requesterPolicy),
  )
    ? (src.requesterPolicy as CancelRequesterPolicy)
    : DEFAULT_CANCELLATION_SETTINGS.requesterPolicy;
  const approvalMode = (CANCEL_APPROVAL_MODES as readonly string[]).includes(
    String(src.approvalMode),
  )
    ? (src.approvalMode as CancelApprovalMode)
    : DEFAULT_CANCELLATION_SETTINGS.approvalMode;
  return { requesterPolicy, approvalMode };
}

/* ---------------- actor / job facts ---------------- */

export interface CancelActorFacts {
  isAdministrator: boolean;
  /** Server-resolved authenticated N3 user id. Never browser-supplied. */
  actorUserId: string | null;
}

export interface CancelJobFacts {
  status: string;
  isDeleted: boolean;
  createdByUserId: string | null;
  assignedUserId: string | null;
}

/** States from which a cancellation may be initiated. */
export const CANCELLABLE_STATUSES: readonly string[] = [
  "Draft",
  "Pending Approval",
  "Open",
  "Assigned",
  "In Progress",
  "Waiting Customer",
  "Waiting Vendor",
];

export function isCancellableStatus(status: string): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}

/** Tenant-policy requester authorization. */
export function canRequestCancellation(
  policy: CancelRequesterPolicy,
  actor: CancelActorFacts,
  job: CancelJobFacts,
): boolean {
  if (actor.isAdministrator) return true;
  if (!actor.actorUserId) return false;
  switch (policy) {
    case "admin_only":
      return false;
    case "any_support_user":
      return true;
    case "primary_pic_or_creator":
    default:
      return (
        job.createdByUserId === actor.actorUserId ||
        job.assignedUserId === actor.actorUserId
      );
  }
}

export function normalizeReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s ? s.slice(0, 2000) : null;
}

export type CancelEvaluation =
  | { ok: true; effect: "cancel_now" | "request_approval" }
  | { ok: false; status: number; error: string };

/**
 * Full server-side decision for an initiate-cancellation attempt.
 * Ordering matters: state validity first, then authorization, then reason.
 */
export function evaluateCancellationRequest(input: {
  settings: CancellationSettings;
  actor: CancelActorFacts;
  job: CancelJobFacts;
  reason: string | null;
  hasActiveRequest: boolean;
}): CancelEvaluation {
  const { settings, actor, job } = input;
  if (job.isDeleted) {
    return { ok: false, status: 400, error: "Deleted job cannot be cancelled." };
  }
  if (!isCancellableStatus(job.status)) {
    return {
      ok: false,
      status: 400,
      error: `A ${job.status} Job cannot be cancelled.`,
    };
  }
  if (!canRequestCancellation(settings.requesterPolicy, actor, job)) {
    return {
      ok: false,
      status: 403,
      error:
        settings.requesterPolicy === "admin_only"
          ? "Only an Owner or Administrator can cancel this Job."
          : "Only the Job creator, the current Primary PIC, or an Administrator can cancel this Job.",
    };
  }
  if (!normalizeReason(input.reason)) {
    return { ok: false, status: 400, error: "A cancellation reason is required." };
  }
  if (input.hasActiveRequest) {
    return {
      ok: false,
      status: 409,
      error: "A cancellation request is already awaiting an Owner/Admin decision.",
    };
  }
  return {
    ok: true,
    effect: settings.approvalMode === "direct" ? "cancel_now" : "request_approval",
  };
}

/** UI wording must be truthful about what the button actually does. */
export function cancelActionLabel(mode: CancelApprovalMode): string {
  return mode === "direct" ? "Cancel Job" : "Request Cancellation";
}
