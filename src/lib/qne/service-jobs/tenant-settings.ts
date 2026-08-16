// Client-safe tenant settings shapes for Travel & GPS, Attachments & Storage
// and Completion & Acknowledgement. Persisted inside general_settings.extra.

import { usesTravel } from "./support-mode";
import {
  DEFAULT_CANCELLATION_SETTINGS,
  mergeCancellationSettings,
  type CancellationSettings,
} from "./cancellation";

export type { CancellationSettings };

export const GPS_MODES = ["off", "optional", "required_onsite"] as const;
export type GpsMode = (typeof GPS_MODES)[number];

export const GPS_MODE_LABEL: Record<GpsMode, string> = {
  off: "Off — never request location",
  optional: "Optional — ask, continue if declined",
  required_onsite: "Required for Onsite Jobs",
};

export const GPS_EVENTS = [
  "travel_started",
  "arrived_on_site",
  "work_started",
  "leave_site",
] as const;
export type GpsEvent = (typeof GPS_EVENTS)[number];

export interface TravelGpsSettings {
  mode: GpsMode;
  events: Record<GpsEvent, boolean>;
  /** Roles allowed to see stored latitude/longitude. */
  viewGpsRoles: string[];
}

export const STORAGE_MODES = [
  "disabled",
  "supabase",
  "google_drive",
  "s3",
  "gcs",
] as const;
export type StorageMode = (typeof STORAGE_MODES)[number];

export const STORAGE_MODE_LABEL: Record<StorageMode, string> = {
  disabled: "Disabled — attachments turned off",
  supabase: "Client-Owned Supabase Storage",
  google_drive: "Google Drive",
  s3: "Amazon S3 / S3-Compatible",
  gcs: "Google Cloud Storage",
};

export interface AttachmentSettings {
  storageMode: StorageMode;
  maxPhotoMB: number;
  maxScreenshotMB: number;
  maxDocumentMB: number;
  maxPerJob: number;
  maxTotalMBPerJob: number;
  allowedTypes: string[];
  compressionEnabled: boolean;
  maxDimension: number;
  imageQuality: number;
  warnThresholdPct: number;
  uploadRoles: string[];
  deleteRoles: string[];
  viewInternalRoles: string[];
}

export const ACK_MODES = [
  "not_required",
  "optional",
  "required_onsite",
  "required_categories",
  "required_all",
] as const;
export type AckMode = (typeof ACK_MODES)[number];

export const ACK_MODE_LABEL: Record<AckMode, string> = {
  not_required: "Not Required",
  optional: "Optional",
  required_onsite: "Required for Onsite Jobs",
  required_categories: "Required for Selected Job Categories",
  required_all: "Required for All Jobs",
};

export const ACK_METHODS = [
  "signature",
  "name_checkbox",
  "whatsapp",
  "email",
  "phone",
  "remote_session",
  "admin_waiver",
] as const;
export type AckMethod = (typeof ACK_METHODS)[number];

export const ACK_METHOD_LABEL: Record<AckMethod, string> = {
  signature: "Customer Signature",
  name_checkbox: "Name + Acknowledgement Checkbox",
  whatsapp: "WhatsApp Confirmation",
  email: "Email Confirmation",
  phone: "Phone Confirmation",
  remote_session: "Remote Session Confirmation",
  admin_waiver: "Admin Waiver",
};

export interface CompletionSettings {
  ackMode: AckMode;
  requiredCategories: string[];
  allowedMethods: AckMethod[];
  allowAdminWaiver: boolean;
}

export interface TenantSettings {
  travelGps: TravelGpsSettings;
  attachments: AttachmentSettings;
  completion: CompletionSettings;
  /** WP0E-R — tenant-configurable Service Job cancellation policy. */
  cancellation: CancellationSettings;
}


export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  travelGps: {
    mode: "optional",
    events: {
      travel_started: true,
      arrived_on_site: true,
      work_started: false,
      leave_site: false,
    },
    viewGpsRoles: ["administrator", "coordinator"],
  },
  attachments: {
    storageMode: "supabase",
    maxPhotoMB: 3,
    maxScreenshotMB: 5,
    maxDocumentMB: 10,
    maxPerJob: 20,
    maxTotalMBPerJob: 50,
    allowedTypes: ["image", "pdf", "office", "text", "zip"],
    compressionEnabled: true,
    maxDimension: 1600,
    imageQuality: 0.8,
    warnThresholdPct: 80,
    uploadRoles: ["administrator", "coordinator", "support_pic"],
    deleteRoles: ["administrator", "coordinator"],
    viewInternalRoles: ["administrator", "coordinator", "support_pic"],
  },
  completion: {
    ackMode: "required_onsite",
    requiredCategories: [],
    allowedMethods: [
      "signature",
      "name_checkbox",
      "whatsapp",
      "email",
      "phone",
      "remote_session",
    ],
    allowAdminWaiver: true,
  },
  cancellation: DEFAULT_CANCELLATION_SETTINGS,
};

/** Merge stored partials over defaults so old tenants keep working. */
export function mergeTenantSettings(raw: unknown): TenantSettings {
  const src = (raw ?? {}) as Partial<TenantSettings>;
  const d = DEFAULT_TENANT_SETTINGS;
  return {
    travelGps: {
      ...d.travelGps,
      ...(src.travelGps ?? {}),
      events: { ...d.travelGps.events, ...(src.travelGps?.events ?? {}) },
    },
    attachments: { ...d.attachments, ...(src.attachments ?? {}) },
    completion: { ...d.completion, ...(src.completion ?? {}) },
    cancellation: mergeCancellationSettings(src.cancellation),
  };
}

/** Should the browser ask for location for this event on this Job? */
export function gpsRequestFor(
  settings: TravelGpsSettings,
  event: string,
  supportMode: string | null | undefined,
): "none" | "optional" | "required" {
  if (settings.mode === "off") return "none";
  if (!(GPS_EVENTS as readonly string[]).includes(event)) return "none";
  if (!settings.events[event as GpsEvent]) return "none";
  if (settings.mode === "required_onsite") {
    return usesTravel(supportMode) ? "required" : "optional";
  }
  return "optional";
}

/** Tenant-derived acknowledgement requirement for one Job. */
export function ackRequirement(
  settings: CompletionSettings,
  supportMode: string | null | undefined,
  category: string | null | undefined,
): { required: boolean; reason: string } {
  switch (settings.ackMode) {
    case "not_required":
      return { required: false, reason: "Not required by tenant setting" };
    case "optional":
      return { required: false, reason: "Optional by tenant setting" };
    case "required_all":
      return { required: true, reason: "Required by tenant setting — All Jobs" };
    case "required_onsite":
      return usesTravel(supportMode)
        ? { required: true, reason: "Required by tenant setting — Onsite Support" }
        : { required: false, reason: "Optional for remote support" };
    case "required_categories": {
      const hit = !!category && settings.requiredCategories.includes(category);
      return hit
        ? { required: true, reason: `Required by tenant setting — ${category}` }
        : { required: false, reason: "Optional for this category" };
    }
    default:
      return { required: false, reason: "Optional" };
  }
}
