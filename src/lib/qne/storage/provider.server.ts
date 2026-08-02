// Tenant storage provider adapter (Run 7 Phase K).
//
// One server-side interface with a working `disabled` provider and a working
// Supabase (private bucket) provider. Google Drive, S3-compatible and Google
// Cloud Storage share the same interface; they report `not_configured` until
// the Owner supplies credentials, and never claim success without a real call.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { StorageMode } from "@/lib/qne/service-jobs/tenant-settings";

export const SUPABASE_BUCKET = "job-attachments";
const SIGNED_URL_TTL = 300;

export interface PutInput {
  tenantCode: string;
  jobId: string;
  jobNumber: string;
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
}

export interface PutResult {
  provider: StorageMode;
  container: string | null;
  objectKey: string;
  externalFileId: string | null;
}

export interface StorageAdapter {
  provider: StorageMode;
  /** Human explanation shown when the provider cannot accept uploads. */
  unavailableReason(): string | null;
  put(input: PutInput): Promise<PutResult>;
  createDownloadLink(objectKey: string): Promise<string | null>;
  deleteObject(objectKey: string): Promise<void>;
  objectExists(objectKey: string): Promise<boolean>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(-120);
}

const disabledAdapter: StorageAdapter = {
  provider: "disabled",
  unavailableReason: () =>
    "Attachments are disabled for this tenant. An Owner can enable storage in Settings → Attachments & Storage.",
  async put() {
    throw new Error("Attachment storage is disabled for this tenant.");
  },
  async createDownloadLink() {
    return null;
  },
  async deleteObject() {
    /* nothing stored */
  },
  async objectExists() {
    return false;
  },
  async testConnection() {
    return { ok: true, message: "Storage is disabled. No provider is contacted." };
  },
};

const supabaseAdapter: StorageAdapter = {
  provider: "supabase",
  unavailableReason: () => null,
  async put(input) {
    const key = `${input.tenantCode}/${input.jobId}/${crypto.randomUUID()}-${safeName(input.fileName)}`;
    const { error } = await supabaseAdmin.storage
      .from(SUPABASE_BUCKET)
      .upload(key, input.bytes, { contentType: input.mimeType, upsert: false });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    return {
      provider: "supabase",
      container: SUPABASE_BUCKET,
      objectKey: key,
      externalFileId: null,
    };
  },
  async createDownloadLink(objectKey) {
    const { data } = await supabaseAdmin.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(objectKey, SIGNED_URL_TTL);
    return data?.signedUrl ?? null;
  },
  async deleteObject(objectKey) {
    await supabaseAdmin.storage.from(SUPABASE_BUCKET).remove([objectKey]);
  },
  async objectExists(objectKey) {
    const { data } = await supabaseAdmin.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(objectKey, 30);
    return Boolean(data?.signedUrl);
  },
  async testConnection() {
    const { error } = await supabaseAdmin.storage.from(SUPABASE_BUCKET).list("", { limit: 1 });
    return error
      ? { ok: false, message: `Storage check failed: ${error.message}` }
      : { ok: true, message: `Private bucket "${SUPABASE_BUCKET}" reachable.` };
  },
};

/** Providers whose adapters exist but need Owner-supplied credentials. */
function pendingAdapter(provider: StorageMode, requirement: string): StorageAdapter {
  const reason = `${provider} storage is not connected yet. ${requirement}`;
  return {
    provider,
    unavailableReason: () => reason,
    async put() {
      throw new Error(reason);
    },
    async createDownloadLink() {
      return null;
    },
    async deleteObject() {
      /* nothing stored */
    },
    async objectExists() {
      return false;
    },
    async testConnection() {
      return { ok: false, message: reason };
    },
  };
}

export const GOOGLE_DRIVE_REQUIREMENT =
  "Add GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET and GOOGLE_DRIVE_REDIRECT_URI, then use Connect Google Drive.";
export const S3_REQUIREMENT =
  "Provide the bucket, region, endpoint and access credentials for the S3-compatible account.";
export const GCS_REQUIREMENT =
  "Provide the bucket name and a service-account key for Google Cloud Storage.";

export function googleDriveConfigured(): boolean {
  return Boolean(
    process.env["GOOGLE_DRIVE_CLIENT_ID"] &&
      process.env["GOOGLE_DRIVE_CLIENT_SECRET"] &&
      process.env["GOOGLE_DRIVE_REDIRECT_URI"],
  );
}

export function getAdapter(mode: StorageMode): StorageAdapter {
  switch (mode) {
    case "disabled":
      return disabledAdapter;
    case "supabase":
      return supabaseAdapter;
    case "google_drive":
      return pendingAdapter("google_drive", GOOGLE_DRIVE_REQUIREMENT);
    case "s3":
      return pendingAdapter("s3", S3_REQUIREMENT);
    case "gcs":
      return pendingAdapter("gcs", GCS_REQUIREMENT);
    default:
      return disabledAdapter;
  }
}

/** Signed link for an attachment row, honouring the provider it was stored with. */
export async function linkForAttachment(row: {
  storage_provider?: string | null;
  storage_path: string;
}): Promise<string | null> {
  const provider = (row.storage_provider ?? "supabase") as StorageMode;
  try {
    return await getAdapter(provider).createDownloadLink(row.storage_path);
  } catch {
    return null;
  }
}

export const STORAGE_RESPONSIBILITY_TEXT = `Changing or disconnecting this storage provider may make previous attachments unavailable.

MUGS does not retain copies of files stored in your provider.

I understand that my company is responsible for retaining or migrating previous attachments.`;

export const STORAGE_RESPONSIBILITY_VERSION = "v1";
