-- WP3A — Job Operations Correction (CANDIDATE, NOT APPLIED)
--
-- Run ID: SH22-WP3A-BUILD
--
-- This file is a reviewed candidate only. It is deliberately NOT placed in
-- supabase/migrations/, because applying migrations was not authorised for
-- this run. To apply it, run this file verbatim through the migration tool;
-- the generated Supabase types will then regenerate and the narrow accessor
-- in src/lib/qne/service-jobs/wp3a-db.server.ts can be retired.
--
-- Scope (all additive except the deliberate uniqueness replacement in §2):
--   1. Waiting Customer / Waiting Vendor reference numbers on service_jobs.
--   2. Repeatable completion cycles on service_jobs + service_job_completions.
--   3. service_job_reopen_requests (one pending request per Job).
--   4. RPCs: sh_job_waiting_set, sh_job_reopen_request, sh_job_reopen_decide
--      and a cycle-aware replacement for sh_job_complete_simple.
--
-- Idempotent: every statement is guarded, so re-running is safe.
--
-- SAFE-FORWARD NOTES
--   * No completion evidence row is ever updated or deleted. Reopening a Job
--     advances a counter and the next completion writes a NEW evidence row.
--   * Existing evidence is backfilled to completion_cycle = 1 and existing
--     Jobs to completion_cycle = 1; a legacy Completed Job with no evidence
--     stays exactly as it is (JB26072201) and is never backfilled.
--
-- ROLLBACK NOTES (only needed if this candidate is applied and then reverted)
--   DROP FUNCTION IF EXISTS public.sh_job_reopen_decide(text, uuid, text, text, text, text, boolean);
--   DROP FUNCTION IF EXISTS public.sh_job_reopen_request(text, uuid, text, text, text);
--   DROP FUNCTION IF EXISTS public.sh_job_waiting_set(text, uuid, text, text, text, text);
--   DROP TABLE IF EXISTS public.service_job_reopen_requests;
--   DROP INDEX IF EXISTS public.service_job_completions_cycle_unique_idx;
--   CREATE UNIQUE INDEX service_job_completions_one_per_job_idx
--     ON public.service_job_completions (tenant_code, service_job_id);
--   ALTER TABLE public.service_job_completions DROP COLUMN IF EXISTS completion_cycle;
--   ALTER TABLE public.service_jobs
--     DROP COLUMN IF EXISTS completion_cycle,
--     DROP COLUMN IF EXISTS latest_customer_ref_no,
--     DROP COLUMN IF EXISTS latest_vendor_ref_no;
--   (restore sh_job_complete_simple from
--    docs/migrations/WP3_simple_atomic_completion.candidate.sql)

-- ---------------------------------------------------------------------------
-- 1. Latest waiting references (current-state values only; the full history
--    lives immutably in public.service_job_activity_log).
-- ---------------------------------------------------------------------------
ALTER TABLE public.service_jobs
  ADD COLUMN IF NOT EXISTS latest_customer_ref_no text,
  ADD COLUMN IF NOT EXISTS latest_vendor_ref_no text,
  ADD COLUMN IF NOT EXISTS completion_cycle integer NOT NULL DEFAULT 1;

UPDATE public.service_jobs SET completion_cycle = 1 WHERE completion_cycle IS NULL OR completion_cycle < 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_jobs_completion_cycle_chk') THEN
    ALTER TABLE public.service_jobs
      ADD CONSTRAINT service_jobs_completion_cycle_chk CHECK (completion_cycle >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_jobs_waiting_ref_len_chk') THEN
    ALTER TABLE public.service_jobs
      ADD CONSTRAINT service_jobs_waiting_ref_len_chk CHECK (
        (latest_customer_ref_no IS NULL
          OR (btrim(latest_customer_ref_no) <> '' AND length(latest_customer_ref_no) <= 200))
        AND (latest_vendor_ref_no IS NULL
          OR (btrim(latest_vendor_ref_no) <> '' AND length(latest_vendor_ref_no) <= 200))
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Repeatable completion cycles.
--    The old one-row-per-Job uniqueness is replaced by uniqueness per cycle so
--    a reopened Job can be completed again without touching prior evidence.
-- ---------------------------------------------------------------------------
ALTER TABLE public.service_job_completions
  ADD COLUMN IF NOT EXISTS completion_cycle integer NOT NULL DEFAULT 1;

UPDATE public.service_job_completions
  SET completion_cycle = 1
  WHERE completion_cycle IS NULL OR completion_cycle < 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_job_completions_cycle_chk') THEN
    ALTER TABLE public.service_job_completions
      ADD CONSTRAINT service_job_completions_cycle_chk CHECK (completion_cycle >= 1);
  END IF;
END
$$;

-- The replacement uniqueness is created BEFORE the old one-per-Job rules are
-- removed, so the table is never briefly unprotected.
CREATE UNIQUE INDEX IF NOT EXISTS service_job_completions_cycle_unique_idx
  ON public.service_job_completions (tenant_code, service_job_id, completion_cycle);

-- service_job_completion_unique is a UNIQUE CONSTRAINT, not a bare index: it
-- must be dropped through ALTER TABLE (DROP INDEX cannot remove it). The
-- primary key is deliberately untouched.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
      WHERE conname = 'service_job_completion_unique'
        AND conrelid = 'public.service_job_completions'::regclass
        AND contype = 'u'
  ) THEN
    ALTER TABLE public.service_job_completions
      DROP CONSTRAINT service_job_completion_unique;
  END IF;
END
$$;

-- The separate per-tenant index is a plain unique index and drops directly.
DROP INDEX IF EXISTS public.service_job_completions_one_per_job_idx;

-- ---------------------------------------------------------------------------
-- 3. Reopen requests. Tenant-scoped, server-only, at most one pending per Job.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_job_reopen_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  reason text NOT NULL,
  prior_status text NOT NULL,
  completion_cycle_at_request integer NOT NULL DEFAULT 1,
  requested_by_user_id text,
  requested_by_name_snapshot text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decision_note text,
  decided_by_user_id text,
  decided_by_name_snapshot text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_job_reopen_requests_status_chk
    CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT service_job_reopen_requests_reason_chk
    CHECK (btrim(reason) <> '' AND length(reason) <= 2000),
  CONSTRAINT service_job_reopen_requests_note_chk
    CHECK (decision_note IS NULL OR length(decision_note) <= 2000),
  CONSTRAINT service_job_reopen_requests_decided_chk
    CHECK (status = 'pending' OR decided_at IS NOT NULL)
);

-- At most one pending reopen request per Job.
CREATE UNIQUE INDEX IF NOT EXISTS service_job_reopen_requests_one_pending_idx
  ON public.service_job_reopen_requests (tenant_code, service_job_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS service_job_reopen_requests_job_idx
  ON public.service_job_reopen_requests (tenant_code, service_job_id, requested_at DESC);

-- Same server-only convention as completions/attendance: the Data API cannot
-- reach this table; every read and write goes through server code that
-- resolves tenant and actor from the authenticated N3 session.
ALTER TABLE public.service_job_reopen_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.service_job_reopen_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.service_job_reopen_requests TO service_role;

DROP TRIGGER IF EXISTS trg_service_job_reopen_requests_updated_at
  ON public.service_job_reopen_requests;
CREATE TRIGGER trg_service_job_reopen_requests_updated_at
  BEFORE UPDATE ON public.service_job_reopen_requests
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4a. Waiting Customer / Waiting Vendor with a mandatory reference number.
--     One transaction: exact status recheck under lock, status change, latest
--     reference update and immutable activity evidence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sh_job_waiting_set(
  p_tenant_code text,
  p_job_id uuid,
  p_party text,
  p_ref_no text,
  p_actor_user_id text,
  p_actor_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job    public.service_jobs%ROWTYPE;
  v_ref    text := nullif(btrim(coalesce(p_ref_no, '')), '');
  v_target text;
BEGIN
  IF p_tenant_code IS NULL OR btrim(p_tenant_code) = ''
     OR p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 401,
                              'error', 'Unresolved tenant or actor.');
  END IF;
  IF p_party NOT IN ('customer', 'vendor') THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 400, 'error', 'Unknown waiting party.');
  END IF;
  IF v_ref IS NULL THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 400,
                              'error', 'A reference number is required.');
  END IF;
  IF length(v_ref) > 200 THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 400,
                              'error', 'The reference number must be 200 characters or fewer.');
  END IF;

  v_target := CASE WHEN p_party = 'customer' THEN 'Waiting Customer' ELSE 'Waiting Vendor' END;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_code || ':waiting:' || p_job_id::text, 0));

  SELECT * INTO v_job FROM public.service_jobs
    WHERE tenant_code = p_tenant_code AND id = p_job_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 404, 'error', 'Job not found.');
  END IF;
  IF v_job.is_deleted THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
                              'error', 'Deleted jobs cannot be updated.');
  END IF;
  -- Exact status recheck under lock: the transition matrix only allows
  -- In Progress -> Waiting Customer / Waiting Vendor.
  IF v_job.status <> 'In Progress' THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'Only a Job that is In Progress can be moved to a waiting state.');
  END IF;

  UPDATE public.service_jobs SET
    status = v_target,
    latest_customer_ref_no =
      CASE WHEN p_party = 'customer' THEN v_ref ELSE latest_customer_ref_no END,
    latest_vendor_ref_no =
      CASE WHEN p_party = 'vendor' THEN v_ref ELSE latest_vendor_ref_no END
  WHERE tenant_code = p_tenant_code AND id = p_job_id AND status = 'In Progress';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'concurrent_waiting_change';
  END IF;

  INSERT INTO public.service_job_activity_log (
    tenant_code, service_job_id, event_type, old_value, new_value, note,
    metadata_json, performed_by_user_id, performed_by_name_snapshot
  ) VALUES (
    p_tenant_code, p_job_id, 'waiting_reference_set', v_job.status, v_target, v_ref,
    jsonb_build_object('party', p_party, 'ref_no', v_ref,
                       'prior_status', v_job.status, 'new_status', v_target),
    p_actor_user_id, p_actor_name
  );

  RETURN jsonb_build_object('outcome', 'ok', 'status_value', v_target,
                            'party', p_party, 'ref_no', v_ref);
EXCEPTION
  WHEN others THEN
    IF SQLERRM = 'concurrent_waiting_change' THEN
      RETURN jsonb_build_object('outcome', 'error', 'status', 409,
        'error', 'This Job changed status in another session. Reload and try again.');
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.sh_job_waiting_set(text, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sh_job_waiting_set(text, uuid, text, text, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4b. Reopen request (never reopens the Job by itself).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sh_job_reopen_request(
  p_tenant_code text,
  p_job_id uuid,
  p_reason text,
  p_actor_user_id text,
  p_actor_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job    public.service_jobs%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid;
BEGIN
  IF p_tenant_code IS NULL OR btrim(p_tenant_code) = ''
     OR p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 401,
                              'error', 'Unresolved tenant or actor.');
  END IF;
  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 400,
                              'error', 'A reopen reason is required.');
  END IF;
  IF length(v_reason) > 2000 THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 400,
                              'error', 'The reopen reason must be 2000 characters or fewer.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_code || ':reopen:' || p_job_id::text, 0));

  SELECT * INTO v_job FROM public.service_jobs
    WHERE tenant_code = p_tenant_code AND id = p_job_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 404, 'error', 'Job not found.');
  END IF;
  IF v_job.is_deleted THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
                              'error', 'Deleted jobs cannot be reopened.');
  END IF;
  IF v_job.status <> 'Completed' THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
                              'error', 'Only a Completed Job can be reopened.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.service_job_reopen_requests
      WHERE tenant_code = p_tenant_code AND service_job_id = p_job_id AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'A reopen request is already awaiting an Owner/Admin decision.');
  END IF;

  INSERT INTO public.service_job_reopen_requests (
    tenant_code, service_job_id, status, reason, prior_status,
    completion_cycle_at_request, requested_by_user_id, requested_by_name_snapshot
  ) VALUES (
    p_tenant_code, p_job_id, 'pending', v_reason, v_job.status,
    coalesce(v_job.completion_cycle, 1), p_actor_user_id, p_actor_name
  ) RETURNING id INTO v_id;

  INSERT INTO public.service_job_activity_log (
    tenant_code, service_job_id, event_type, old_value, new_value, note,
    metadata_json, performed_by_user_id, performed_by_name_snapshot
  ) VALUES (
    p_tenant_code, p_job_id, 'reopen_requested', v_job.status, v_job.status, v_reason,
    jsonb_build_object('request_id', v_id, 'completion_cycle', coalesce(v_job.completion_cycle, 1)),
    p_actor_user_id, p_actor_name
  );

  RETURN jsonb_build_object('outcome', 'ok', 'request_id', v_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'A reopen request is already awaiting an Owner/Admin decision.');
END;
$$;

REVOKE ALL ON FUNCTION public.sh_job_reopen_request(text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sh_job_reopen_request(text, uuid, text, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4c. Owner/Admin decision. Approve advances the completion cycle exactly once
--     and returns the Job to In Progress; prior completion evidence is never
--     updated or deleted. Reject leaves the Job Completed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sh_job_reopen_decide(
  p_tenant_code text,
  p_request_id uuid,
  p_decision text,
  p_note text,
  p_actor_user_id text,
  p_actor_name text,
  p_is_admin boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  -- Decision authority is rechecked here; a non-admin caller can never decide.
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

    -- Current-state fields only. Completion evidence rows stay immutable, and
    -- the Primary PIC / assignment fields are deliberately untouched.
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
$$;

REVOKE ALL ON FUNCTION public.sh_job_reopen_decide(text, uuid, text, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sh_job_reopen_decide(text, uuid, text, text, text, text, boolean)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4d. Cycle-aware completion. Same contract as WP3 (single transaction, lock,
--     authority recheck, open-attendance readiness, audit) with two additions:
--       * evidence is written for the Job's CURRENT completion cycle;
--       * the idempotent retry branch only matches evidence of that cycle.
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

  -- Idempotent retry within the current cycle: the same actor re-sending an
  -- identical successful request gets the same answer and one evidence row.
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

  -- Evidence for the current cycle without a Completed Job: fail closed.
  IF FOUND AND v_job.status <> 'Completed' THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'This Job has an inconsistent completion record. Contact an administrator.');
  END IF;

  IF v_job.is_deleted THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'Deleted jobs cannot be completed.');
  END IF;
  IF v_job.status = 'Completed' THEN
    -- Completed without evidence for this cycle = legacy completion; never
    -- backfilled and never invented.
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
$$;

REVOKE ALL ON FUNCTION public.sh_job_complete_simple(
  text, uuid, text, text, text, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sh_job_complete_simple(
  text, uuid, text, text, text, text, boolean, jsonb) TO service_role;
