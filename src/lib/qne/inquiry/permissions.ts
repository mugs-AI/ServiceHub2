// WP4 — Inquiry & Export access model (client-safe, pure).
//
// Exactly two future WP5 inquiry keys are configurable. Only two roles exist:
//   • Owner/Admin — derived server-side from verified N3 isOwner. Immutable
//     full access across all company Jobs; never stored, never editable.
//   • Normal User — configurable, fail-closed defaults.
// UI hiding is never authorization: the server resolver in
// permissions.server.ts is the only enforcement point.

export const INQUIRY_KEYS = ["job_details_inquiry", "timeline_history_inquiry"] as const;
export type InquiryKey = (typeof INQUIRY_KEYS)[number];

export const INQUIRY_LABEL: Record<InquiryKey, string> = {
  job_details_inquiry: "Job Details Inquiry",
  timeline_history_inquiry: "Timeline History Inquiry",
};

/** Stored role value in report_role_permissions for configurable users. */
export const NORMAL_USER_ROLE = "normal_user" as const;

export const INQUIRY_SCOPES = ["own", "all"] as const;
export type InquiryScope = (typeof INQUIRY_SCOPES)[number];

export const INQUIRY_SCOPE_LABEL: Record<InquiryScope, string> = {
  own: "Own Jobs only",
  all: "All company Jobs",
};

export interface InquiryPermission {
  can_view: boolean;
  scope: InquiryScope;
  can_export_excel: boolean;
  view_private_notes: boolean;
  view_gps: boolean;
}

export type InquiryCapability = "can_view" | "can_export_excel" | "view_private_notes" | "view_gps";

export const NORMAL_USER_DEFAULT: Readonly<InquiryPermission> = Object.freeze({
  can_view: false,
  scope: "own",
  can_export_excel: false,
  view_private_notes: false,
  view_gps: false,
});

export const OWNER_ADMIN_ACCESS: Readonly<InquiryPermission> = Object.freeze({
  can_view: true,
  scope: "all",
  can_export_excel: true,
  view_private_notes: true,
  view_gps: true,
});

export function isInquiryKey(value: unknown): value is InquiryKey {
  return typeof value === "string" && (INQUIRY_KEYS as readonly string[]).includes(value);
}

export type ValidationResult =
  | { ok: true; value: InquiryPermission }
  | { ok: false; error: string };

/**
 * Strictly validate a Normal User permission patch. Contradictions are
 * rejected, not silently corrected, so the Owner sees exactly what is saved.
 */
export function validateInquiryPermission(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Permission is required." };
  const r = raw as Record<string, unknown>;
  const bools = ["can_view", "can_export_excel", "view_private_notes", "view_gps"] as const;
  for (const k of bools) {
    if (typeof r[k] !== "boolean") return { ok: false, error: `${k} must be true or false.` };
  }
  if (!(INQUIRY_SCOPES as readonly unknown[]).includes(r.scope)) {
    return { ok: false, error: "Scope must be own or all." };
  }
  const value: InquiryPermission = {
    can_view: r.can_view as boolean,
    scope: r.scope as InquiryScope,
    can_export_excel: r.can_export_excel as boolean,
    view_private_notes: r.view_private_notes as boolean,
    view_gps: r.view_gps as boolean,
  };
  if (!value.can_view) {
    if (value.can_export_excel || value.view_private_notes || value.view_gps) {
      return {
        ok: false,
        error: "Export, private notes and GPS need View access to be turned on first.",
      };
    }
    if (value.scope === "all") {
      return { ok: false, error: "All company Jobs scope needs View access to be turned on." };
    }
  }
  return { ok: true, value };
}

/** Shape stored in report_role_permissions (existing table, no migration). */
export interface StoredInquiryRow {
  report_code: string;
  role: string;
  can_view: boolean | null;
  can_export_excel: boolean | null;
  data_scope: string | null;
  view_private_notes: boolean | null;
  view_gps: boolean | null;
}

/** Convert a stored row back to a permission; anything invalid fails closed. */
export function permissionFromRow(row: StoredInquiryRow | null | undefined): InquiryPermission {
  if (!row || row.role !== NORMAL_USER_ROLE) return { ...NORMAL_USER_DEFAULT };
  const candidate = {
    can_view: row.can_view === true,
    scope: row.data_scope === "all" ? "all" : "own",
    can_export_excel: row.can_export_excel === true,
    view_private_notes: row.view_private_notes === true,
    view_gps: row.view_gps === true,
  };
  const v = validateInquiryPermission(candidate);
  return v.ok ? v.value : { ...NORMAL_USER_DEFAULT };
}

/** Effective access for a verified identity. Owner/Admin is immutable. */
export function resolveInquiryAccess(
  identity: { isOwnerAdmin: boolean },
  stored: StoredInquiryRow | null | undefined,
): InquiryPermission {
  if (identity.isOwnerAdmin) return { ...OWNER_ADMIN_ACCESS };
  return permissionFromRow(stored);
}
