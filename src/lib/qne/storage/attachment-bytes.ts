// WP2A guard — Job attachment BYTE creation is switched off until WP2B ships
// the Google Drive attachment vertical. Existing attachment metadata and
// historical rows are preserved and remain readable; only new byte writes to
// the legacy Supabase production bucket are refused, so ServiceHub never
// silently falls back to a storage provider that is not the tenant's Drive.

export const ATTACHMENT_BYTES_ENABLED = false;

export const ATTACHMENT_BYTES_DISABLED_MESSAGE =
  "Job attachments are not yet implemented. Uploading files is disabled until the Google Drive attachment work package is delivered. Existing attachment records are unchanged.";
