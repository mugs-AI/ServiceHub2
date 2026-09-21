// WP3A — Pending Queue categories added after the job-operations correction.
//
// Pure rules only: the queue keys used in URLs (so dashboard deep links stay
// stable) and the current-cycle follow-up match. Every query that uses them
// still derives tenant and actor from the authenticated session.

export const QUEUE_REOPEN_REQUESTS = "reopen_requests";
export const QUEUE_COMPLETED_FOLLOWUP = "completed_followup";
export const QUEUE_COMPLETED = "completed";

export const WP3A_QUEUE_KEYS = [
  QUEUE_REOPEN_REQUESTS,
  QUEUE_COMPLETED_FOLLOWUP,
  QUEUE_COMPLETED,
] as const;

export type Wp3aQueueKey = (typeof WP3A_QUEUE_KEYS)[number];

export interface CompletedJobCycle {
  id: string;
  /** Current completion cycle on the Job row (1 for pre-WP3A rows). */
  completion_cycle?: number | null;
}

export interface CompletionCycleEvidence {
  service_job_id: string;
  completion_cycle?: number | null;
  follow_up_required?: boolean | null;
}

/** A Job row without an explicit cycle is cycle 1. */
export function currentCycle(job: CompletedJobCycle): number {
  const n = job.completion_cycle;
  return typeof n === "number" && n > 0 ? n : 1;
}

/**
 * Jobs whose CURRENT completion cycle carries follow_up_required = true.
 * Evidence from an earlier cycle can never leak into a later cycle.
 */
export function followUpJobIds(
  jobs: CompletedJobCycle[],
  evidence: CompletionCycleEvidence[],
): Set<string> {
  const cycleByJob = new Map<string, number>();
  for (const j of jobs) cycleByJob.set(j.id, currentCycle(j));

  const out = new Set<string>();
  for (const e of evidence) {
    if (e.follow_up_required !== true) continue;
    const want = cycleByJob.get(e.service_job_id);
    if (want === undefined) continue;
    const got =
      typeof e.completion_cycle === "number" && e.completion_cycle > 0 ? e.completion_cycle : 1;
    if (got === want) out.add(e.service_job_id);
  }
  return out;
}

/** Only a pending reopen request belongs in the Reopen Requests queue. */
export function isPendingReopen(row: { status?: string | null }): boolean {
  return row.status === "pending";
}
