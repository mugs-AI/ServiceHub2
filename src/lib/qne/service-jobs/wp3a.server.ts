// WP3A — server-only data access for waiting references and reopen requests.
//
// Tenant, actor identity and administrator authority are always the
// server-resolved values from the authenticated N3 session. Request bodies
// never supply tenant, actor, role or timestamps. Every mutation goes through
// an atomic SECURITY DEFINER RPC; there is no multi-step write path here.

import {
  JOBS_TABLE_REF,
  REOPEN_DECIDE_RPC,
  REOPEN_REQUEST_RPC,
  REOPEN_REQUESTS_TABLE,
  WAITING_SET_RPC,
  wp3aSchema,
} from "./wp3a-db.server";

import type { WaitingInput } from "./wp3a-waiting";
import type { ReopenDecisionInput, ReopenRequestRow } from "./wp3a-reopen";
// Candidate (proposed, unapplied) schema shapes. The canonical generated
// Supabase types must be regenerated only after an authorised migration
// application; they are never hand-edited to describe unapplied schema.
import type {
  CandidateReopenDecideResult,
  CandidateReopenRequestResult,
  CandidateServiceJobColumns,
  CandidateWaitingSetResult,
} from "./wp3a-candidate-types";

export interface JobOpsActor {
  tenantCode: string;
  userId: string | null;
  name: string | null;
  isAdmin: boolean;
}

export class JobOpsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "JobOpsError";
  }
}

export interface RpcOutcome {
  outcome: "ok" | "error";
  status?: number;
  error?: string;
  [key: string]: unknown;
}

function requireActor(actor: JobOpsActor): string {
  if (!actor.tenantCode) throw new JobOpsError("Your tenant could not be resolved.", 401);
  if (!actor.userId) throw new JobOpsError("Your user could not be resolved.", 401);
  return actor.userId;
}

export type WaitingRefs = Pick<
  CandidateServiceJobColumns,
  "latest_customer_ref_no" | "latest_vendor_ref_no"
>;

/** Current-state latest references for the compact Job details column. */
export async function loadWaitingRefs(
  tenantCode: string,
  jobId: string,
): Promise<WaitingRefs> {
  const { data, error } = await wp3aSchema
    .from(JOBS_TABLE_REF)
    .select<WaitingRefs>("latest_customer_ref_no, latest_vendor_ref_no")
    .eq("tenant_code", tenantCode)
    .eq("id", jobId)
    .limit(1)
    .maybeSingle();
  // Before the candidate migration is applied the columns do not exist yet;
  // the UI then simply shows "—" instead of failing the Job detail read.
  if (error) return { latest_customer_ref_no: null, latest_vendor_ref_no: null };
  return data ?? { latest_customer_ref_no: null, latest_vendor_ref_no: null };
}

const REOPEN_COLUMNS =
  "id, status, reason, prior_status, completion_cycle_at_request, requested_by_user_id, " +
  "requested_by_name_snapshot, requested_at, decision_note, decided_by_name_snapshot, decided_at";

/** The single pending reopen request for a Job, if any. */
export async function loadPendingReopenRequest(
  tenantCode: string,
  jobId: string,
): Promise<ReopenRequestRow | null> {
  const { data, error } = await wp3aSchema
    .from(REOPEN_REQUESTS_TABLE)
    .select<ReopenRequestRow>(REOPEN_COLUMNS)
    .eq("tenant_code", tenantCode)
    .eq("service_job_id", jobId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}

/** Most recent reopen requests for a Job, newest first (history view). */
export async function loadReopenHistory(
  tenantCode: string,
  jobId: string,
  limit = 20,
): Promise<ReopenRequestRow[]> {
  const { data, error } = await wp3aSchema
    .from(REOPEN_REQUESTS_TABLE)
    .select<ReopenRequestRow>(REOPEN_COLUMNS)
    .eq("tenant_code", tenantCode)
    .eq("service_job_id", jobId)
    .order("requested_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return data ?? [];
}

/**
 * The ONLY waiting mutation path: one transaction that locks the Job, rechecks
 * the exact status, stores the latest reference, flips the status and writes
 * immutable activity evidence.
 */
export async function setWaitingStateAtomic(
  actor: JobOpsActor,
  jobId: string,
  input: WaitingInput,
): Promise<RpcOutcome> {
  const userId = requireActor(actor);
  const { data, error } = await wp3aSchema.rpc(WAITING_SET_RPC, {
    p_tenant_code: actor.tenantCode,
    p_job_id: jobId,
    p_party: input.party,
    p_ref_no: input.ref_no,
    p_actor_user_id: userId,
    p_actor_name: actor.name,
  });
  if (error) throw new Error(error.message);
  return (data ?? {
    outcome: "error",
    status: 500,
    error: "Waiting update failed.",
  }) as CandidateWaitingSetResult as RpcOutcome;
}

/** The ONLY reopen-request creation path. Never changes the Job status. */
export async function requestReopenAtomic(
  actor: JobOpsActor,
  jobId: string,
  reason: string,
): Promise<RpcOutcome> {
  const userId = requireActor(actor);
  const { data, error } = await wp3aSchema.rpc(REOPEN_REQUEST_RPC, {
    p_tenant_code: actor.tenantCode,
    p_job_id: jobId,
    p_reason: reason,
    p_actor_user_id: userId,
    p_actor_name: actor.name,
  });
  if (error) throw new Error(error.message);
  return (data ?? {
    outcome: "error",
    status: 500,
    error: "Reopen request failed.",
  }) as CandidateReopenRequestResult as RpcOutcome;
}

/**
 * The ONLY reopen decision path. Administrator authority is passed from the
 * server-resolved session and rechecked again inside the transaction.
 */
export async function decideReopenAtomic(
  actor: JobOpsActor,
  requestId: string,
  input: ReopenDecisionInput,
): Promise<RpcOutcome> {
  const userId = requireActor(actor);
  const { data, error } = await wp3aSchema.rpc(REOPEN_DECIDE_RPC, {
    p_tenant_code: actor.tenantCode,
    p_request_id: requestId,
    p_decision: input.decision,
    p_note: input.note,
    p_actor_user_id: userId,
    p_actor_name: actor.name,
    p_is_admin: actor.isAdmin,
  });
  if (error) throw new Error(error.message);
  return (data ?? { outcome: "error", error: "Reopen decision failed." }) as RpcOutcome;
}
