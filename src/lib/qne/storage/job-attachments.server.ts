// WP2B — server-side helpers shared by the Job Attachment routes.
//
// Everything here derives the tenant from the authenticated N3 session; the
// browser never supplies a tenant, provider path, Drive folder/file id or
// token. Job access is proven by a tenant-scoped lookup: a Job that belongs to
// another tenant is indistinguishable from a Job that does not exist (404).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pendingSchema } from "./wp2b-db.server";
import type { ConnectionRow } from "./google-drive.server";

export const GOOGLE_DRIVE_PROVIDER = "google_drive";

export interface AttachmentActor {
  tenantCode: string;
  userId: string | null;
  name: string | null;
  isAdmin: boolean;
}

export interface AttachmentJob {
  id: string;
  job_number: string;
  assigned_user_id: string | null;
  is_deleted: boolean;
}

/** Tenant-scoped Job lookup. `null` means "404" — never "forbidden". */
export async function loadJobForAttachments(
  tenantCode: string,
  jobId: string,
): Promise<AttachmentJob | null> {
  const { data, error } = await supabaseAdmin
    .from("service_jobs")
    .select("id, job_number, assigned_user_id, is_deleted")
    .eq("tenant_code", tenantCode)
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) return null;
  return data as AttachmentJob;
}

export interface AttachmentRecord {
  id: string;
  tenant_code: string;
  service_job_id: string;
  attachment_type: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  storage_provider: string;
  storage_connection_id: string | null;
  storage_container: string | null;
  external_file_id: string | null;
  visibility: string;
  availability_status: string;
  is_deleted: boolean;
  uploaded_by_user_id: string | null;
  uploaded_by_name_snapshot: string | null;
  created_at: string;
  remote_delete_status?: string | null;
  remote_delete_error?: string | null;
}

export async function loadActiveAttachments(
  tenantCode: string,
  jobId: string,
): Promise<AttachmentRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("service_job_attachments")
    .select("*")
    .eq("tenant_code", tenantCode)
    .eq("service_job_id", jobId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AttachmentRecord[];
}

export async function loadAttachment(
  tenantCode: string,
  jobId: string,
  attachmentId: string,
): Promise<AttachmentRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("service_job_attachments")
    .select("*")
    .eq("tenant_code", tenantCode)
    .eq("service_job_id", jobId)
    .eq("id", attachmentId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as AttachmentRecord;
}

/** Server-side active count and active total for one Job. */
export async function quotaFor(
  tenantCode: string,
  jobId: string,
): Promise<{ activeCount: number; activeBytes: number }> {
  const rows = await loadActiveAttachments(tenantCode, jobId);
  return {
    activeCount: rows.length,
    activeBytes: rows.reduce((n, r) => n + (Number(r.file_size) || 0), 0),
  };
}

export class AttachmentAuditError extends Error {
  constructor(event: string) {
    super(
      `The Job history record for "${event}" could not be saved, so the action was not reported as successful.`,
    );
    this.name = "AttachmentAuditError";
  }
}

/**
 * Mandatory Job-history audit. THROWS on failure: no WP2B operation may
 * report success when its audit record was lost.
 */
export async function logAttachmentEvent(
  actor: AttachmentActor,
  jobId: string,
  eventType: string,
  detail: { note?: string | null; newValue?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  const { error } = await supabaseAdmin.from("service_job_activity_log").insert({
    tenant_code: actor.tenantCode,
    service_job_id: jobId,
    event_type: eventType,
    new_value: detail.newValue ?? null,
    note: detail.note ?? null,
    performed_by_user_id: actor.userId,
    performed_by_name_snapshot: actor.name,
    metadata_json: (detail.metadata ?? {}) as never,
  });
  if (error) throw new AttachmentAuditError(eventType);
}

export class RemoteDeleteStateError extends Error {
  constructor(status: string) {
    super(
      `The attachment's Google Drive delete state ("${status}") could not be saved, so the delete was not reported as successful.`,
    );
    this.name = "RemoteDeleteStateError";
  }
}

/**
 * Persist remote-delete truth on an attachment row (pending WP2B columns).
 * THROWS on a database error: a caller must never continue as though the
 * failed/trashed state was recorded when it was not.
 */
export async function setRemoteDeleteState(
  tenantCode: string,
  attachmentId: string,
  patch: { status: string; error?: string | null; deletedAt?: string | null },
): Promise<void> {
  const { error } = await pendingSchema
    .from("service_job_attachments")
    .update({
      remote_delete_status: patch.status,
      remote_delete_error: patch.error ?? null,
      remote_deleted_at: patch.deletedAt ?? null,
    })
    .eq("tenant_code", tenantCode)
    .eq("id", attachmentId);
  if (error) throw new RemoteDeleteStateError(patch.status);
}

export interface DriveContext {
  connection: ConnectionRow;
  connectionId: string;
  rootFolderId: string;
  accessToken: string;
}

export type DriveContextResult =
  | { ok: true; context: DriveContext }
  | { ok: false; status: number; error: string; recovery: string };

/**
 * Resolve the tenant's accepted, active Google Drive connection and a usable
 * access token. Fails closed with an actionable message — there is never a
 * silent fallback to Supabase Storage.
 */
export async function resolveDriveContext(tenantCode: string): Promise<DriveContextResult> {
  const gd = await import("./google-drive.server");
  const missing = gd.missingDriveEnv();
  if (missing.length) {
    return {
      ok: false,
      status: 503,
      error: "Google Drive is not configured for this deployment, so attachments cannot be stored.",
      recovery: "An administrator must finish the Google Drive server configuration.",
    };
  }
  const row = await gd.loadConnection(tenantCode);
  if (!row) {
    return {
      ok: false,
      status: 409,
      error: "This company has not connected Google Drive, so attachments cannot be uploaded.",
      recovery: "An Owner or Admin must connect Google Drive in Settings.",
    };
  }
  if (row.status !== "connected") {
    return {
      ok: false,
      status: 409,
      error:
        row.status === "needs_reconnect"
          ? "The Google Drive connection needs to be re-authorised before attachments can be uploaded."
          : `The Google Drive connection is not usable right now (${row.status}).`,
      recovery: "An Owner or Admin must reconnect or re-test Google Drive in Settings.",
    };
  }
  if (!row.root_folder_id) {
    return {
      ok: false,
      status: 409,
      error: "No Google Drive Root Folder has been selected for this company.",
      recovery: "An Owner or Admin must select a Root Folder in Settings.",
    };
  }
  let accessToken: string;
  try {
    accessToken = await gd.accessTokenFor(row);
  } catch (e) {
    return {
      ok: false,
      status: 409,
      error: e instanceof Error ? e.message : "The Google Drive credential could not be refreshed.",
      recovery: "An Owner or Admin must reconnect Google Drive in Settings.",
    };
  }
  return {
    ok: true,
    context: {
      connection: row,
      connectionId: row.id,
      rootFolderId: row.root_folder_id,
      accessToken,
    },
  };
}
