// WP3B — server-only follow-up lifecycle data access.
//
// Tenant and actor are always the server-resolved values from the
// authenticated N3 session; request bodies never supply identity, role,
// status or timestamps. The single mutation path is the atomic RPC.
//
// Until the WP3B candidate migration is applied, follow-up reads degrade
// safely to "no follow-up row". That is NOT the same as "never ticked": the
// outcome derivation also reads completion.follow_up_required, so a ticked
// completion still derives as Follow-up Open — it simply has no durable
// evidence yet and therefore cannot be cleared. The candidate migration's
// additive materialisation creates exactly those missing rows on apply.


import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { deriveOutcome } from "./wp3b-followup";
import { FOLLOWUPS_TABLE, FOLLOWUP_CLEAR_RPC, wp3bSchema } from "./wp3b-db.server";

import type { CandidateFollowupClearResult } from "./wp3b-candidate-types";
import type { CompletionOutcome, FollowupRow } from "./wp3b-followup";

export interface FollowupActor {
  tenantCode: string;
  userId: string | null;
  name: string | null;
  isAdmin: boolean;
}

const FOLLOWUP_COLUMNS =
  "id, service_job_id, completion_cycle, state, opened_at, resolved_at, resolved_by_user_id, resolved_by_name_snapshot, resolution_note, reopened_at";

type RawFollowup = FollowupRow & { service_job_id: string };

/** Follow-up evidence for one Job's current completion cycle, or null. */
export async function loadFollowupForCycle(
  tenantCode: string,
  jobId: string,
  cycle: number,
): Promise<FollowupRow | null> {
  try {
    const { data, error } = await wp3bSchema
      .from(FOLLOWUPS_TABLE)
      .select<RawFollowup>(FOLLOWUP_COLUMNS)
      .eq("tenant_code", tenantCode)
      .eq("service_job_id", jobId)
      .eq("completion_cycle", cycle)
      .maybeSingle();
    if (error) return null; // candidate migration not applied yet
    return data ?? null;
  } catch {
    return null;
  }
}

/** Follow-up evidence for many Jobs, keyed by Job id (current cycle only). */
async function loadFollowupsForJobs(
  tenantCode: string,
  cycleByJob: Map<string, number>,
): Promise<Map<string, FollowupRow>> {
  const out = new Map<string, FollowupRow>();
  if (cycleByJob.size === 0) return out;
  try {
    const { data, error } = await wp3bSchema
      .from(FOLLOWUPS_TABLE)
      .select<RawFollowup>(FOLLOWUP_COLUMNS)
      .eq("tenant_code", tenantCode);
    if (error || !data) return out;
    for (const row of data) {
      if (cycleByJob.get(row.service_job_id) === row.completion_cycle) {
        out.set(row.service_job_id, row);
      }
    }
  } catch {
    /* candidate migration not applied yet */
  }
  return out;
}

export interface OutcomeJob {
  id: string;
  job_number: string | null;
  status: string;
  is_deleted: boolean;
  assigned_user_id: string | null;
  completed_at: string | null;
  completion_cycle: number;
  /** Actor who wrote the CURRENT cycle's completion evidence. */
  completed_by_user_id: string | null;
  /**
   * The actual resolution actor for this cycle: the completion actor when the
   * cycle resolved at completion, the clearing actor when it resolved after a
   * follow-up, and null while it is not resolved. Never the current assignee,
   * so reassignment after completion cannot move performance credit.
   */
  resolved_by_user_id: string | null;
  outcome: CompletionOutcome;
  followup: FollowupRow | null;
}


/**
 * The single central derivation of EVERY completed cycle for a tenant, used by
 * dashboard counts and by the Pending Queue lists so they can never disagree.
 */
export async function loadCompletionOutcomes(tenantCode: string): Promise<OutcomeJob[]> {
  const { data: jobs, error: jobsErr } = await supabaseAdmin
    .from("service_jobs")
    .select("id, job_number, status, is_deleted, assigned_user_id, completed_at, completion_cycle")
    .eq("tenant_code", tenantCode)
    .eq("is_deleted", false)
    .eq("status", "Completed");
  if (jobsErr) throw jobsErr;
  const rows = jobs ?? [];
  if (rows.length === 0) return [];

  const cycleByJob = new Map<string, number>();
  for (const j of rows) {
    cycleByJob.set(
      j.id,
      typeof j.completion_cycle === "number" && j.completion_cycle > 0 ? j.completion_cycle : 1,
    );
  }
  const ids = rows.map((j) => j.id);

  const [{ data: evidence, error: evErr }, { data: reopens, error: roErr }, followups] =
    await Promise.all([
      supabaseAdmin
        .from("service_job_completions")
        .select("service_job_id, completion_cycle, follow_up_required, completed_by_user_id")
        .eq("tenant_code", tenantCode)
        .in("service_job_id", ids),
      supabaseAdmin
        .from("service_job_reopen_requests")
        .select("service_job_id, status")
        .eq("tenant_code", tenantCode)
        .eq("status", "pending")
        .in("service_job_id", ids),
      loadFollowupsForJobs(tenantCode, cycleByJob),
    ]);
  if (evErr) throw evErr;
  if (roErr) throw roErr;

  const evidenceByJob = new Map<
    string,
    { follow_up_required: boolean; completed_by_user_id: string | null }
  >();
  for (const e of evidence ?? []) {
    const cycle =
      typeof e.completion_cycle === "number" && e.completion_cycle > 0 ? e.completion_cycle : 1;
    if (cycleByJob.get(e.service_job_id) === cycle) {
      evidenceByJob.set(e.service_job_id, {
        follow_up_required: e.follow_up_required === true,
        completed_by_user_id: e.completed_by_user_id ?? null,
      });
    }
  }
  const pendingReopen = new Set((reopens ?? []).map((r) => r.service_job_id));

  const out: OutcomeJob[] = [];
  for (const j of rows) {
    const cycle = cycleByJob.get(j.id) ?? 1;
    const followup = followups.get(j.id) ?? null;
    const completion = evidenceByJob.get(j.id) ?? null;
    const outcome = deriveOutcome({
      jobStatus: j.status,
      isDeleted: j.is_deleted === true,
      completion,
      followup,
      hasPendingReopen: pendingReopen.has(j.id),
    });
    if (!outcome) continue;
    // Performance credit follows the ACTUAL resolution actor, never the
    // current assignee: the completion actor when the cycle resolved at
    // completion, the clearing actor when it resolved after a follow-up.
    const resolvedBy =
      outcome === "resolved_at_completion"
        ? (completion?.completed_by_user_id ?? null)
        : outcome === "resolved_after_follow_up"
          ? (followup?.resolved_by_user_id ?? null)
          : null;
    out.push({
      id: j.id,
      job_number: j.job_number ?? null,
      status: j.status,
      is_deleted: j.is_deleted === true,
      assigned_user_id: j.assigned_user_id ?? null,
      completed_at: j.completed_at ?? null,
      completion_cycle: cycle,
      completed_by_user_id: completion?.completed_by_user_id ?? null,
      resolved_by_user_id: resolvedBy,
      outcome,
      followup,
    });
  }

  return out;
}

/**
 * The ONLY follow-up mutation path: one transaction that locks the Job,
 * rechecks tenant, authority, Completed state and the open follow-up, writes
 * the mandatory result note with a server timestamp and the audit event, and
 * is idempotent for an identical retry. Completion evidence is never touched.
 */
export async function clearFollowupAtomic(
  actor: FollowupActor,
  jobId: string,
  note: string,
): Promise<CandidateFollowupClearResult> {
  if (!actor.userId) {
    return { outcome: "error", status: 401, error: "Your user could not be resolved." };
  }
  const { data, error } = await wp3bSchema.rpc(FOLLOWUP_CLEAR_RPC, {
    p_tenant_code: actor.tenantCode,
    p_job_id: jobId,
    p_note: note,
    p_actor_user_id: actor.userId,
    p_actor_name: actor.name,
    p_is_admin: actor.isAdmin,
  });
  if (error) {
    return { outcome: "error", status: 409, error: error.message };
  }
  return (data ?? {
    outcome: "error",
    status: 409,
    error: "Clearing the follow-up failed.",
  }) as CandidateFollowupClearResult;
}
