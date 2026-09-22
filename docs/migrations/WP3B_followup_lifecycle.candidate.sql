-- ============================================================================
-- WP3B — Follow-up Open / Clear / Reopen lifecycle  (CANDIDATE — NOT APPLIED)
-- ============================================================================
--
-- Status: reviewable candidate only. This file has NOT been executed against
-- any database. Application requires a separate written authorisation.
--
-- Owner-accepted accounting contract, per CURRENT completion cycle:
--   Completed total = Resolved + Follow-up Open + Reopen Pending
--     * completion evidence with follow_up_required = false -> resolved_at_completion
--     * completion evidence with follow_up_required = true, follow-up open
--                                                          -> follow_up_open
--     * follow-up cleared                                  -> resolved_after_follow_up
--     * pending reopen request                             -> reopen_pending
--     * Completed with no modern evidence for the cycle    -> legacy_unknown
--
-- Design rules honoured here:
--   * Forward-only and additive. No destructive backfill, no data rewrite.
--   * public.service_job_completions rows stay IMMUTABLE. Nothing in this file
--     updates or deletes completion evidence, its resolution summary, its
--     follow_up_required value, its actor or its timestamps.
--   * A follow-up row exists ONLY for a cycle whose completion evidence had
--     follow_up_required = true. A no-tick completion never gets a fake row.
--   * Every mutation stays inside one SECURITY DEFINER transaction that locks
--     the Job row and rechecks tenant, actor, authority and state.
--   * RLS on, browser roles revoked, service_role only — matching WP2C/WP3/WP3A.
--
-- Safe-forward notes:
--   * Re-runnable: every object is created with IF NOT EXISTS / OR REPLACE.
--   * Applying it to a database that already has WP3A completion cycles needs
--     no backfill: cycles completed before WP3B simply have no follow-up row,
--     and the projection derives their outcome from the evidence alone.
-- Rollback notes:
--   * DROP FUNCTION public.sh_followup_clear(text, uuid, text, text, text, boolean);
--   * DROP VIEW public.service_job_completion_outcomes;
--   * DROP TABLE public.service_job_followups;  -- only discards WP3B evidence
--   * Restore the previous bodies of sh_job_complete_simple / sh_job_reopen_decide
--     from migration 20260920111137_* and the applied WP3A migration. Both
--     replacements below are behaviour-compatible supersets of those bodies.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Durable follow-up evidence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_job_followups (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code               text NOT NULL,
  service_job_id            uuid NOT NULL
                              REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  completion_id             uuid NOT NULL
                              REFERENCES public.service_job_completions(id) ON DELETE RESTRICT,
  completion_cycle          integer NOT NULL,
  state                     text NOT NULL DEFAULT 'open',
  opened_at                 timestamptz NOT NULL DEFAULT now(),
  opened_by_user_id         text,
  opened_by_name_snapshot   text,
  resolved_at               timestamptz,
  resolved_by_user_id       text,
  resolved_by_name_snapshot text,
  resolution_note           text,
  reopened_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT service_job_followups_state_chk
    CHECK (state IN ('open', 'resolved', 'reopened')),
  CONSTRAINT service_job_followups_cycle_chk
    CHECK (completion_cycle >= 1),
  -- Clearing REQUIRES a trimmed, bounded result note plus actor and timestamp.
  CONSTRAINT service_job_followups_resolved_chk
    CHECK (
      state <> 'resolved'
      OR (
        resolved_at IS NOT NULL
        AND resolved_by_user_id IS NOT NULL
        AND resolution_note IS NOT NULL
        AND btrim(resolution_note) <> ''
        AND length(resolution_note) <= 2000
      )
    ),
  CONSTRAINT service_job_followups_reopened_chk
    CHECK (state <> 'reopened' OR reopened_at IS NOT NULL)
);

-- One follow-up per tenant + Job + completion cycle.
CREATE UNIQUE INDEX IF NOT EXISTS service_job_followups_one_per_cycle_idx
  ON public.service_job_followups (tenant_code, service_job_id, completion_cycle);

CREATE INDEX IF NOT EXISTS service_job_followups_tenant_state_idx
  ON public.service_job_followups (tenant_code, state, opened_at DESC);

CREATE INDEX IF NOT EXISTS service_job_followups_resolved_idx
  ON public.service_job_followups (tenant_code, resolved_at DESC)
  WHERE state = 'resolved';

CREATE INDEX IF NOT EXISTS service_job_followups_completion_idx
  ON public.service_job_followups (completion_id);

DROP TRIGGER IF EXISTS set_service_job_followups_updated_at ON public.service_job_followups;
CREATE TRIGGER set_service_job_followups_updated_at
  BEFORE UPDATE ON public.service_job_followups
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

-- Server-authoritative access only: no browser role may read or write.
ALTER TABLE public.service_job_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_job_followups FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_job_followups FROM PUBLIC;
REVOKE ALL ON public.service_job_followups FROM anon;
REVOKE ALL ON public.service_job_followups FROM authenticated;
GRANT ALL ON public.service_job_followups TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Central outcome projection — every completed cycle, derived not stored
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.service_job_completion_outcomes AS
SELECT
  j.tenant_code,
  j.id                                   AS service_job_id,
  j.job_number,
  j.status                               AS job_status,
  j.assigned_user_id,
  coalesce(j.completion_cycle, 1)        AS completion_cycle,
  c.id                                   AS completion_id,
  c.follow_up_required,
  c.completed_by_user_id,
  c.completed_at,
  f.id                                   AS followup_id,
  f.state                                AS followup_state,
  f.resolved_at,
  f.resolved_by_user_id,
  (r.id IS NOT NULL)                     AS has_pending_reopen,
  CASE
    WHEN c.id IS NULL                       THEN 'legacy_unknown'
    WHEN r.id IS NOT NULL                   THEN 'reopen_pending'
    WHEN coalesce(c.follow_up_required, false) = false
                                            THEN 'resolved_at_completion'
    WHEN f.state = 'resolved'               THEN 'resolved_after_follow_up'
    WHEN f.state = 'reopened'               THEN 'reopen_pending'
    ELSE 'follow_up_open'
  END                                    AS outcome
FROM public.service_jobs j
LEFT JOIN public.service_job_completions c
  ON  c.tenant_code = j.tenant_code
  AND c.service_job_id = j.id
  AND coalesce(c.completion_cycle, 1) = coalesce(j.completion_cycle, 1)
LEFT JOIN public.service_job_followups f
  ON  f.tenant_code = j.tenant_code
  AND f.service_job_id = j.id
  AND f.completion_cycle = coalesce(j.completion_cycle, 1)
LEFT JOIN public.service_job_reopen_requests r
  ON  r.tenant_code = j.tenant_code
  AND r.service_job_id = j.id
  AND r.status = 'pending'
WHERE j.is_deleted = false
  AND j.status = 'Completed';

REVOKE ALL ON public.service_job_completion_outcomes FROM PUBLIC;
REVOKE ALL ON public.service_job_completion_outcomes FROM anon;
REVOKE ALL ON public.service_job_completion_outcomes FROM authenticated;
GRANT SELECT ON public.service_job_completion_outcomes TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Completion transaction also opens the follow-up (same transaction)
--    Superset of the applied body: identical except the follow-up INSERT.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sh_job_complete_simple(
  p_tenant_code text, p_job_id uuid, p_actor_user_id text, p_actor_name text,
  p_actor_code text, p_actor_email text, p_is_admin boolean,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_job        public.service_jobs%ROWTYPE;
  v_existing   public.service_job_completions%ROWTYPE;
  v_row        public.service_job_completions%ROWTYPE;
  v_now        timestamptz := now();
  v_summary    text := nullif(btrim(coalesce(p_payload->>'resolution_summary', '')), '');
  v_follow_up  boolean := coalesce((p_payload->>'follow_up_required')::boolean, false);
  v_open_gps   integer;
  v_cycle      integer;
  v_snapshot   jsonb;
BEGIN
  IF p_tenant_code IS NULL OR btrim(p_tenant_code) = ''
     OR p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 401,
                              'error', 'Unresolved tenant or actor.');
  END IF;

  IF v_summary IS NULL THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 400,
                              'error', 'A resolution summary is required.');
  END IF;
  IF length(v_summary) > 4000 THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 400,
      'error', 'The resolution summary must be 4000 characters or fewer.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_code || ':complete:' || p_job_id::text, 0));

  SELECT * INTO v_job FROM public.service_jobs
    WHERE tenant_code = p_tenant_code AND id = p_job_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 404, 'error', 'Job not found.');
  END IF;

  v_cycle := coalesce(v_job.completion_cycle, 1);

  SELECT * INTO v_existing FROM public.service_job_completions
    WHERE tenant_code = p_tenant_code AND service_job_id = p_job_id
      AND coalesce(completion_cycle, 1) = v_cycle
    FOR UPDATE;

  -- Idempotent retry within the current cycle.
  IF FOUND AND v_job.status = 'Completed' THEN
    IF v_existing.completion_kind = 'simple'
       AND v_existing.completed_by_user_id = p_actor_user_id
       AND btrim(coalesce(v_existing.resolution_summary, '')) = v_summary
       AND coalesce(v_existing.follow_up_required, false) = v_follow_up THEN
      RETURN jsonb_build_object('outcome', 'ok', 'idempotent', true,
        'completion_id', v_existing.id,
        'completion_cycle', v_cycle,
        'completed_at', coalesce(v_existing.completed_at, v_job.completed_at));
    END IF;
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'This Job is already completed.');
  END IF;

  IF FOUND AND v_job.status <> 'Completed' THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'This Job has an inconsistent completion record. Contact an administrator.');
  END IF;

  IF v_job.is_deleted THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'Deleted jobs cannot be completed.');
  END IF;
  IF v_job.status = 'Completed' THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'This Job is already completed.');
  END IF;
  IF v_job.status IN ('Cancelled', 'Pending Approval') THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', v_job.status || ' jobs cannot be completed.');
  END IF;

  IF NOT coalesce(p_is_admin, false)
     AND coalesce(v_job.assigned_user_id, '') <> p_actor_user_id THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 403,
      'error', 'Only the assigned technician or an administrator can complete this Job.');
  END IF;

  SELECT count(*) INTO v_open_gps FROM public.service_job_onsite_attendance
    WHERE tenant_code = p_tenant_code AND service_job_id = p_job_id
      AND clock_out_at IS NULL;
  IF v_open_gps > 0 THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'Clock out of on-site attendance before completing this Job.');
  END IF;

  INSERT INTO public.service_job_completions (
    tenant_code, service_job_id, completion_cycle,
    resolution_summary, follow_up_required,
    completion_kind, completed_by_user_id, completed_by_name_snapshot,
    completed_by_code_snapshot, completed_by_email_snapshot, completed_at,
    checklist, ack_confirmed, signature_waived, is_final
  ) VALUES (
    p_tenant_code, p_job_id, v_cycle,
    v_summary, v_follow_up,
    'simple', p_actor_user_id, p_actor_name,
    p_actor_code, p_actor_email, v_now,
    '[]'::jsonb, false, false, true
  ) RETURNING * INTO v_row;

  -- WP3B — a ticked follow-up opens durable follow-up evidence in the SAME
  -- transaction. A no-tick completion creates no row at all.
  IF v_follow_up THEN
    INSERT INTO public.service_job_followups (
      tenant_code, service_job_id, completion_id, completion_cycle,
      state, opened_at, opened_by_user_id, opened_by_name_snapshot
    ) VALUES (
      p_tenant_code, p_job_id, v_row.id, v_cycle,
      'open', v_now, p_actor_user_id, p_actor_name
    )
    ON CONFLICT (tenant_code, service_job_id, completion_cycle) DO NOTHING;
  END IF;

  v_snapshot := jsonb_build_object(
    'version', 3,
    'kind', 'simple',
    'completion_cycle', v_cycle,
    'job', jsonb_build_object('id', v_job.id, 'job_number', v_job.job_number,
                              'customer_code', v_job.customer_code_snapshot),
    'resolution_summary', v_summary,
    'follow_up_required', v_follow_up,
    'completed_by_user_id', p_actor_user_id,
    'completed_by_name_snapshot', p_actor_name,
    'completed_at', v_now,
    'completion_id', v_row.id
  );

  UPDATE public.service_jobs SET
    status = 'Completed',
    completed_at = v_now,
    completion_snapshot = v_snapshot
  WHERE tenant_code = p_tenant_code AND id = p_job_id AND status <> 'Completed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'concurrent_completion';
  END IF;

  INSERT INTO public.service_job_activity_log (
    tenant_code, service_job_id, event_type, old_value, new_value, note,
    metadata_json, performed_by_user_id, performed_by_name_snapshot
  ) VALUES (
    p_tenant_code, p_job_id, 'job_completed', v_job.status, 'Completed', v_summary,
    jsonb_build_object('completion_id', v_row.id, 'follow_up_required', v_follow_up,
                       'kind', 'simple', 'completion_cycle', v_cycle),
    p_actor_user_id, p_actor_name
  );

  RETURN jsonb_build_object('outcome', 'ok', 'idempotent', false,
                            'completion_id', v_row.id, 'completion_cycle', v_cycle,
                            'completed_at', v_now);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'This Job is already completed.');
  WHEN others THEN
    IF SQLERRM = 'concurrent_completion' THEN
      RETURN jsonb_build_object('outcome', 'error', 'status', 409,
        'error', 'This Job is already completed.');
    END IF;
    RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.sh_job_complete_simple(text, uuid, text, text, text, text, boolean, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sh_job_complete_simple(text, uuid, text, text, text, text, boolean, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.sh_job_complete_simple(text, uuid, text, text, text, text, boolean, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sh_job_complete_simple(text, uuid, text, text, text, text, boolean, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Atomic clear-follow-up
--    The Job stays Completed. Completion evidence is never touched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sh_followup_clear(
  p_tenant_code text, p_job_id uuid, p_note text,
  p_actor_user_id text, p_actor_name text, p_is_admin boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_job   public.service_jobs%ROWTYPE;
  v_fu    public.service_job_followups%ROWTYPE;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_now   timestamptz := now();
  v_cycle integer;
BEGIN
  IF p_tenant_code IS NULL OR btrim(p_tenant_code) = ''
     OR p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 401,
                              'error', 'Unresolved tenant or actor.');
  END IF;
  IF v_note IS NULL THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 400,
                              'error', 'A follow-up result is required.');
  END IF;
  IF length(v_note) > 2000 THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 400,
      'error', 'The follow-up result must be 2000 characters or fewer.');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_tenant_code || ':followup:' || p_job_id::text, 0));

  SELECT * INTO v_job FROM public.service_jobs
    WHERE tenant_code = p_tenant_code AND id = p_job_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 404, 'error', 'Job not found.');
  END IF;
  IF v_job.is_deleted OR v_job.status <> 'Completed' THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'Only a Completed Job can have its follow-up cleared.');
  END IF;

  -- Authority is rechecked here; the browser never supplies role or actor.
  IF NOT coalesce(p_is_admin, false)
     AND coalesce(v_job.assigned_user_id, '') <> p_actor_user_id THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 403,
      'error', 'Only the assigned technician or an administrator can clear this follow-up.');
  END IF;

  v_cycle := coalesce(v_job.completion_cycle, 1);

  SELECT * INTO v_fu FROM public.service_job_followups
    WHERE tenant_code = p_tenant_code AND service_job_id = p_job_id
      AND completion_cycle = v_cycle
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'This Job has no open follow-up for its current completion cycle.');
  END IF;

  -- Idempotent retry: an identical re-send after a lost response returns the
  -- same answer and writes no second audit row.
  IF v_fu.state = 'resolved' THEN
    IF coalesce(v_fu.resolved_by_user_id, '') = p_actor_user_id
       AND btrim(coalesce(v_fu.resolution_note, '')) = v_note THEN
      RETURN jsonb_build_object('outcome', 'ok', 'idempotent', true,
        'followup_id', v_fu.id, 'completion_cycle', v_cycle,
        'resolved_at', v_fu.resolved_at);
    END IF;
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'This follow-up has already been cleared.');
  END IF;
  IF v_fu.state <> 'open' THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'This follow-up is no longer open.');
  END IF;

  UPDATE public.service_job_followups SET
    state = 'resolved',
    resolved_at = v_now,
    resolved_by_user_id = p_actor_user_id,
    resolved_by_name_snapshot = p_actor_name,
    resolution_note = v_note
  WHERE id = v_fu.id AND tenant_code = p_tenant_code AND state = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'concurrent_followup';
  END IF;

  INSERT INTO public.service_job_activity_log (
    tenant_code, service_job_id, event_type, old_value, new_value, note,
    metadata_json, performed_by_user_id, performed_by_name_snapshot
  ) VALUES (
    p_tenant_code, p_job_id, 'followup_cleared', 'follow_up_open',
    'resolved_after_follow_up', v_note,
    jsonb_build_object('followup_id', v_fu.id, 'completion_cycle', v_cycle,
                       'completion_id', v_fu.completion_id),
    p_actor_user_id, p_actor_name
  );

  RETURN jsonb_build_object('outcome', 'ok', 'idempotent', false,
                            'followup_id', v_fu.id, 'completion_cycle', v_cycle,
                            'resolved_at', v_now);
EXCEPTION
  WHEN others THEN
    IF SQLERRM = 'concurrent_followup' THEN
      RETURN jsonb_build_object('outcome', 'error', 'status', 409,
        'error', 'This follow-up has already been cleared.');
    END IF;
    RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.sh_followup_clear(text, uuid, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sh_followup_clear(text, uuid, text, text, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.sh_followup_clear(text, uuid, text, text, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sh_followup_clear(text, uuid, text, text, text, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Approved reopen marks the cycle's open follow-up as reopened
--    Superset of the applied WP3A body: identical except the follow-up UPDATE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sh_job_reopen_decide(
  p_tenant_code text, p_request_id uuid, p_decision text, p_note text,
  p_actor_user_id text, p_actor_name text, p_is_admin boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_req  public.service_job_reopen_requests%ROWTYPE;
  v_job  public.service_jobs%ROWTYPE;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_now  timestamptz := now();
BEGIN
  IF p_tenant_code IS NULL OR btrim(p_tenant_code) = ''
     OR p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 401,
                              'error', 'Unresolved tenant or actor.');
  END IF;
  IF NOT coalesce(p_is_admin, false) THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 403,
      'error', 'Only an Owner or Administrator can decide a reopen request.');
  END IF;
  IF p_decision NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 400, 'error', 'Invalid decision.');
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 400,
                              'error', 'The decision note must be 2000 characters or fewer.');
  END IF;

  SELECT * INTO v_req FROM public.service_job_reopen_requests
    WHERE tenant_code = p_tenant_code AND id = p_request_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 404,
                              'error', 'Reopen request not found.');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'This reopen request has already been decided.');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_tenant_code || ':reopen:' || v_req.service_job_id::text, 0));

  SELECT * INTO v_job FROM public.service_jobs
    WHERE tenant_code = p_tenant_code AND id = v_req.service_job_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 404, 'error', 'Job not found.');
  END IF;

  IF p_decision = 'approve' THEN
    IF v_job.is_deleted OR v_job.status <> 'Completed' THEN
      RETURN jsonb_build_object('outcome', 'error', 'status', 409,
        'error', 'This Job is no longer in a reopenable state.');
    END IF;

    -- WP3B — an approved reopen closes out the cycle's OPEN follow-up as
    -- 'reopened' in the same transaction. A cleared follow-up keeps its
    -- resolved evidence; nothing is ever deleted or rewritten.
    UPDATE public.service_job_followups SET
      state = 'reopened',
      reopened_at = v_now
    WHERE tenant_code = p_tenant_code
      AND service_job_id = v_job.id
      AND completion_cycle = coalesce(v_job.completion_cycle, 1)
      AND state = 'open';

    UPDATE public.service_jobs SET
      status = 'In Progress',
      completed_at = NULL,
      completion_snapshot = NULL,
      completion_cycle = coalesce(completion_cycle, 1) + 1
    WHERE tenant_code = p_tenant_code AND id = v_job.id AND status = 'Completed';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'concurrent_reopen';
    END IF;
  END IF;

  UPDATE public.service_job_reopen_requests SET
    status = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
    decision_note = v_note,
    decided_by_user_id = p_actor_user_id,
    decided_by_name_snapshot = p_actor_name,
    decided_at = v_now
  WHERE id = v_req.id AND tenant_code = p_tenant_code AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'concurrent_reopen';
  END IF;

  INSERT INTO public.service_job_activity_log (
    tenant_code, service_job_id, event_type, old_value, new_value, note,
    metadata_json, performed_by_user_id, performed_by_name_snapshot
  ) VALUES (
    p_tenant_code, v_job.id,
    CASE WHEN p_decision = 'approve' THEN 'reopen_approved' ELSE 'reopen_rejected' END,
    v_job.status,
    CASE WHEN p_decision = 'approve' THEN 'In Progress' ELSE v_job.status END,
    v_note,
    jsonb_build_object('request_id', v_req.id,
                       'completion_cycle',
                       CASE WHEN p_decision = 'approve'
                            THEN coalesce(v_job.completion_cycle, 1) + 1
                            ELSE coalesce(v_job.completion_cycle, 1) END),
    p_actor_user_id, p_actor_name
  );

  RETURN jsonb_build_object('outcome', 'ok', 'decision', p_decision,
                            'request_id', v_req.id);
EXCEPTION
  WHEN others THEN
    IF SQLERRM = 'concurrent_reopen' THEN
      RETURN jsonb_build_object('outcome', 'error', 'status', 409,
        'error', 'This reopen request has already been decided.');
    END IF;
    RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.sh_job_reopen_decide(text, uuid, text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sh_job_reopen_decide(text, uuid, text, text, text, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.sh_job_reopen_decide(text, uuid, text, text, text, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sh_job_reopen_decide(text, uuid, text, text, text, text, boolean) TO service_role;

COMMIT;
