// WP0E-R — durable cancellation repository (server-only).
//
// Integrity correction: every state change is now performed by a single
// database routine that owns the whole effect — validation, the state row and
// its audit row — inside one transaction. The application no longer issues a
// sequence of independent writes, so a failure part-way can never leave a
// cancelled Job without audit, an approved request without a cancelled Job, or
// a pending request without its "cancellation_requested" entry.
//
// Every call is tenant-scoped with the server-resolved tenant code, never the
// browser's. Concurrency is settled inside the routine (row locks plus the
// one-active-request partial unique index), so double-clicks, retries and
// competing Admin decisions collapse to at most one final effect.

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

/** Outcome vocabulary shared by the three atomic routines. */
export type CancellationOutcome =
  | "created"
  | "cancelled"
  | "approved"
  | "rejected"
  | "reason_required"
  | "job_not_found"
  | "job_not_cancellable"
  | "duplicate_active_request"
  | "request_not_found"
  | "already_decided"
  | "invalid_decision";

export interface AtomicCancellationResult {
  outcome: CancellationOutcome;
  request?: CancellationRequestRow;
  job?: Record<string, unknown>;
  status?: string;
}

const JOB_COLUMNS =
  "id, status, is_deleted, created_by_user_id, assigned_user_id, cancelled_at, cancellation_reason, cancelled_by_name_snapshot";

/* ---------------- reads ---------------- */

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

/* ---------------- atomic state changes ---------------- */

/**
 * The generated RPC argument types are non-nullable; actor identity and notes
 * are legitimately absent for system-initiated actions.
 */
function nullable(value: string | null): string {
  return value as unknown as string;
}

function asResult(data: unknown): AtomicCancellationResult {
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    outcome: String(row.outcome ?? "job_not_found") as CancellationOutcome,
    request: (row.request as CancellationRequestRow | undefined) ?? undefined,
    job: (row.job as Record<string, unknown> | undefined) ?? undefined,
    status: (row.status as string | undefined) ?? undefined,
  };
}

/**
 * Creates the pending request together with its audit entry in one
 * transaction. Duplicate active requests are refused by the database.
 */
export async function createCancellationRequestAtomic(input: {
  tenantCode: string;
  jobId: string;
  reason: string;
  requesterPolicy: string;
  approvalMode: string;
  actor: ActorSnapshot;
}): Promise<AtomicCancellationResult> {
  const { data, error } = await supabaseAdmin.rpc("sh_cancellation_request_create", {
    p_tenant_code: input.tenantCode,
    p_job_id: input.jobId,
    p_reason: input.reason,
    p_requester_policy: input.requesterPolicy,
    p_approval_mode: input.approvalMode,
    p_actor_user_id: nullable(input.actor.userId),
    p_actor_name: nullable(input.actor.name),
  });
  if (error) throw error;
  return asResult(data);
}

/**
 * Direct-mode cancellation: the Job transition and its audit entry are one
 * indivisible effect. A retry finds the Job terminal and changes nothing.
 */
export async function cancelJobDirectAtomic(input: {
  tenantCode: string;
  jobId: string;
  reason: string;
  actor: ActorSnapshot;
}): Promise<AtomicCancellationResult> {
  const { data, error } = await supabaseAdmin.rpc("sh_cancellation_cancel_direct", {
    p_tenant_code: input.tenantCode,
    p_job_id: input.jobId,
    p_reason: input.reason,
    p_actor_user_id: nullable(input.actor.userId),
    p_actor_name: nullable(input.actor.name),
  });
  if (error) throw error;
  return asResult(data);
}

/**
 * Owner/Admin decision. On approval the request claim, the Job cancellation
 * and the audit entry commit together or not at all; the Job is validated and
 * locked before the request is claimed, so a non-cancellable Job can never
 * leave a committed "approved" request behind.
 */
export async function decideCancellationAtomic(input: {
  tenantCode: string;
  requestId: string;
  decision: "approved" | "rejected";
  note: string | null;
  actor: ActorSnapshot;
}): Promise<AtomicCancellationResult> {
  const { data, error } = await supabaseAdmin.rpc("sh_cancellation_decide", {
    p_tenant_code: input.tenantCode,
    p_request_id: input.requestId,
    p_decision: input.decision,
    p_note: nullable(input.note),
    p_actor_user_id: nullable(input.actor.userId),
    p_actor_name: nullable(input.actor.name),
  });
  if (error) throw error;
  return asResult(data);
}

/* ---------------- shared pending-decision read model ---------------- */
//
// One helper serves the Owner/Admin Dashboard KPI, the Owner/Admin decision
// queue and the "Cancellation Requested" flag in the ordinary Pending Queue,
// so those three surfaces can never disagree. Reads only: no RPC, no writes.
// "Actionable" means status = pending AND the Job still exists in the same
// tenant and is not soft-deleted.

export interface PendingCancellationQueueRow {
  request_id: string;
  service_job_id: string;
  job_number: string;
  subject: string;
  customer_code: string;
  customer_name: string | null;
  job_status: string;
  priority: string;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  requested_by_name: string | null;
  requested_at: string;
  reason: string;
  prior_status: string;
}

interface RawPendingRequest {
  id: string;
  service_job_id: string;
  reason: string;
  prior_status: string;
  requested_at: string;
  requested_by_name_snapshot: string | null;
}

const PENDING_SCAN_LIMIT = 1000;

async function loadPendingRequests(tenantCode: string): Promise<RawPendingRequest[]> {
  const { data, error } = await supabaseAdmin
    .from("service_job_cancellation_requests")
    .select("id, service_job_id, reason, prior_status, requested_at, requested_by_name_snapshot")
    .eq("tenant_code", tenantCode)
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(PENDING_SCAN_LIMIT);
  if (error) throw error;
  return (data ?? []) as RawPendingRequest[];
}

interface QueueJobRow {
  id: string;
  job_number: string;
  subject: string;
  customer_code_snapshot: string;
  customer_name_snapshot: string | null;
  status: string;
  priority: string;
  assigned_user_id: string | null;
  assigned_user_name_snapshot: string | null;
}

async function loadJobsForRequests(
  tenantCode: string,
  jobIds: string[],
): Promise<Map<string, QueueJobRow>> {
  const map = new Map<string, QueueJobRow>();
  if (jobIds.length === 0) return map;
  const { data, error } = await supabaseAdmin
    .from("service_jobs")
    .select(
      "id, job_number, subject, customer_code_snapshot, customer_name_snapshot, status, priority, assigned_user_id, assigned_user_name_snapshot",
    )
    .eq("tenant_code", tenantCode)
    .eq("is_deleted", false)
    .in("id", jobIds);
  if (error) throw error;
  for (const row of (data ?? []) as QueueJobRow[]) map.set(row.id, row);
  return map;
}

/** Full actionable pending queue, oldest request first. */
export async function loadPendingCancellationQueue(
  tenantCode: string,
): Promise<PendingCancellationQueueRow[]> {
  const pending = await loadPendingRequests(tenantCode);
  const jobs = await loadJobsForRequests(
    tenantCode,
    pending.map((r) => r.service_job_id),
  );
  const rows: PendingCancellationQueueRow[] = [];
  for (const r of pending) {
    const job = jobs.get(r.service_job_id);
    if (!job) continue; // deleted or missing Job — not actionable
    rows.push({
      request_id: r.id,
      service_job_id: job.id,
      job_number: job.job_number,
      subject: job.subject,
      customer_code: job.customer_code_snapshot,
      customer_name: job.customer_name_snapshot,
      job_status: job.status,
      priority: job.priority,
      assigned_user_id: job.assigned_user_id,
      assigned_user_name: job.assigned_user_name_snapshot,
      requested_by_name: r.requested_by_name_snapshot,
      requested_at: r.requested_at,
      reason: r.reason,
      prior_status: r.prior_status,
    });
  }
  return rows;
}

/** Dashboard KPI — actionable pending cancellation decisions for the tenant. */
export async function countPendingCancellationRequests(tenantCode: string): Promise<number> {
  return (await loadPendingCancellationQueue(tenantCode)).length;
}

/**
 * Owner/Admin flag source for the ordinary Pending Queue. One extra query for
 * the whole page rather than one per Job row.
 */
export async function pendingCancellationJobIds(
  tenantCode: string,
  jobIds: string[],
): Promise<Set<string>> {
  if (jobIds.length === 0) return new Set();
  const { data, error } = await supabaseAdmin
    .from("service_job_cancellation_requests")
    .select("service_job_id")
    .eq("tenant_code", tenantCode)
    .eq("status", "pending")
    .in("service_job_id", jobIds);
  if (error) throw error;
  return new Set(((data ?? []) as { service_job_id: string }[]).map((r) => r.service_job_id));
}
