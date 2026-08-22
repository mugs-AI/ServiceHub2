// Server-side Field Operations helpers: authorization, state loading and the
// append-only audit writes shared by every field endpoint.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canMutateField, computeWorkMinutes, workSessionState } from "./field-ops";
import type { FieldEvent, FieldState } from "./field-ops";

export interface FieldActor {
  tenantCode: string;
  userId: string | null;
  name: string | null;
  isAdmin: boolean;
}

export interface JobRow {
  id: string;
  tenant_code: string;
  status: string;
  is_deleted: boolean;
  assigned_user_id: string | null;
  job_number: string;
  support_mode: string | null;
  travel_started_at: string | null;
  arrived_on_site_at: string | null;
  left_site_at: string | null;
  ready_for_completion_at: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  assigned_user_name_snapshot: string | null;
  subscription_category_snapshot: string | null;
}

export class FieldOpsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function loadJob(tenantCode: string, jobId: string): Promise<JobRow> {
  const { data, error } = await supabaseAdmin
    .from("service_jobs")
    .select(
      "id, tenant_code, status, is_deleted, assigned_user_id, job_number, support_mode, travel_started_at, arrived_on_site_at, left_site_at, ready_for_completion_at, scheduled_start_at, scheduled_end_at, assigned_user_name_snapshot, subscription_category_snapshot",
    )
    .eq("tenant_code", tenantCode)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new FieldOpsError("Job not found.", 404);
  return data as JobRow;
}

/** Physical Field mutation = Primary PIC OR Owner/Admin (shared pure rule). */
export function assertFieldPermission(job: JobRow, actor: FieldActor): void {
  if (canMutateField(job, { isAdmin: actor.isAdmin, actorUserId: actor.userId })) return;
  throw new FieldOpsError(
    "Only the Primary PIC or an Administrator can perform field actions.",
    403,
  );
}

export interface OpenSession {
  id: string;
  status: "active" | "paused";
  started_at: string;
  technician_user_id: string;
}

export async function loadFieldState(
  tenantCode: string,
  jobId: string,
  job: JobRow,
): Promise<
  FieldState & {
    openSession: OpenSession | null;
    /** Exact current paused state marker (never a historical paused row). */
    pausedSessionId: string | null;
    sessionCount: number;
    waitingCount: number;
  }
> {
  const [sessions, waiting, notes] = await Promise.all([
    supabaseAdmin
      .from("service_job_work_sessions")
      .select("id, status, started_at, ended_at, duration_minutes, technician_user_id")
      .eq("tenant_code", tenantCode)
      .eq("service_job_id", jobId)
      .order("started_at", { ascending: false }),
    supabaseAdmin
      .from("service_job_waiting_periods")
      .select("id, waiting_type, resolved_at")
      .eq("tenant_code", tenantCode)
      .eq("service_job_id", jobId),
    supabaseAdmin
      .from("service_job_work_notes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_code", tenantCode)
      .eq("service_job_id", jobId),
  ]);
  if (sessions.error) throw sessions.error;
  if (waiting.error) throw waiting.error;
  if (notes.error) throw notes.error;

  const rows = sessions.data ?? [];
  const segState = workSessionState(rows);
  const openRows = (waiting.data ?? []).filter((w) => !w.resolved_at);
  const types = new Set(openRows.map((w) => w.waiting_type));
  const open: OpenSession | null = segState.activeSegment
    ? {
        id: segState.activeSegment.id,
        status: "active",
        started_at: segState.activeSegment.started_at,
        technician_user_id:
          (segState.activeSegment as { technician_user_id?: string }).technician_user_id ?? "",
      }
    : null;

  return {
    status: job.status,
    is_deleted: job.is_deleted,
    supportMode: job.support_mode ?? null,
    travelStartedAt: job.travel_started_at,
    arrivedAt: job.arrived_on_site_at,
    leftAt: job.left_site_at,
    activeSession: segState.status ? { status: segState.status } : null,
    openWaiting: { customer: types.has("customer"), vendor: types.has("vendor") },
    workNoteCount: notes.count ?? 0,
    openSession: open,
    sessionCount: rows.length,
    waitingCount: (waiting.data ?? []).length,
  };
}

/** Server-calculated total recorded work minutes for a job. */
export async function recomputeWorkMinutes(
  tenantCode: string,
  jobId: string,
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("service_job_work_sessions")
    .select("id, started_at, ended_at, duration_minutes, status")
    .eq("tenant_code", tenantCode)
    .eq("service_job_id", jobId);
  if (error) throw error;
  const total = computeWorkMinutes(data ?? []);
  await supabaseAdmin
    .from("service_jobs")
    .update({ total_work_minutes: total })
    .eq("tenant_code", tenantCode)
    .eq("id", jobId);
  return total;
}


export async function logFieldEvent(
  actor: FieldActor,
  jobId: string,
  eventType: FieldEvent | "work_note_added" | "attachment_added" | "attachment_deleted" | "job_completed",
  opts: {
    note?: string | null;
    oldValue?: string | null;
    newValue?: string | null;
    metadata?: Record<string, unknown> | null;
  } = {},
): Promise<void> {
  const { error } = await supabaseAdmin.from("service_job_activity_log").insert({
    tenant_code: actor.tenantCode,
    service_job_id: jobId,
    event_type: eventType,
    old_value: opts.oldValue ?? null,
    new_value: opts.newValue ?? null,
    note: opts.note ?? null,
    metadata_json: (opts.metadata ?? null) as never,
    performed_by_user_id: actor.userId,
    performed_by_name_snapshot: actor.name,
  });
  if (error) throw error;
}

/** Optional browser location, stored only when explicitly granted. */
export function sanitizeLocation(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const lat = Number(o.latitude ?? o.lat);
  const lng = Number(o.longitude ?? o.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const acc = Number(o.accuracy);
  return {
    latitude: lat,
    longitude: lng,
    ...(Number.isFinite(acc) ? { accuracy: acc } : {}),
  };
}

/** Move the job into a workflow status as a side effect of a field action. */
export async function setJobStatus(
  actor: FieldActor,
  job: JobRow,
  to: string,
  patch: Record<string, unknown> = {},
): Promise<void> {
  if (job.status === to && Object.keys(patch).length === 0) return;
  const { error } = await supabaseAdmin
    .from("service_jobs")
    .update({ status: to, ...patch })
    .eq("tenant_code", actor.tenantCode)
    .eq("id", job.id);
  if (error) throw error;
  if (job.status !== to) {
    await logFieldEvent(actor, job.id, "status_changed" as never, {
      oldValue: job.status,
      newValue: to,
    });
  }
}
