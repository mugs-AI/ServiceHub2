-- WP3 — Simple Atomic Completion (ADDITIVE CANDIDATE, NOT APPLIED)
--
-- Run ID: SH22-WP3-BUILD
--
-- IMPORTANT — why this file lives here and not in supabase/migrations/:
-- this build was explicitly forbidden to execute a live migration, and the
-- platform only creates files under supabase/migrations/ by EXECUTING them.
-- The SQL below is therefore checked in as a reviewable candidate. To apply
-- it, run this file verbatim through the migration tool; generated Supabase
-- types will then regenerate and the narrow accessor in
-- src/lib/qne/service-jobs/wp3-db.server.ts can be retired.
--
-- Strictly additive:
--   * no DROP / RENAME of any existing object
--   * no change to the legacy Field Operations tables or to public.sh_field_mutate
--   * no change to WP2B attachments, WP2C attendance, cancellation or workflow
--   * no backfill: a historically Completed Job with no completion row stays
--     exactly as it is (JB26072201) and is reported as a legacy completion.

-- ---------------------------------------------------------------------------
-- 1. Server-owned actor / timestamp evidence on the existing completion table.
--    The legacy columns (checklist, diagnosis, acknowledgement, signature …)
--    are left untouched and are never written as evidence by WP3.
-- ---------------------------------------------------------------------------
ALTER TABLE public.service_job_completions
  ADD COLUMN IF NOT EXISTS completed_by_user_id text,
  ADD COLUMN IF NOT EXISTS completed_by_name_snapshot text,
  ADD COLUMN IF NOT EXISTS completed_by_code_snapshot text,
  ADD COLUMN IF NOT EXISTS completed_by_email_snapshot text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_kind text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_job_completions_kind_chk'
  ) THEN
    ALTER TABLE public.service_job_completions
      ADD CONSTRAINT service_job_completions_kind_chk
      CHECK (completion_kind IS NULL OR completion_kind IN ('simple', 'legacy'));
  END IF;

  -- A WP3 (simple) completion must carry real evidence: a trimmed, bounded
  -- resolution summary plus the actual actor and server timestamp.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_job_completions_simple_evidence_chk'
  ) THEN
    ALTER TABLE public.service_job_completions
      ADD CONSTRAINT service_job_completions_simple_evidence_chk
      CHECK (
        completion_kind IS DISTINCT FROM 'simple'
        OR (
          resolution_summary IS NOT NULL
          AND btrim(resolution_summary) <> ''
          AND length(resolution_summary) <= 4000
          AND completed_by_user_id IS NOT NULL
          AND btrim(completed_by_user_id) <> ''
          AND completed_at IS NOT NULL
        )
      );
  END IF;
END
$$;

-- Exactly one completion per Job per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS service_job_completions_one_per_job_idx
  ON public.service_job_completions (tenant_code, service_job_id);

CREATE INDEX IF NOT EXISTS service_job_completions_actor_idx
  ON public.service_job_completions (tenant_code, completed_by_user_id, completed_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Atomic completion.
--    ONE transaction: lock the Job row, recheck authority and readiness,
--    insert the single completion row, flip the Job to Completed with its
--    immutable snapshot, and write the audit event. Any failure rolls the
--    whole thing back — completion row, status, snapshot and audit can never
--    be stranded independently.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sh_job_complete_simple(
  p_tenant_code text,
  p_job_id uuid,
  p_actor_user_id text,
  p_actor_name text,
  p_actor_code text,
  p_actor_email text,
  p_is_admin boolean,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job        public.service_jobs%ROWTYPE;
  v_existing   public.service_job_completions%ROWTYPE;
  v_row        public.service_job_completions%ROWTYPE;
  v_now        timestamptz := now();
  v_summary    text := nullif(btrim(coalesce(p_payload->>'resolution_summary', '')), '');
  v_follow_up  boolean := coalesce((p_payload->>'follow_up_required')::boolean, false);
  v_open_gps   integer;
  v_snapshot   jsonb;
BEGIN
  -- Identity and payload are validated BEFORE any lock or write, so direct
  -- service-role misuse fails safely and creates no completion or audit row.
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

  -- Serialize completion attempts for this exact Job.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_code || ':complete:' || p_job_id::text, 0));

  SELECT * INTO v_job FROM public.service_jobs
    WHERE tenant_code = p_tenant_code AND id = p_job_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 404, 'error', 'Job not found.');
  END IF;

  SELECT * INTO v_existing FROM public.service_job_completions
    WHERE tenant_code = p_tenant_code AND service_job_id = p_job_id
    FOR UPDATE;

  -- Idempotent retry: the same actor re-sending an identical successful
  -- request gets the same answer, and still exactly one completion row.
  IF FOUND AND v_job.status = 'Completed' THEN
    IF v_existing.completion_kind = 'simple'
       AND v_existing.completed_by_user_id = p_actor_user_id
       AND btrim(coalesce(v_existing.resolution_summary, '')) = v_summary
       AND coalesce(v_existing.follow_up_required, false) = v_follow_up THEN
      RETURN jsonb_build_object('outcome', 'ok', 'idempotent', true,
        'completion_id', v_existing.id,
        'completed_at', coalesce(v_existing.completed_at, v_job.completed_at));
    END IF;
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'This Job is already completed.');
  END IF;

  -- Inconsistent pre-existing state: fail closed, never invent evidence and
  -- never silently rewrite an existing completion record.
  IF FOUND AND v_job.status <> 'Completed' THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'This Job has an inconsistent completion record. Contact an administrator.');
  END IF;

  IF v_job.is_deleted THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'Deleted jobs cannot be completed.');
  END IF;
  IF v_job.status = 'Completed' THEN
    -- Completed without a completion row = legacy completion; never backfilled.
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'This Job is already completed.');
  END IF;
  IF v_job.status IN ('Cancelled', 'Pending Approval') THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', v_job.status || ' jobs cannot be completed.');
  END IF;

  -- Authority is rechecked here from canonical Job data, never from the client.
  IF NOT coalesce(p_is_admin, false)
     AND coalesce(v_job.assigned_user_id, '') <> p_actor_user_id THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 403,
      'error', 'Only the assigned technician or an administrator can complete this Job.');
  END IF;

  -- Readiness: no on-site attendance may still be open for this Job.
  SELECT count(*) INTO v_open_gps FROM public.service_job_onsite_attendance
    WHERE tenant_code = p_tenant_code AND service_job_id = p_job_id
      AND clock_out_at IS NULL;
  IF v_open_gps > 0 THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'Clock out of on-site attendance before completing this Job.');
  END IF;

  INSERT INTO public.service_job_completions (
    tenant_code, service_job_id,
    resolution_summary, follow_up_required,
    completion_kind, completed_by_user_id, completed_by_name_snapshot,
    completed_by_code_snapshot, completed_by_email_snapshot, completed_at,
    -- Legacy mandatory columns receive safe neutral values only; they are
    -- never presented to users as completion evidence.
    checklist, ack_confirmed, signature_waived, is_final
  ) VALUES (
    p_tenant_code, p_job_id,
    v_summary, v_follow_up,
    'simple', p_actor_user_id, p_actor_name,
    p_actor_code, p_actor_email, v_now,
    '[]'::jsonb, false, false, true
  ) RETURNING * INTO v_row;

  v_snapshot := jsonb_build_object(
    'version', 2,
    'kind', 'simple',
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
    -- Lost a race after the lock: roll everything back rather than leaving a
    -- completion row without a Completed Job.
    RAISE EXCEPTION 'concurrent_completion';
  END IF;

  INSERT INTO public.service_job_activity_log (
    tenant_code, service_job_id, event_type, old_value, new_value, note,
    metadata_json, performed_by_user_id, performed_by_name_snapshot
  ) VALUES (
    p_tenant_code, p_job_id, 'job_completed', v_job.status, 'Completed', v_summary,
    jsonb_build_object('completion_id', v_row.id, 'follow_up_required', v_follow_up,
                       'kind', 'simple'),
    p_actor_user_id, p_actor_name
  );

  RETURN jsonb_build_object('outcome', 'ok', 'idempotent', false,
                            'completion_id', v_row.id, 'completed_at', v_now);
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
$$;

REVOKE ALL ON FUNCTION public.sh_job_complete_simple(
  text, uuid, text, text, text, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sh_job_complete_simple(
  text, uuid, text, text, text, text, boolean, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Access conventions, unchanged from the existing server-only pattern:
--    the Data API cannot reach the completion table; every read/write goes
--    through server code that resolves tenant + actor from the N3 session.
-- ---------------------------------------------------------------------------
ALTER TABLE public.service_job_completions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.service_job_completions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.service_job_completions TO service_role;
