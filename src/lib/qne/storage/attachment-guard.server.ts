// WP2B — provider/account/root-folder switch guard.
//
// While a tenant holds ACTIVE Google Drive Job attachments, ServiceHub must
// not disconnect the Drive connection, change the selected Root Folder, or
// accept a different Google account: any of those silently orphans live
// attachment metadata from the bytes it points at. There is no automatic
// migration in v1, so the only truthful behaviour is to refuse and say why.
//
// Same-account token refresh and same-account reconnect that PRESERVE the
// Root Folder are unaffected — they change no addressing.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type GuardedAction =
  | "disconnect"
  | "change_root_folder"
  | "change_account"
  | "change_storage_provider";

const ACTION_PHRASE: Record<GuardedAction, string> = {
  disconnect: "disconnect Google Drive",
  change_root_folder: "change the selected Root Folder",
  change_account: "connect a different Google account",
  change_storage_provider: "change the attachment storage provider",
};

/** Count of attachments that still point at Google Drive bytes. */
export async function activeDriveAttachmentCount(tenantCode: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("service_job_attachments")
    .select("id")
    .eq("tenant_code", tenantCode)
    .eq("storage_provider", "google_drive")
    .eq("is_deleted", false);
  if (error) {
    // Fail closed: an uncountable state must never be reported as "safe".
    throw new Error(
      "The number of active Google Drive attachments could not be checked, so the change was not applied.",
    );
  }
  return (data ?? []).length;
}

export interface GuardOutcome {
  blocked: boolean;
  count: number;
  error?: string;
  recovery?: string;
}

/**
 * Evaluate a guarded mutation. Callers MUST honour `blocked` on the server —
 * hiding the control in the UI is not the control.
 */
export async function guardProviderChange(
  tenantCode: string,
  action: GuardedAction,
): Promise<GuardOutcome> {
  const count = await activeDriveAttachmentCount(tenantCode);
  if (count === 0) return { blocked: false, count };
  return {
    blocked: true,
    count,
    error: `This company has ${count} active Google Drive Job attachment${
      count === 1 ? "" : "s"
    }. You cannot ${ACTION_PHRASE[action]} while they exist, because ServiceHub would lose the link to those files. Nothing was changed.`,
    recovery:
      "Delete the remaining Google Drive attachments from their Jobs first. ServiceHub does not move existing attachment files automatically.",
  };
}
