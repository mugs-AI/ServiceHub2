// Software Support modes (Run 7 Phase B).
// A Job's support mode decides whether Travel / GPS / Arrival controls apply.

export const SUPPORT_MODES = [
  "remote_support",
  "onsite_support",
  "phone_whatsapp",
  "training",
  "installation",
  "migration",
  "consultation",
  "other",
] as const;

export type SupportMode = (typeof SUPPORT_MODES)[number];

export const SUPPORT_MODE_LABEL: Record<SupportMode, string> = {
  remote_support: "Remote Support",
  onsite_support: "Onsite Support",
  phone_whatsapp: "Phone / WhatsApp Guidance",
  training: "Training",
  installation: "Installation",
  migration: "Migration",
  consultation: "Consultation",
  other: "Other",
};

/** Modes that physically place a Support PIC at the customer site. */
const ONSITE_MODES: readonly SupportMode[] = [
  "onsite_support",
  "training",
  "installation",
  "migration",
];

export function isSupportMode(value: unknown): value is SupportMode {
  return typeof value === "string" && (SUPPORT_MODES as readonly string[]).includes(value);
}

export function supportModeLabel(value: string | null | undefined): string {
  return isSupportMode(value) ? SUPPORT_MODE_LABEL[value] : "Not specified";
}

/** Onsite-style work exposes Travel / Arrived / Leave Site. */
export function usesTravel(value: string | null | undefined): boolean {
  return isSupportMode(value) ? ONSITE_MODES.includes(value) : true;
}

/** Remote / phone work never needs travel or location. */
export function isRemoteMode(value: string | null | undefined): boolean {
  return value === "remote_support" || value === "phone_whatsapp";
}
