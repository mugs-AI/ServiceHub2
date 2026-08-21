// Shared Due Soon Window policy contract (Run SH2.2-DUESOON).
//
// One source of truth for the default/min/max and the validation +
// normalization rules used by the Settings UI, the Settings API and the
// server-side entitlement clock. This module defines NO classification logic —
// the current-time classifier in ./temporal.ts remains the sole authority for
// Active / Due Soon / Overdue.

export const DEFAULT_DUE_SOON_DAYS = 30;
export const MIN_DUE_SOON_DAYS = 0;
export const MAX_DUE_SOON_DAYS = 365;

export const DUE_SOON_RANGE_MESSAGE = `Enter a whole number of days between ${MIN_DUE_SOON_DAYS} and ${MAX_DUE_SOON_DAYS}.`;

/** True only for a finite whole integer inside the inclusive 0–365 range. */
export function isValidDueSoonDays(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_DUE_SOON_DAYS &&
    value <= MAX_DUE_SOON_DAYS
  );
}

/**
 * Validate an inbound (client-submitted) value. Strings, fractions, NaN,
 * out-of-range numbers and missing values are all rejected — never clamped.
 */
export function parseDueSoonDaysInput(
  value: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  if (!isValidDueSoonDays(value)) return { ok: false, error: DUE_SOON_RANGE_MESSAGE };
  return { ok: true, value };
}

/**
 * Resolve an effective threshold from a STORED value. Missing or invalid
 * stored data falls back to the default (30) — reads must never fail because
 * of a bad row.
 */
export function normalizeStoredDueSoonDays(value: unknown): number {
  return isValidDueSoonDays(value) ? value : DEFAULT_DUE_SOON_DAYS;
}
