// WP2A — client-safe Google Drive tenant-connection contracts and pure logic.
// No secrets, no network, no Node APIs: safe to import from browser code.

/** The ONLY scope this product is authorised to request. */
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Owner-approved scope set. Anything outside this is rejected at callback. */
export const APPROVED_SCOPES: readonly string[] = [GOOGLE_DRIVE_SCOPE];

export const GOOGLE_DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const DEFAULT_ROOT_FOLDER_NAME = "Software ServiceHub";
export const CALLBACK_PATH = "/api/integrations/google-drive/callback";

/** Server-only environment variables this vertical requires. */
export const REQUIRED_ENV = [
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_REDIRECT_URI",
  "GOOGLE_DRIVE_TOKEN_ENC_KEY",
] as const;

export const OPTIONAL_ENV = ["GOOGLE_PICKER_API_KEY"] as const;

export type DriveConnectionStatus =
  | "not_connected"
  | "connected"
  | "needs_reconnect"
  | "error"
  | "disconnected";

export type DriveContext = "my_drive" | "shared_drive";

/**
 * Sharing status is DERIVED from Google (`permissions.list`). ServiceHub never
 * claims a folder is Restricted; when it cannot check it says so.
 */
export type SharingStatus = "restricted" | "anyone_with_link" | "unknown" | "error";

export interface PublicDriveConnection {
  status: DriveConnectionStatus;
  accountEmail: string | null;
  rootFolderId: string | null;
  rootFolderName: string | null;
  driveContext: DriveContext | null;
  driveId: string | null;
  detectedSharing: SharingStatus;
  sharingDetail: string | null;
  sharingCheckedAt: string | null;
  publicSharingAcknowledged: boolean;
  sharingConfirmedBy: string | null;
  sharingConfirmedAt: string | null;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  lastError: string | null;
  connectedBy: string | null;
  updatedAt: string | null;
}

export const NOT_CONNECTED: PublicDriveConnection = {
  status: "not_connected",
  accountEmail: null,
  rootFolderId: null,
  rootFolderName: null,
  driveContext: null,
  driveId: null,
  detectedSharing: "unknown",
  sharingDetail: null,
  sharingCheckedAt: null,
  publicSharingAcknowledged: false,
  sharingConfirmedBy: null,
  sharingConfirmedAt: null,
  lastTestedAt: null,
  lastTestResult: null,
  lastError: null,
  connectedBy: null,
  updatedAt: null,
};

/** Strip every secret-bearing column before a row reaches any HTTP response. */
export function toPublicConnection(row: Record<string, unknown> | null): PublicDriveConnection {
  if (!row) return NOT_CONNECTED;
  const s = String(row.status ?? "connected");
  const sharing = String(row.detected_sharing_status ?? "unknown");
  return {
    status: (["connected", "needs_reconnect", "error", "disconnected"].includes(s)
      ? s
      : "error") as DriveConnectionStatus,
    accountEmail: (row.google_account_email as string) ?? null,
    rootFolderId: (row.root_folder_id as string) ?? null,
    rootFolderName: (row.root_folder_name as string) ?? null,
    driveContext: (row.drive_context as DriveContext) ?? null,
    driveId: (row.drive_id as string) ?? null,
    detectedSharing: (["restricted", "anyone_with_link", "unknown", "error"].includes(sharing)
      ? sharing
      : "unknown") as SharingStatus,
    sharingDetail: (row.sharing_detail as string) ?? null,
    sharingCheckedAt: (row.sharing_checked_at as string) ?? null,
    publicSharingAcknowledged: row.public_sharing_acknowledged === true,
    sharingConfirmedBy: (row.sharing_confirmed_by_name as string) ?? null,
    sharingConfirmedAt: (row.sharing_confirmed_at as string) ?? null,
    lastTestedAt: (row.last_tested_at as string) ?? null,
    lastTestResult: (row.last_test_result as string) ?? null,
    lastError: (row.last_error as string) ?? null,
    connectedBy: (row.connected_by_name as string) ?? null,
    updatedAt: (row.updated_at as string) ?? null,
  };
}

// ------------------------------------------------------------- scopes ------

export interface ScopeCheck {
  ok: boolean;
  granted: string[];
  missing: string[];
  extra: string[];
  reason: string | null;
}

/**
 * The granted scope set must contain drive.file and nothing outside the
 * owner-approved set. A response that widens access is rejected and revoked.
 */
export function validateGrantedScopes(raw: string | null | undefined): ScopeCheck {
  const granted = String(raw ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const missing = APPROVED_SCOPES.filter((s) => !granted.includes(s));
  const extra = granted.filter((s) => !APPROVED_SCOPES.includes(s));
  const ok = missing.length === 0 && extra.length === 0;
  return {
    ok,
    granted,
    missing,
    extra,
    reason: ok
      ? null
      : missing.length
        ? "Google did not grant the required Drive file access."
        : "Google granted permissions beyond the approved Drive file access.",
  };
}

// ------------------------------------------------------------- folders -----

/** Metadata shape read back from Drive `files.get` for a candidate folder. */
export interface DriveFolderMeta {
  id?: string;
  name?: string;
  mimeType?: string;
  trashed?: boolean;
  driveId?: string | null;
  capabilities?: { canAddChildren?: boolean; canListChildren?: boolean } | null;
}

export interface FolderValidation {
  ok: boolean;
  reason: string | null;
  recovery: string | null;
  folder: {
    id: string;
    name: string;
    driveId: string | null;
    driveContext: DriveContext;
  } | null;
}

/**
 * Server-side revalidation of a folder the browser claims to have selected.
 * The browser is never trusted: only metadata fetched from Google is used.
 * Usability requires POSITIVE capabilities — absent capability data fails.
 */
export function validateFolderMeta(meta: DriveFolderMeta | null | undefined): FolderValidation {
  const fail = (reason: string, recovery: string): FolderValidation => ({
    ok: false,
    reason,
    recovery,
    folder: null,
  });
  if (!meta || !meta.id) {
    return fail(
      "The selected folder could not be read from the connected Google account.",
      "Select the folder again, or create a new Software ServiceHub folder.",
    );
  }
  if (meta.mimeType !== GOOGLE_DRIVE_FOLDER_MIME) {
    return fail(
      "The selected item is not a Google Drive folder.",
      "Select a folder (not a file) in the picker.",
    );
  }
  if (meta.trashed) {
    return fail(
      "The selected folder is in the Google Drive trash.",
      "Restore the folder in Google Drive, or select another folder.",
    );
  }
  if (meta.capabilities?.canAddChildren !== true || meta.capabilities?.canListChildren !== true) {
    return fail(
      "Google did not confirm that the connected account can add and list files in that folder.",
      "Grant edit access to the connected account, or create a new Software ServiceHub folder it owns.",
    );
  }
  const driveId = meta.driveId ? String(meta.driveId) : null;
  return {
    ok: true,
    reason: null,
    recovery: null,
    folder: {
      id: String(meta.id),
      name: String(meta.name ?? DEFAULT_ROOT_FOLDER_NAME),
      driveId,
      driveContext: driveId ? "shared_drive" : "my_drive",
    },
  };
}

/** Folder names are created by us; keep them boring and safe. */
export function sanitizeFolderName(raw: unknown): string {
  const name = String(raw ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  if (!name) return DEFAULT_ROOT_FOLDER_NAME;
  return name.slice(0, 120);
}

// ------------------------------------------------------------- sharing -----

export interface DrivePermission {
  id?: string;
  type?: string;
  role?: string;
  allowFileDiscovery?: boolean;
  deleted?: boolean;
}

export interface SharingAssessment {
  status: SharingStatus;
  detail: string;
  isPublic: boolean;
}

/** Derive the true sharing status from Google's permission list. */
export function classifySharing(permissions: DrivePermission[]): SharingAssessment {
  const anyone = permissions.filter((p) => p?.type === "anyone" && p.deleted !== true);
  if (anyone.length) {
    const discoverable = anyone.some((p) => p.allowFileDiscovery === true);
    const roles = Array.from(new Set(anyone.map((p) => p.role ?? "reader"))).join(", ");
    return {
      status: "anyone_with_link",
      isPublic: true,
      detail: `Google reports an "anyone" permission (${roles})${
        discoverable ? ", discoverable by search" : ", link only"
      }.`,
    };
  }
  return {
    status: "restricted",
    isPublic: false,
    detail: `Google reports no "anyone" permission on this folder (${permissions.length} permission${
      permissions.length === 1 ? "" : "s"
    } checked).`,
  };
}

export function sharingUnavailable(reason: string): SharingAssessment {
  return { status: "error", isPublic: false, detail: reason };
}

export const SHARING_LABEL: Record<SharingStatus, string> = {
  restricted: "Restricted (recommended)",
  anyone_with_link: "Anyone with the link — PUBLIC",
  unknown: "Unknown — not checked yet",
  error: "Could not be checked",
};

export const SHARING_UNKNOWN_RECOVERY =
  'Sharing could not be read from Google, so it is NOT reported as Restricted. Run "Check sharing on Google" — if it keeps failing, reconnect Google Drive.';

export const PUBLIC_SHARING_WARNING =
  'Public Sharing Enabled — Google reports that anyone with the link can open files in this folder. "Restricted" is recommended; change it in Google Drive.';

export const PUBLIC_SHARING_CONFIRMATION =
  'I understand that Google currently shares this folder with "Anyone with the link", making service files readable by anyone holding the link, and I accept this risk for my company.';

export const SHARING_READ_ONLY_NOTICE =
  "ServiceHub only reads sharing from Google — it never changes your Drive sharing. Change sharing in Google Drive, then check it again here.";

export const ATTACHMENTS_NOT_IMPLEMENTED_NOTICE =
  "Job attachments are not yet implemented. This screen only connects your company's Google Drive; uploading, previewing, downloading and deleting Job files arrive in a later work package.";

/** The exact redirect URI Google Cloud must whitelist for a deployment origin. */
export function redirectUriFor(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${CALLBACK_PATH}`;
}

/** Callback outcomes are conveyed as short codes — never tokens or codes. */
export type CallbackOutcome =
  | "connected"
  | "account_changed"
  | "identity_failed"
  | "folder_recheck_required"
  | "state_invalid"
  | "state_expired"
  | "state_used"
  | "denied"
  | "scope_rejected"
  | "exchange_failed"
  | "not_configured";

export const CALLBACK_MESSAGE: Record<CallbackOutcome, string> = {
  connected: "Google Drive connected.",
  account_changed:
    "Google Drive connected with a different Google account. Select the Root Folder again.",
  identity_failed:
    "Google did not confirm which Google account authorised the connection, so nothing was connected and the new access was revoked. Start the connection again.",
  folder_recheck_required:
    "Google Drive re-authorised, but the saved Root Folder could not be confirmed as usable. An Owner/Admin must check the folder in Google Drive or select it again.",
  state_invalid: "The Google sign-in response could not be verified. Start the connection again.",
  state_expired: "The Google sign-in request expired. Start the connection again.",
  state_used: "That Google sign-in response was already used. Start the connection again.",
  denied: "Google access was declined. Nothing was connected.",
  scope_rejected:
    "Google returned permissions that do not match the approved Drive file access. The grant was revoked; start the connection again.",
  exchange_failed: "Google rejected the connection attempt. Start the connection again.",
  not_configured: "Google Drive is not configured for this deployment yet.",
};

/** Only these short codes may ever appear in a redirect URL. */
export const SAFE_CALLBACK_CODES = Object.keys(CALLBACK_MESSAGE) as CallbackOutcome[];
