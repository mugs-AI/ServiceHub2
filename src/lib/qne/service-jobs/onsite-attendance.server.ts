// WP2C — server-only On-Site Attendance data access.
//
// Tenant and actor are always the server-resolved values from the
// authenticated N3 session; request bodies never supply identity.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ONSITE_ATTENDANCE_RPC,
  ONSITE_ATTENDANCE_TABLE,
  wp2cSchema,
} from "./wp2c-db.server";
import type { AttendanceVisit } from "./onsite-attendance";

export interface AttendanceActor {
  tenantCode: string;
  userId: string | null;
  name: string | null;
  code: string | null;
  email: string | null;
  isAdmin: boolean;
}

export interface AttendanceJobRow {
  id: string;
  tenant_code: string;
  status: string;
  is_deleted: boolean;
  job_number: string;
  assigned_user_id: string | null;
  support_mode: string | null;
}

export class AttendanceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AttendanceError";
  }
}

export async function loadAttendanceJob(
  tenantCode: string,
  jobId: string,
): Promise<AttendanceJobRow> {
  const { data, error } = await supabaseAdmin
    .from("service_jobs")
    .select("id, tenant_code, status, is_deleted, job_number, assigned_user_id, support_mode")
    .eq("tenant_code", tenantCode)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AttendanceError("Job not found.", 404);
  return data as AttendanceJobRow;
}

const VISIT_COLUMNS =
  "id, service_job_id, actor_user_id, actor_name_snapshot, clock_in_at, clock_out_at, duration_minutes, clock_in_latitude, clock_in_longitude, clock_in_accuracy_m, clock_in_gps_result, clock_in_exception_reason, clock_out_latitude, clock_out_longitude, clock_out_accuracy_m, clock_out_gps_result, clock_out_exception_reason, has_gps_exception";

/** Every visit on one Job, tenant-scoped. Visibility filtering is applied by the caller. */
export async function loadJobVisits(
  tenantCode: string,
  jobId: string,
): Promise<AttendanceVisit[]> {
  const { data, error } = await wp2cSchema
    .from(ONSITE_ATTENDANCE_TABLE)
    .select<AttendanceVisit>(VISIT_COLUMNS)
    .eq("tenant_code", tenantCode)
    .eq("service_job_id", jobId)
    .order("clock_in_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The actor's open session anywhere in the tenant (single-open invariant). */
export async function loadActorOpenVisit(
  tenantCode: string,
  actorUserId: string,
): Promise<(AttendanceVisit & { job_number_snapshot?: string | null }) | null> {
  const { data, error } = await wp2cSchema
    .from(ONSITE_ATTENDANCE_TABLE)
    .select<AttendanceVisit & { job_number_snapshot?: string | null }>(
      `${VISIT_COLUMNS}, job_number_snapshot`,
    )
    .eq("tenant_code", tenantCode)
    .eq("actor_user_id", actorUserId)
    .is("clock_out_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export interface MutateResult {
  outcome?: string;
  status?: number;
  error?: string;
  at?: string;
  visit_id?: string;
  duration_minutes?: number | null;
  gps_result?: string;
  has_gps_exception?: boolean;
  conflict_job_number?: string | null;
}

/**
 * Atomic Clock In / Clock Out. All lifecycle, single-open, duplicate-race and
 * audit handling lives inside the RPC transaction, so a rejected attempt can
 * never leave a success audit behind.
 */
export async function mutateAttendance(
  actor: AttendanceActor,
  jobId: string,
  action: "clock_in" | "clock_out",
  payload: Record<string, unknown>,
): Promise<MutateResult> {
  if (!actor.userId) throw new AttendanceError("Your user could not be resolved.", 401);
  const { data, error } = await wp2cSchema.rpc(ONSITE_ATTENDANCE_RPC, {
    p_tenant_code: actor.tenantCode,
    p_job_id: jobId,
    p_action: action,
    p_actor_user_id: actor.userId,
    p_actor_name: actor.name,
    p_actor_code: actor.code,
    p_actor_email: actor.email,
    p_payload: payload,
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as MutateResult;
}
