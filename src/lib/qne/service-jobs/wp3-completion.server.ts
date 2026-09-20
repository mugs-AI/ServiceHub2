// WP3 — server-only Simple Completion data access.
//
// Tenant and actor are always the server-resolved values from the
// authenticated N3 session; request bodies never supply identity, role,
// assignment or timestamps. The single mutation path is the atomic RPC.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  COMPLETE_JOB_RPC,
  COMPLETIONS_TABLE,
  ONSITE_ATTENDANCE_TABLE_REF,
  wp3Schema,
} from "./wp3-db.server";
import type { CompletionInput, CompletionRecord } from "./wp3-completion";

export interface CompletionActor {
  tenantCode: string;
  userId: string | null;
  name: string | null;
  code: string | null;
  email: string | null;
  isAdmin: boolean;
}

export interface CompletionJobRow {
  id: string;
  tenant_code: string;
  status: string;
  is_deleted: boolean;
  job_number: string;
  assigned_user_id: string | null;
}

export class CompletionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "CompletionError";
  }
}

export async function loadCompletionJob(
  tenantCode: string,
  jobId: string,
): Promise<CompletionJobRow> {
  const { data, error } = await supabaseAdmin
    .from("service_jobs")
    .select("id, tenant_code, status, is_deleted, job_number, assigned_user_id")
    .eq("tenant_code", tenantCode)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new CompletionError("Job not found.", 404);
  return data as CompletionJobRow;
}

const RECORD_COLUMNS =
  "resolution_summary, follow_up_required, completed_by_user_id, completed_by_name_snapshot, completed_at";

/**
 * The latest completion record for a Job, or null (including legacy Jobs).
 *
 * Completion cycles allow more than one immutable evidence row per Job, so the
 * read is ordered newest-first and deterministic: completed_at DESC with
 * created_at DESC as the tie-breaker. Both columns exist in the current
 * pre-migration schema, so this read is safe before and after the WP3A
 * candidate migration is applied.
 */
export async function loadCompletionRecord(
  tenantCode: string,
  jobId: string,
): Promise<CompletionRecord | null> {
  const { data, error } = await wp3Schema
    .from(COMPLETIONS_TABLE)
    .select<CompletionRecord>(RECORD_COLUMNS)
    .eq("tenant_code", tenantCode)
    .eq("service_job_id", jobId)
    .order("completed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Number of still-open on-site attendance visits on this Job. */
export async function countOpenAttendance(tenantCode: string, jobId: string): Promise<number> {
  const { data, error } = await wp3Schema
    .from(ONSITE_ATTENDANCE_TABLE_REF)
    .select<{ id: string }>("id")
    .eq("tenant_code", tenantCode)
    .eq("service_job_id", jobId)
    .is("clock_out_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

export interface CompletionRpcResult {
  outcome: "ok" | "error";
  status?: number;
  error?: string;
  idempotent?: boolean;
  completion_id?: string;
  completed_at?: string;
}

/**
 * The ONLY completion mutation path: one transaction that locks the Job,
 * rechecks authority and readiness, inserts exactly one completion row,
 * flips the Job to Completed with its immutable snapshot and writes the
 * audit event — all or nothing.
 */
export async function completeJobAtomic(
  actor: CompletionActor,
  jobId: string,
  input: CompletionInput,
): Promise<CompletionRpcResult> {
  if (!actor.userId) throw new CompletionError("Your user could not be resolved.", 401);
  const { data, error } = await wp3Schema.rpc(COMPLETE_JOB_RPC, {
    p_tenant_code: actor.tenantCode,
    p_job_id: jobId,
    p_actor_user_id: actor.userId,
    p_actor_name: actor.name,
    p_actor_code: actor.code,
    p_actor_email: actor.email,
    p_is_admin: actor.isAdmin,
    p_payload: {
      resolution_summary: input.resolution_summary,
      follow_up_required: input.follow_up_required,
    },
  });
  if (error) throw new Error(error.message);
  return (data ?? { outcome: "error", error: "Completion failed." }) as CompletionRpcResult;
}
