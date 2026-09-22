// WP3B — candidate (PROPOSED, UNAPPLIED) schema shapes.
//
// docs/migrations/WP3B_followup_lifecycle.candidate.sql has NOT been applied.
// The canonical generated Supabase types must be regenerated only after an
// authorised migration application; they are never hand-edited to describe
// unapplied schema. Until then, the narrow WP3B accessor reaches the proposed
// objects through the shapes declared here.

import type { FollowupState } from "./wp3b-followup";

/** public.service_job_followups (candidate). */
export interface CandidateFollowupRow {
  id: string;
  tenant_code: string;
  service_job_id: string;
  completion_id: string;
  completion_cycle: number;
  state: FollowupState;
  opened_at: string | null;
  opened_by_user_id: string | null;
  opened_by_name_snapshot: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolved_by_name_snapshot: string | null;
  resolution_note: string | null;
  reopened_at: string | null;
}

/** public.service_job_completion_outcomes (candidate projection). */
export interface CandidateOutcomeRow {
  tenant_code: string;
  service_job_id: string;
  job_number: string | null;
  job_status: string;
  assigned_user_id: string | null;
  completion_cycle: number;
  completion_id: string | null;
  follow_up_required: boolean | null;
  completed_by_user_id: string | null;
  completed_at: string | null;
  followup_state: FollowupState | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  has_pending_reopen: boolean;
  outcome: string;
}

/** public.sh_followup_clear (candidate) result. */
export interface CandidateFollowupClearResult {
  outcome: "ok" | "error";
  status?: number;
  error?: string;
  idempotent?: boolean;
  followup_id?: string;
  completion_cycle?: number;
  resolved_at?: string;
}
