// WP2A — client-safe Google Drive tenant-connection contracts and pure logic.
// No secrets, no network, no Node APIs: safe to import from browser code.

export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
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
export type SharingPolicy = "restricted" | "anyone_with_link";

export interface PublicDriveConnection {
  status: DriveConnectionStatus;
  accountEmail: string | null;
  rootFolderId: string | null;
  rootFolderName: string | null;
  driveContext: DriveContext | null;
  driveId: string | null;
  sharingPolicy: SharingPolicy;
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
  sharingPolicy: "restricted",
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
  return {
    status: (["connected", "needs_reconnect", "error", "disconnected"].includes(s)
      ? s
      : "error") as DriveConnectionStatus,
    accountEmail: (row.google_account_email as string) ?? null,
    rootFolderId: (row.root_folder_id as string) ?? null,
    rootFolderName: (row.root_folder_name as string) ?? null,
    driveContext: (row.drive_context as DriveContext) ?? null,
    driveId: (row.drive_id as string) ?? null,
    sharingPolicy: (row.sharing_policy as SharingPolicy) ?? "restricted",
    sharingConfirmedBy: (row.sharing_confirmed_by_name as string) ?? null,
    sharingConfirmedAt: (row.sharing_confirmed_at as string) ?? null,
    lastTestedAt: (row.last_tested_at as string) ?? null,
    lastTestResult: (row.last_test_result as string) ?? null,
    lastError: (row.last_error as string) ?? null,
    connectedBy: (row.connected_by_name as string) ?? null,
    updatedAt: (row.updated_at as string) ?? null,
  };
}

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
  if (meta.capabilities && meta.capabilities.canAddChildren === false) {
    return fail(
      "The connected Google account cannot add files to the selected folder.",
      "Grant edit access to the connected account, or select a folder it owns.",
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
  const name = String(raw ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (!name) return DEFAULT_ROOT_FOLDER_NAME;
  return name.slice(0, 120);
}

export const PUBLIC_SHARING_WARNING =
  'Public Sharing Enabled — files placed in this folder can be opened by anyone who has the link. "Restricted" is recommended.';

export const PUBLIC_SHARING_CONFIRMATION =
  "I understand that enabling \"Anyone with the link\" makes service files readable by anyone holding the link, and I accept this risk for my company.";

export const ATTACHMENTS_NOT_IMPLEMENTED_NOTICE =
  "Job attachments are not yet implemented. This screen only connects your company's Google Drive; uploading, previewing, downloading and deleting Job files arrive in a later work package.";

/** The exact redirect URI Google Cloud must whitelist for a deployment origin. */
export function redirectUriFor(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${CALLBACK_PATH}`;
}

/** Callback outcomes are conveyed as short codes — never tokens or codes. */
export type CallbackOutcome =
  | "connected"
  | "state_invalid"
  | "state_expired"
  | "state_used"
  | "denied"
  | "exchange_failed"
  | "not_configured";

export const CALLBACK_MESSAGE: Record<CallbackOutcome, string> = {
  connected: "Google Drive connected.",
  state_invalid: "The Google sign-in response could not be verified. Start the connection again.",
  state_expired: "The Google sign-in request expired. Start the connection again.",
  state_used: "That Google sign-in response was already used. Start the connection again.",
  denied: "Google access was declined. Nothing was connected.",
  exchange_failed: "Google rejected the connection attempt. Start the connection again.",
  not_configured: "Google Drive is not configured for this deployment yet.",
};
