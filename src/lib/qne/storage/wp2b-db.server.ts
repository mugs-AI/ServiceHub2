// WP2B — narrow, server-only accessor for schema that the candidate migration
// ADDS but that has not been applied to the live database yet.
//
// The build brief authorises an additive migration FILE only: no live
// migration was executed, so `src/integrations/supabase/types.ts` (generated,
// read-only) still describes the pre-WP2B schema. Rather than fake generated
// types, WP2B reads and writes the new surface through this deliberately
// small, explicitly-typed accessor.
//
// Covered by this accessor:
//   • table  public.service_job_job_folders                  (new)
//   • cols   service_job_attachments.remote_delete_status     (new)
//            service_job_attachments.remote_delete_error      (new)
//            service_job_attachments.remote_deleted_at        (new)
//
// Once the migration is applied and types regenerate, call sites can move back
// onto the generated client with no behavioural change.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PendingRow = Record<string, unknown>;
export interface PendingError {
  message: string;
}

export interface PendingFilter<T> extends PromiseLike<{
  data: T[] | null;
  error: PendingError | null;
}> {
  eq(column: string, value: unknown): PendingFilter<T>;
  neq(column: string, value: unknown): PendingFilter<T>;
  order(column: string, opts?: { ascending?: boolean }): PendingFilter<T>;
  limit(n: number): PendingFilter<T>;
  select(columns?: string): PendingFilter<T>;
  maybeSingle(): Promise<{ data: T | null; error: PendingError | null }>;
  single(): Promise<{ data: T | null; error: PendingError | null }>;
}

export interface PendingTable {
  select<T = PendingRow>(columns?: string): PendingFilter<T>;
  insert<T = PendingRow>(row: PendingRow): PendingFilter<T>;
  update<T = PendingRow>(patch: PendingRow): PendingFilter<T>;
  upsert<T = PendingRow>(row: PendingRow, opts?: { onConflict?: string }): PendingFilter<T>;
}

export interface PendingClient {
  from(table: string): PendingTable;
}

/**
 * The same service-role client, typed for the pending WP2B surface only.
 * Nothing here bypasses tenant scoping: every call site still filters by
 * `tenant_code` resolved from the server-side session.
 */
export const pendingSchema = supabaseAdmin as unknown as PendingClient;

export interface JobFolderRow {
  drive_folder_id: string;
}
