// Canonical, pure entitlement temporal classifier (Run SH2.2-ENTTIME).
//
// Single source of truth for "how many days are left" and
// Active / Due Soon / Overdue, derived from expiry_date against the CURRENT
// Malaysia calendar date. Persisted subscription_status / remaining_days are
// caches only — they must never be authoritative once time has advanced.
//
// Pure: no clock, no timezone lookup, no tenant IO. The server wrapper
// (temporal.server.ts) supplies Malaysia-today and the tenant dueSoonDays.

export type EntitlementTemporalStatus = "Active" | "Due Soon" | "Overdue" | "Unknown";

/** The three lifecycle values a snapshot row must have to be a live candidate. */
export const CANDIDATE_SNAPSHOT_STATUSES = ["Active", "Due Soon", "Overdue"] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalise a date-ish value to a yyyy-mm-dd business calendar date, or null. */
export function toCalendarDate(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().slice(0, 10);
  if (!DATE_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return s;
}

function utcMs(calendarDate: string): number {
  const [y, m, d] = calendarDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Whole calendar days between two yyyy-mm-dd dates (to - from).
 * Timezone-free: both sides are already business calendar dates.
 */
export function calendarDayDiff(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / 86400000);
}

export interface EntitlementTemporalInput {
  expiryDate: string | null | undefined;
  /** yyyy-mm-dd, Asia/Kuala_Lumpur, server-derived. */
  todayMalaysiaDate: string;
  /** Tenant policy; server-resolved, default 30. */
  dueSoonDays: number;
}

export interface EntitlementTemporalResult {
  remainingDays: number | null;
  status: EntitlementTemporalStatus;
}

/**
 * Canonical rule:
 *   invalid/missing expiry            -> Unknown
 *   remainingDays < 0                 -> Overdue
 *   0 <= remainingDays <= dueSoonDays -> Due Soon
 *   remainingDays > dueSoonDays       -> Active
 * The expiry day itself is 0 days remaining (Due Soon); the next Malaysia day
 * is -1 (Overdue).
 */
export function classifyEntitlement(input: EntitlementTemporalInput): EntitlementTemporalResult {
  const expiry = toCalendarDate(input.expiryDate);
  const today = toCalendarDate(input.todayMalaysiaDate);
  if (!expiry || !today) return { remainingDays: null, status: "Unknown" };
  const threshold =
    Number.isFinite(input.dueSoonDays) && input.dueSoonDays > 0 ? Math.floor(input.dueSoonDays) : 0;
  const remainingDays = calendarDayDiff(today, expiry);
  if (remainingDays < 0) return { remainingDays, status: "Overdue" };
  if (remainingDays <= threshold) return { remainingDays, status: "Due Soon" };
  return { remainingDays, status: "Active" };
}

/** Presentation-neutral ordering used by every derived list. */
export const DERIVED_STATUS_ORDER: Record<EntitlementTemporalStatus, number> = {
  Active: 0,
  "Due Soon": 1,
  Overdue: 2,
  Unknown: 3,
};
