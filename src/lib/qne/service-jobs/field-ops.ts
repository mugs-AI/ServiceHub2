// Pure, client-safe Field Operations rules for Service Jobs.
//
// Field actions are append-only events. The server is always the authority;
// these helpers exist so the UI can disable impossible actions and so both
// sides agree on the vocabulary.

export const FIELD_EVENTS = [
  "travel_started",
  "arrived_on_site",
  "leave_site",
  "work_started",
  "work_paused",
  "work_resumed",
  "work_stopped",
  "waiting_customer_started",
  "waiting_customer_resolved",
  "waiting_vendor_started",
  "waiting_vendor_resolved",
  "ready_for_completion",
] as const;

export type FieldEvent = (typeof FIELD_EVENTS)[number];

export const FIELD_EVENT_LABEL: Record<FieldEvent, string> = {
  travel_started: "Start Travel",
  arrived_on_site: "Arrived On Site",
  leave_site: "Leave Site",
  work_started: "Start Work",
  work_paused: "Pause",
  work_resumed: "Resume",
  work_stopped: "Stop Work",
  waiting_customer_started: "Waiting Customer",
  waiting_customer_resolved: "Resolve Waiting Customer",
  waiting_vendor_started: "Waiting Vendor",
  waiting_vendor_resolved: "Resolve Waiting Vendor",
  ready_for_completion: "Ready for Completion",
};

/** Field actions that only make sense for onsite-style support modes. */
export const TRAVEL_ONLY_EVENTS: readonly FieldEvent[] = [
  "travel_started",
  "arrived_on_site",
  "leave_site",
];


/** Statuses where no field action is ever permitted. */
export const FIELD_BLOCKED_STATUSES = [
  "Pending Approval",
  "Completed",
  "Cancelled",
] as const;

export const WORK_NOTE_TYPES = [
  "diagnosis",
  "action_taken",
  "test_result",
  "customer_update",
  "vendor_update",
  "general",
] as const;
export type WorkNoteType = (typeof WORK_NOTE_TYPES)[number];

export const WORK_NOTE_TYPE_LABEL: Record<WorkNoteType, string> = {
  diagnosis: "Diagnosis",
  action_taken: "Action Taken",
  test_result: "Test Result",
  customer_update: "Customer Update",
  vendor_update: "Vendor Update",
  general: "General",
};

export const VISIBILITIES = ["internal", "visible_to_customer"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  internal: "Internal only",
  visible_to_customer: "Visible to customer",
};

export const ATTACHMENT_TYPES = [
  "error_screenshot",
  "error_log",
  "document",
  "configuration_file",
  "customer_file",
  "site_photo",
  "other",
] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

export const ATTACHMENT_TYPE_LABEL: Record<AttachmentType, string> = {
  error_screenshot: "Screenshot",
  error_log: "Error log",
  document: "Report / Document",
  configuration_file: "Configuration file",
  customer_file: "Customer file",
  site_photo: "Site photo",
  other: "Other",
};

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB

export const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

/** Extensions that must never be accepted, whatever the declared MIME type. */
const BLOCKED_EXT =
  /\.(exe|dll|bat|cmd|com|scr|msi|sh|bash|ps1|jar|apk|app|js|mjs|cjs|vbs|php|py|rb|html?|svg)$/i;

export function validateAttachment(file: { name: string; type: string; size: number }): {
  ok: boolean;
  error?: string;
} {
  if (!file.name.trim()) return { ok: false, error: "File name is required." };
  if (BLOCKED_EXT.test(file.name)) {
    return { ok: false, error: "Executable and script files are not allowed." };
  }
  if (!ALLOWED_MIME.includes(file.type)) {
    return { ok: false, error: `File type ${file.type || "unknown"} is not allowed.` };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: "Empty file." };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: "File is larger than 15 MB." };
  }
  return { ok: true };
}

export interface FieldState {
  status: string;
  is_deleted?: boolean | null;
  activeSession?: { status: "active" | "paused" } | null;
  openWaiting?: { customer: boolean; vendor: boolean };
  workNoteCount?: number;
  /**
   * Stored Job support mode. `undefined` means "not supplied by this caller";
   * `null` means the Job genuinely has no support mode yet and Field activity
   * must not assume Onsite.
   */
  supportMode?: string | null;
  /** Onsite single-visit evidence, used to prevent overwrite. */
  travelStartedAt?: string | null;
  arrivedAt?: string | null;
  leftAt?: string | null;
}

export function fieldActionsBlocked(state: FieldState): string | null {
  if (state.is_deleted) return "Deleted jobs cannot use field actions.";
  if ((FIELD_BLOCKED_STATUSES as readonly string[]).includes(state.status)) {
    return `${state.status} jobs cannot use field actions.`;
  }
  if (state.supportMode === null) {
    return "Support mode is not set for this Job.";
  }
  return null;
}

/** True when the Job has no stored support mode and Field work cannot start. */
export function supportModeMissing(state: FieldState): boolean {
  return state.supportMode === null;
}

/**
 * Server-mirrored applicability rule. Travel / arrival / leave only exist for
 * onsite-style support modes and a missing mode is never treated as Onsite.
 */
export function actionAllowedForMode(
  action: FieldEvent,
  supportMode: string | null | undefined,
): string | null {
  if (!TRAVEL_ONLY_EVENTS.includes(action)) return null;
  if (!supportMode) return "Support mode is not set for this Job.";
  if (!ONSITE_SUPPORT_MODES.includes(supportMode)) {
    return "Travel, arrival and leave do not apply to this support mode.";
  }
  return null;
}

/** Onsite-style modes, mirrored from support-mode.ts to keep this module pure. */
const ONSITE_SUPPORT_MODES: readonly string[] = [
  "onsite_support",
  "training",
  "installation",
  "migration",
];

/** Which field actions the UI should offer right now. */
export function availableFieldActions(state: FieldState): FieldEvent[] {
  if (fieldActionsBlocked(state)) return [];
  const out: FieldEvent[] = [];
  const session = state.activeSession ?? null;
  const waiting = state.openWaiting ?? { customer: false, vendor: false };

  if (!session) {
    out.push("travel_started", "arrived_on_site", "work_started", "leave_site");
  } else if (session.status === "active") {
    out.push("work_paused", "work_stopped");
  } else {
    out.push("work_resumed", "work_stopped");
  }

  out.push(waiting.customer ? "waiting_customer_resolved" : "waiting_customer_started");
  out.push(waiting.vendor ? "waiting_vendor_resolved" : "waiting_vendor_started");

  if (canReadyForCompletion(state).ok) out.push("ready_for_completion");

  return out.filter((a) => {
    if (state.supportMode !== undefined && actionAllowedForMode(a, state.supportMode)) {
      return false;
    }
    if (a === "travel_started" && state.travelStartedAt) return false;
    if (a === "arrived_on_site" && state.arrivedAt) return false;
    if (a === "leave_site" && (state.leftAt || !state.arrivedAt)) return false;
    return true;
  });
}

/* ---------------- work-session lifecycle (pure) ---------------- */

export interface WorkSessionRow {
  id: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
  duration_minutes?: number | null;
}

/**
 * A work session is modelled as a sequence of segments:
 *  - Start Work opens an `active` segment;
 *  - Pause closes that segment as `paused` (its minutes are kept, the paused
 *    interval itself is never recorded, so it can never be billed);
 *  - Resume opens a new `active` segment;
 *  - Stop Work closes the active segment as `completed`.
 */
export function workSessionState(rows: readonly WorkSessionRow[]): {
  activeSegment: WorkSessionRow | null;
  /**
   * The single most recent paused segment, i.e. the current paused state
   * marker. Older paused rows are closed historical evidence and are never
   * touched by a state transition.
   */
  pausedSegment: WorkSessionRow | null;
  status: "active" | "paused" | null;
} {
  const sorted = [...rows].sort(
    (a, b) => Date.parse(b.started_at) - Date.parse(a.started_at),
  );
  const activeSegment = sorted.find((r) => r.status === "active" && !r.ended_at) ?? null;
  if (activeSegment) return { activeSegment, pausedSegment: null, status: "active" };
  const latest = sorted.find((r) => r.status !== "cancelled") ?? null;
  if (latest && latest.status === "paused") {
    return { activeSegment: null, pausedSegment: latest, status: "paused" };
  }
  return { activeSegment: null, pausedSegment: null, status: null };
}

/** Server-derived total work minutes: closed, non-cancelled segments only. */
export function computeWorkMinutes(rows: readonly WorkSessionRow[]): number {
  let total = 0;
  for (const r of rows) {
    if (r.status === "cancelled") continue;
    if (typeof r.duration_minutes === "number") {
      total += Math.max(0, r.duration_minutes);
    } else if (r.started_at && r.ended_at) {
      total += Math.max(
        0,
        Math.round((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 60000),
      );
    }
  }
  return total;
}

/* ---------------- authority (pure) ---------------- */

export interface FieldActorFacts {
  isAdmin: boolean;
  actorUserId: string | null;
}

/** Physical Field mutation = Primary PIC OR Owner/Admin. Never all teammates. */
export function canMutateField(
  job: { assigned_user_id: string | null },
  actor: FieldActorFacts,
): boolean {
  if (actor.isAdmin) return true;
  return Boolean(job.assigned_user_id && actor.actorUserId && job.assigned_user_id === actor.actorUserId);
}

/**
 * Support mode may be set on a legacy Job by the Primary PIC or an Admin, but
 * it locks as soon as material Field evidence exists.
 */
export function canSetSupportMode(
  job: { assigned_user_id: string | null; support_mode: string | null },
  actor: FieldActorFacts,
  evidence: {
    sessionCount: number;
    waitingCount: number;
    workNoteCount: number;
    travelStartedAt?: string | null;
    arrivedAt?: string | null;
  },
): { ok: boolean; reason?: string } {
  if (!canMutateField(job, actor)) {
    return { ok: false, reason: "Only the Primary PIC or an Administrator can set support mode." };
  }
  const hasEvidence =
    evidence.sessionCount > 0 ||
    evidence.waitingCount > 0 ||
    evidence.workNoteCount > 0 ||
    Boolean(evidence.travelStartedAt) ||
    Boolean(evidence.arrivedAt);
  // Material field evidence locks support mode even when the stored mode is
  // still null — a legacy Job cannot be reclassified after work happened.
  if (hasEvidence) {
    return { ok: false, reason: "Support mode is locked once field evidence exists." };
  }
  return { ok: true };
}


export function canReadyForCompletion(state: FieldState): { ok: boolean; reason?: string } {
  const blocked = fieldActionsBlocked(state);
  if (blocked) return { ok: false, reason: blocked };
  if (state.status !== "In Progress") {
    return { ok: false, reason: "Job must be In Progress." };
  }
  const waiting = state.openWaiting ?? { customer: false, vendor: false };
  if (waiting.customer) return { ok: false, reason: "Resolve Waiting Customer first." };
  if (waiting.vendor) return { ok: false, reason: "Resolve Waiting Vendor first." };
  if (state.activeSession) return { ok: false, reason: "Close the open work session first." };
  if (!state.workNoteCount) return { ok: false, reason: "Add at least one work note." };
  return { ok: true };
}

export const DEFAULT_CHECKLIST = [
  "Work performed",
  "System tested",
  "Customer informed",
  "Site cleaned",
  "Required evidence attached",
  "Outstanding issue recorded",
] as const;

export interface ChecklistItem {
  label: string;
  state: "done" | "not_applicable" | "pending";
  note?: string;
}

export function defaultChecklist(): ChecklistItem[] {
  return DEFAULT_CHECKLIST.map((label) => ({ label, state: "pending", note: "" }));
}

export interface CompletionDraft {
  checklist: ChecklistItem[];
  /** Software-service fields (Run 7 Phase O). */
  diagnosis?: string | null;
  software_module?: string | null;
  version_after?: string | null;
  internal_completion_note?: string | null;
  resolution_summary?: string | null;
  /** "Action Taken" in the software-service form. */
  work_performed?: string | null;
  test_result?: string | null;
  outstanding_issue?: string | null;
  follow_up_required?: boolean;
  follow_up_date?: string | null;
  ack_method?: string | null;
  ack_evidence_reference?: string | null;
  ack_customer_name?: string | null;
  ack_confirmed?: boolean;
  signature_data_url?: string | null;
  signature_waived?: boolean;
  signature_waiver_reason?: string | null;
}

/** Tenant-derived acknowledgement rule handed to the completion gate. */
export interface AckRule {
  required: boolean;
  reason: string;
  allowedMethods: readonly string[];
  allowWaiver: boolean;
  /** Only Owner/Admin may waive. */
  actorCanWaive: boolean;
}

/**
 * Server-mirrored gate for the final Complete action.
 *
 * Without `ack`, the legacy Run 6 rules apply (name + confirmation +
 * signature/waiver always required). With `ack`, the tenant's
 * Completion & Acknowledgement settings decide.
 */
export function validateCompletion(
  draft: CompletionDraft,
  state: FieldState,
  ack?: AckRule,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (state.is_deleted) errors.push("Deleted jobs cannot be completed.");
  if (state.activeSession) errors.push("Close the open work session before completing.");
  const waiting = state.openWaiting ?? { customer: false, vendor: false };
  if (waiting.customer) errors.push("Waiting Customer is unresolved.");
  if (waiting.vendor) errors.push("Waiting Vendor is unresolved.");

  const items = draft.checklist ?? [];
  if (items.length === 0) errors.push("Completion checklist is required.");
  if (items.some((i) => i.state === "pending")) {
    errors.push("Every checklist item must be Done or Not Applicable.");
  }
  if (items.some((i) => i.state === "not_applicable" && !(i.note ?? "").trim())) {
    errors.push("Not Applicable checklist items need a note.");
  }

  if (!(draft.resolution_summary ?? "").trim()) errors.push("Resolution summary is required.");
  if (!(draft.work_performed ?? "").trim()) errors.push("Action taken is required.");
  if (!(draft.test_result ?? "").trim()) errors.push("Test result is required.");
  if (ack && !(draft.diagnosis ?? "").trim()) errors.push("Diagnosis is required.");
  if (draft.follow_up_required && !(draft.follow_up_date ?? "").trim()) {
    errors.push("Follow-up date is required when follow-up is needed.");
  }

  if (!ack) {
    if (!(draft.ack_customer_name ?? "").trim()) errors.push("Customer name is required.");
    if (!draft.ack_confirmed) errors.push("Customer acknowledgement is required.");
    const hasSignature = Boolean((draft.signature_data_url ?? "").trim());
    if (!hasSignature) {
      if (!draft.signature_waived) {
        errors.push("A customer signature or an authorised waiver is required.");
      } else if (!(draft.signature_waiver_reason ?? "").trim()) {
        errors.push("Signature waiver reason is required.");
      }
    }
    return { ok: errors.length === 0, errors };
  }

  const method = (draft.ack_method ?? "").trim();
  const waiving = method === "admin_waiver" || draft.signature_waived === true;

  if (waiving) {
    if (!ack.allowWaiver) errors.push("Tenant settings do not allow an acknowledgement waiver.");
    if (!ack.actorCanWaive) {
      errors.push("Only an Owner or Administrator may waive acknowledgement.");
    }
    if (!(draft.signature_waiver_reason ?? "").trim()) errors.push("Waiver reason is required.");
    return { ok: errors.length === 0, errors };
  }

  if (!ack.required && !method) return { ok: errors.length === 0, errors };

  if (ack.required && !method) {
    errors.push(`Acknowledgement is required (${ack.reason}).`);
    return { ok: errors.length === 0, errors };
  }

  if (method && !ack.allowedMethods.includes(method)) {
    errors.push(`Acknowledgement method "${method}" is not allowed by tenant settings.`);
  }
  if (!(draft.ack_customer_name ?? "").trim()) errors.push("Customer name is required.");
  if (!draft.ack_confirmed) errors.push("Customer acknowledgement is required.");
  if (method === "signature" && !(draft.signature_data_url ?? "").trim()) {
    errors.push("A customer signature is required.");
  }
  if (
    (method === "whatsapp" || method === "email") &&
    !(draft.ack_evidence_reference ?? "").trim()
  ) {
    errors.push("A reference or evidence is required for this acknowledgement method.");
  }

  return { ok: errors.length === 0, errors };
}
