// Pure, client-safe Field Operations rules for Service Jobs.
//
// Field actions are append-only events. The server is always the authority;
// these helpers exist so the UI can disable impossible actions and so both
// sides agree on the vocabulary.

export const FIELD_EVENTS = [
  "travel_started",
  "arrived_on_site",
  "work_started",
  "work_paused",
  "work_resumed",
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
  work_started: "Start Work",
  work_paused: "Pause",
  work_resumed: "Resume",
  waiting_customer_started: "Waiting Customer",
  waiting_customer_resolved: "Resolve Waiting Customer",
  waiting_vendor_started: "Waiting Vendor",
  waiting_vendor_resolved: "Resolve Waiting Vendor",
  ready_for_completion: "Ready for Completion",
};

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
  "site_photo",
  "error_screenshot",
  "document",
  "customer_file",
] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

export const ATTACHMENT_TYPE_LABEL: Record<AttachmentType, string> = {
  site_photo: "Site photo",
  error_screenshot: "Error screenshot",
  document: "Document",
  customer_file: "Customer-provided file",
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
}

export function fieldActionsBlocked(state: FieldState): string | null {
  if (state.is_deleted) return "Deleted jobs cannot use field actions.";
  if ((FIELD_BLOCKED_STATUSES as readonly string[]).includes(state.status)) {
    return `${state.status} jobs cannot use field actions.`;
  }
  return null;
}

/** Which field actions the UI should offer right now. */
export function availableFieldActions(state: FieldState): FieldEvent[] {
  if (fieldActionsBlocked(state)) return [];
  const out: FieldEvent[] = [];
  const session = state.activeSession ?? null;
  const waiting = state.openWaiting ?? { customer: false, vendor: false };

  if (!session) {
    out.push("travel_started", "arrived_on_site", "work_started");
  } else if (session.status === "active") {
    out.push("work_paused");
  } else {
    out.push("work_resumed");
  }

  out.push(waiting.customer ? "waiting_customer_resolved" : "waiting_customer_started");
  out.push(waiting.vendor ? "waiting_vendor_resolved" : "waiting_vendor_started");

  if (canReadyForCompletion(state).ok) out.push("ready_for_completion");
  return out;
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
  resolution_summary?: string | null;
  work_performed?: string | null;
  test_result?: string | null;
  outstanding_issue?: string | null;
  follow_up_required?: boolean;
  follow_up_date?: string | null;
  ack_customer_name?: string | null;
  ack_confirmed?: boolean;
  signature_data_url?: string | null;
  signature_waived?: boolean;
  signature_waiver_reason?: string | null;
}

/** Server-mirrored gate for the final Complete action. */
export function validateCompletion(
  draft: CompletionDraft,
  state: FieldState,
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
  if (!(draft.work_performed ?? "").trim()) errors.push("Work performed is required.");
  if (!(draft.test_result ?? "").trim()) errors.push("Test result is required.");
  if (draft.follow_up_required && !(draft.follow_up_date ?? "").trim()) {
    errors.push("Follow-up date is required when follow-up is needed.");
  }

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
