// WP2C — narrow, server-only accessor for schema the candidate migration ADDS
// but which has NOT been applied to the live database yet.
//
// docs/migrations/WP2C_onsite_gps_attendance.candidate.sql creates
// public.service_job_onsite_attendance and the atomic RPC
// public.sh_onsite_attendance_mutate. Until that candidate is applied, the
// generated Supabase types (read-only) do not describe them, so WP2C reaches
// them through this deliberately small accessor instead of faking types.
//
// Nothing here bypasses tenant scoping: every call site still filters by the
// tenant_code resolved from the authenticated N3 session.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface PendingError {
  message: string;
}

export interface PendingFilter<T>
  extends PromiseLike<{ data: T[] | null; error: PendingError | null }> {
  eq(column: string, value: unknown): PendingFilter<T>;
  is(column: string, value: unknown): PendingFilter<T>;
  order(column: string, opts?: { ascending?: boolean }): PendingFilter<T>;
  limit(n: number): PendingFilter<T>;
  select(columns?: string): PendingFilter<T>;
  maybeSingle(): Promise<{ data: T | null; error: PendingError | null }>;
}

export interface PendingTable {
  select<T>(columns?: string): PendingFilter<T>;
}

export interface PendingClient {
  from(table: string): PendingTable;
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: PendingError | null }>;
}

export const wp2cSchema = supabaseAdmin as unknown as PendingClient;

export const ONSITE_ATTENDANCE_TABLE = "service_job_onsite_attendance";
export const ONSITE_ATTENDANCE_RPC = "sh_onsite_attendance_mutate";
