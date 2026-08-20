// Server wrapper around the pure entitlement temporal classifier.
//
// Supplies the two authority inputs the browser must never provide:
//   * today's Malaysia (Asia/Kuala_Lumpur) calendar date
//   * the tenant's due_soon_days policy (default 30)

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  classifyEntitlement,
  type EntitlementTemporalStatus,
} from "./temporal";

export * from "./temporal";

/** yyyy-mm-dd in Asia/Kuala_Lumpur, derived server-side only. */
export function malaysiaToday(now: Date | number = Date.now()): string {
  const d = typeof now === "number" ? new Date(now) : now;
  // en-CA gives yyyy-mm-dd.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export interface EntitlementClock {
  today: string;
  dueSoonDays: number;
}

/** Tenant due_soon_days policy, default 30. Never browser supplied. */
export async function resolveDueSoonDays(tenantCode: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("general_settings")
    .select("due_soon_days")
    .eq("tenant_code", tenantCode)
    .maybeSingle();
  const v = data?.due_soon_days;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 30;
}

export async function entitlementClock(tenantCode: string): Promise<EntitlementClock> {
  return { today: malaysiaToday(), dueSoonDays: await resolveDueSoonDays(tenantCode) };
}

export interface DerivableRow {
  expiry_date: string | null;
  remaining_days?: number | null;
  subscription_status?: string | null;
}

/**
 * Replace the cached temporal fields of a snapshot row with current truth.
 * Every other field (source evidence, mapping, quantity) is untouched.
 */
export function deriveRow<T extends DerivableRow>(row: T, clock: EntitlementClock): T {
  const { remainingDays, status } = classifyEntitlement({
    expiryDate: row.expiry_date,
    todayMalaysiaDate: clock.today,
    dueSoonDays: clock.dueSoonDays,
  });
  return { ...row, remaining_days: remainingDays, subscription_status: status };
}

export function deriveRows<T extends DerivableRow>(
  rows: T[],
  clock: EntitlementClock,
): T[] {
  return rows.map((r) => deriveRow(r, clock));
}

export function derivedStatusOf(
  row: DerivableRow,
  clock: EntitlementClock,
): EntitlementTemporalStatus {
  return classifyEntitlement({
    expiryDate: row.expiry_date,
    todayMalaysiaDate: clock.today,
    dueSoonDays: clock.dueSoonDays,
  }).status;
}
