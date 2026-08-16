// WP0E-R — durable cancellation request repository (server-only).
//
// Every function is tenant-scoped: the tenant code is always the
// server-resolved one from the validated N3 session, never the browser's.
// State changes use conditional UPDATEs so that double-click, retry and
// competing Admin decisions cannot produce two final effects.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface CancellationJobRow {
  id: string;
  status: string;
  is_deleted: boolean;
  created_by_user_id: string | null;
  assigned_user_id: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  cancelled_by_name_snapshot: string | null;
}

export interface CancellationRequestRow {
  id: string;
  tenant_code: string;
  service_job_id: string;
  status: string;
  reason: string;
  requested_by_user_id: string | null;
  requested_by_name_snapshot: string | null;
  requested_at: string;
  prior_status: string;
  requester_policy_at_request: string;
  approval_mode_at_request: string;
  decision: string | null;
  decided_by_user_id: string | null;
  decided_by_name_snapshot: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface ActorSnapshot {
  userId: string | null;
  name: string | null;
}

const JOB_COLUMNS =
  "id, status, is_deleted, created_by_user_id, assigned_user_id, cancelled_at, cancellation_reason, cancelled_by_name_snapshot";

/** Tenant + job id lookup. Cross-tenant ids simply do not resolve. */
export async function fetchJobForCancellation(
  tenantCode: string,
  jobId: string,
): Promise<CancellationJobRow | null> {
  const { data, error } = await supabaseAdmin
    .from("service_jobs")
    .select(JOB_COLUMNS)
    .eq("tenant_code", tenantCode)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return (data as CancellationJobRow | null) ?? null;
}

export async function fetchActiveRequest(
  tenantCode: string,
  jobId: string,
): Promise<CancellationRequestRow | null> {
  const { data, error } = await supabaseAdmin
    .from("service_job_cancellation_requests")
    .select("*")
    .eq("tenant_code", tenantCode)
    .eq("service_job_id", jobId)
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw error;
  return (data as CancellationRequestRow | null) ?? null;
}

export async function listRequests(
  tenantCode: string,
  jobId: string,
): Promise<CancellationRequestRow[]> {
  const { data, error } = await supabaseAdmin
    .from("service_job_cancellation_requests")
    .select("*")
    .eq("tenant_code", tenantCode)
    .eq("service_job_id", jobId)
    .order("requested_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as CancellationRequestRow[];
}

/**
 * Insert a pending request. The partial unique index
 * (tenant_code, service_job_id) WHERE status='pending' makes racing duplicate
 * requests fail at the database, not in application code.
 */
export async function insertPendingRequest(input: {
  tenantCode: string;
  jobId: string;
  reason: string;
  priorStatus: string;
  requesterPolicy: string;
  approvalMode: string;
  actor: ActorSnapshot;
}): Promise<{ ok: true; row: CancellationRequestRow } | { ok: false; duplicate: true }> {
  const { data, error } = await supabaseAdmin
    .from("service_job_cancellation_requests")
    .insert({
      tenant_code: input.tenantCode,
      service_job_id: input.jobId,
      status: "pending",
      reason: input.reason,
      prior_status: input.priorStatus,
      requester_policy_at_request: input.requesterPolicy,
      approval_mode_at_request: input.approvalMode,
      requested_by_user_id: input.actor.userId,
      requested_by_name_snapshot: input.actor.name,
    })
    .select("*")
    .single();
  if (error) {
    // 23505 = unique_violation on the one-active-request index.
    if ((error as { code?: string }).code === "23505") return { ok: false, duplicate: true };
    throw error;
  }
  return { ok: true, row: data as CancellationRequestRow };
}

/**
 * Atomically claim a pending request for a decision. Returns null when another
 * Admin (or a retry of the same click) already decided it.
 */
export async function decidePendingRequest(input: {
  tenantCode: string;
  requestId: string;
  decision: "approved" | "rejected";
  note: string | null;
  actor: ActorSnapshot;
}): Promise<CancellationRequestRow | null> {
  const { data, error } = await supabaseAdmin
    .from("service_job_cancellation_requests")
    .update({
      status: input.decision,
      decision: input.decision,
      decision_note: input.note,
      decided_by_user_id: input.actor.userId,
      decided_by_name_snapshot: input.actor.name,
      decided_at: new Date().toISOString(),
    })
    .eq("tenant_code", input.tenantCode)
    .eq("id", input.requestId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as CancellationRequestRow | null) ?? null;
}

/**
 * Conditional finalization: only a Job that is not already terminal is moved
 * to Cancelled. A second call is a no-op and reports `alreadyFinal`.
 */
export async function finalizeJobCancellation(input: {
  tenantCode: string;
  jobId: string;
  reason: string;
  actor: ActorSnapshot;
}): Promise<{ finalized: boolean; job: Record<string, unknown> | null }> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("service_jobs")
    .update({
      status: "Cancelled",
      cancelled_at: now,
      cancellation_reason: input.reason,
      cancelled_by_user_id: input.actor.userId,
      cancelled_by_name_snapshot: input.actor.name,
    })
    .eq("tenant_code", input.tenantCode)
    .eq("id", input.jobId)
    .eq("is_deleted", false)
    .not("status", "in", '("Cancelled","Completed")')
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) return { finalized: false, job: null };
  return { finalized: true, job: data as Record<string, unknown> };
}

export async function appendCancellationActivity(input: {
  tenantCode: string;
  jobId: string;
  eventType: string;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
  actor: ActorSnapshot;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("service_job_activity_log").insert({
    tenant_code: input.tenantCode,
    service_job_id: input.jobId,
    event_type: input.eventType,
    old_value: input.oldValue,
    new_value: input.newValue,
    note: input.note,
    performed_by_user_id: input.actor.userId,
    performed_by_name_snapshot: input.actor.name,
  });
  if (error) throw error;
}
