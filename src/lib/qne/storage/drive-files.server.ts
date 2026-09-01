// WP2B — server-only Google Drive FILE vertical for Job attachments.
//
// Builds on the WP2A connection engine (token storage, refresh, encryption,
// atomic audited mutations). This module owns only file/folder operations:
//
//   <selected Root Folder>/ServiceHub Jobs/<Job Number>
//
// Hard rules:
//  • Only `drive.file` calls are made; ServiceHub can therefore only address
//    folders and files it created itself.
//  • Drive folder/file IDs are server-side metadata. The browser never sends
//    a folder id, file id or path that is used for addressing, and never
//    receives an access token or a direct Drive URL.
//  • Folder mapping is persisted per tenant + job + connection so a Job folder
//    is created once and reused.

import { pendingSchema, type JobFolderRow } from "./wp2b-db.server";

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Fixed container created inside the tenant's selected Root Folder. */
export const JOBS_CONTAINER_NAME = "ServiceHub Jobs";

function driveFetch(accessToken: string, url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export class DriveFileError extends Error {
  constructor(
    message: string,
    readonly recovery: string,
  ) {
    super(message);
    this.name = "DriveFileError";
  }
}

/** Google Drive query-string literal escaping. */
function q(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Drive folder names cannot usefully contain slashes. */
function safeFolderName(name: string): string {
  return (
    String(name ?? "")
      .replace(/[\\/]/g, "-")
      // Stripping control characters is the point of this rule: they are
      // invisible in a filename and dangerous in headers.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 120) || "Job"
  );
}

/**
 * Find a ServiceHub-created child folder by name, or create it.
 * `drive.file` only lists files this app created, which is exactly the
 * guarantee we want: we never reuse a folder ServiceHub did not create.
 */
export async function findOrCreateChildFolder(
  accessToken: string,
  parentId: string,
  rawName: string,
): Promise<string> {
  const name = safeFolderName(rawName);
  const url = new URL(DRIVE_FILES);
  url.searchParams.set(
    "q",
    `'${q(parentId)}' in parents and name = '${q(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
  );
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "10");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const listed = await driveFetch(accessToken, url.toString());
  if (listed.ok) {
    const json = (await listed.json().catch(() => null)) as {
      files?: Array<{ id?: string }>;
    } | null;
    const existing = json?.files?.find((f) => f.id)?.id;
    if (existing) return String(existing);
  } else if (listed.status === 401 || listed.status === 403) {
    throw new DriveFileError(
      `Google Drive refused the folder lookup (HTTP ${listed.status}).`,
      "Reconnect Google Drive from Settings, then try again.",
    );
  }

  const created = await driveFetch(accessToken, `${DRIVE_FILES}?supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!created.ok) {
    throw new DriveFileError(
      `Google Drive could not create the "${name}" folder (HTTP ${created.status}).`,
      "Check the connected Google account has space and access to the Root Folder, then try again.",
    );
  }
  const json = (await created.json().catch(() => null)) as { id?: string } | null;
  if (!json?.id) {
    throw new DriveFileError(
      `Google Drive did not return an id for the "${name}" folder.`,
      "Run Test Connection in Settings, then try again.",
    );
  }
  return String(json.id);
}

export interface JobFolderInput {
  tenantCode: string;
  jobId: string;
  jobNumber: string;
  connectionId: string;
  rootFolderId: string;
  accessToken: string;
}

/**
 * Resolve (and persist) the Drive folder for one Job. The mapping row is the
 * cache; Drive itself is the authority when the mapping is missing.
 */
export async function ensureJobFolder(input: JobFolderInput): Promise<string> {
  const { data: mapped } = await pendingSchema
    .from("service_job_job_folders")
    .select<JobFolderRow>("drive_folder_id")
    .eq("tenant_code", input.tenantCode)
    .eq("service_job_id", input.jobId)
    .eq("connection_id", input.connectionId)
    .maybeSingle();
  if (mapped?.drive_folder_id) return String(mapped.drive_folder_id);

  const container = await findOrCreateChildFolder(
    input.accessToken,
    input.rootFolderId,
    JOBS_CONTAINER_NAME,
  );
  const jobFolderId = await findOrCreateChildFolder(
    input.accessToken,
    container,
    input.jobNumber || input.jobId,
  );

  const { error } = await pendingSchema.from("service_job_job_folders").upsert(
    {
      tenant_code: input.tenantCode,
      service_job_id: input.jobId,
      connection_id: input.connectionId,
      drive_folder_id: jobFolderId,
      container_folder_id: container,
      job_number: input.jobNumber,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_code,service_job_id,connection_id" },
  );
  if (error) {
    throw new DriveFileError(
      "The Google Drive folder for this Job could not be recorded, so the upload was not accepted.",
      "Try again. If it keeps failing, run Test Connection in Settings.",
    );
  }
  return jobFolderId;
}

export interface UploadedDriveFile {
  id: string;
  name: string;
}

/** Multipart upload of one file into a ServiceHub-created Job folder. */
export async function uploadFileToFolder(
  accessToken: string,
  folderId: string,
  displayName: string,
  mimeType: string,
  bytes: ArrayBuffer,
): Promise<UploadedDriveFile> {
  const boundary = `sh2b${crypto.randomUUID().replace(/-/g, "")}`;
  const metadata = JSON.stringify({ name: displayName, parents: [folderId] });
  const head =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const body = new Blob([head, bytes, tail]);

  const res = await driveFetch(
    accessToken,
    `${DRIVE_UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id,name`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (!res.ok) {
    throw new DriveFileError(
      `Google Drive rejected the upload of "${displayName}" (HTTP ${res.status}).`,
      "Check the connected Google account has storage space, then retry the upload.",
    );
  }
  const json = (await res.json().catch(() => null)) as { id?: string; name?: string } | null;
  if (!json?.id) {
    throw new DriveFileError(
      `Google Drive did not confirm the upload of "${displayName}".`,
      "Retry the upload.",
    );
  }
  return { id: String(json.id), name: json.name ?? displayName };
}

export type TrashResult = { ok: true } | { ok: false; reason: string };

/**
 * Move a Drive file to Trash. A 404 means the file is already gone from
 * Drive, which satisfies the intent, so it is reported as success.
 */
export async function trashDriveFile(accessToken: string, fileId: string): Promise<TrashResult> {
  if (!fileId)
    return { ok: false, reason: "No Google Drive file id is recorded for this attachment." };
  let res: Response;
  try {
    res = await driveFetch(
      accessToken,
      `${DRIVE_FILES}/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,trashed`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      },
    );
  } catch {
    return { ok: false, reason: "Google Drive could not be reached to move the file to Trash." };
  }
  if (res.ok) return { ok: true };
  if (res.status === 404) return { ok: true };
  return {
    ok: false,
    reason: `Google Drive refused to move the file to Trash (HTTP ${res.status}).`,
  };
}

/** Byte stream for the server-proxied preview/download route. */
export async function fetchDriveFileStream(accessToken: string, fileId: string): Promise<Response> {
  return driveFetch(
    accessToken,
    `${DRIVE_FILES}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
  );
}
