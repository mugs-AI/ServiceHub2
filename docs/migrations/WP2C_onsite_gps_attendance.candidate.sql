-- WP2C — On-Site GPS Attendance (ADDITIVE CANDIDATE, NOT APPLIED)
--
-- Run ID: SH22-WP2C-BUILD
--
-- IMPORTANT — why this file lives here and not in supabase/migrations/:
-- this build was explicitly forbidden to execute a live migration, and the
-- platform only creates files under supabase/migrations/ by EXECUTING them.
-- The SQL below is therefore checked in as a reviewable candidate. To apply
-- it, run this file verbatim through the migration tool; generated Supabase
-- types will then regenerate and the narrow accessor in
-- src/lib/qne/service-jobs/wp2c-db.server.ts can be retired.
--
-- Strictly additive:
--   * no DROP / RENAME of any existing object
--   * no change to the legacy Field Operations tables
--     (service_job_work_sessions, service_job_waiting_periods,
--      service_job_work_notes) or to public.sh_field_mutate
--   * no backfill: legacy Travel / Arrival / Leave / Work Session rows are
--     never read, rewritten, deleted or converted into attendance rows.

-- ---------------------------------------------------------------------------
-- 1. On-site attendance visits.
--    Server-only: no anon/authenticated policy exists, so the Data API cannot
--    reach the table at all. Every read/write goes through server code that
--    resolves tenant + actor from the authenticated N3 session.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_job_onsite_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  job_number_snapshot text,

  -- Actual authenticated actor. Never accepted from the request body.
  actor_user_id text NOT NULL,
  actor_name_snapshot text,
  actor_code_snapshot text,
  actor_email_snapshot text,
  support_mode_snapshot text,

  -- Server timestamps are authoritative for both events.
  clock_in_at timestamptz NOT NULL DEFAULT now(),
  clock_out_at timestamptz,
  duration_minutes integer,

  clock_in_latitude double precision,
  clock_in_longitude double precision,
  clock_in_accuracy_m double precision,
  clock_in_gps_result text NOT NULL DEFAULT 'ok',
  clock_in_exception_reason text,

  clock_out_latitude double precision,
  clock_out_longitude double precision,
  clock_out_accuracy_m double precision,
  clock_out_gps_result text,
  clock_out_exception_reason text,

  -- Set when either event failed to capture a location; WP5 reporting flag.
  has_gps_exception boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Defence in depth: the same rules the server enforces, restated in the
  -- database so even direct service-role misuse cannot store junk evidence.
  CONSTRAINT service_job_onsite_attendance_in_result_chk CHECK (
    clock_in_gps_result IN ('ok','low_accuracy','permission_denied','timeout',
                            'unavailable','unsupported')),
  CONSTRAINT service_job_onsite_attendance_out_result_chk CHECK (
    clock_out_gps_result IS NULL OR clock_out_gps_result IN
      ('ok','low_accuracy','permission_denied','timeout','unavailable','unsupported')),
  CONSTRAINT service_job_onsite_attendance_in_lat_chk CHECK (
    clock_in_latitude IS NULL OR (clock_in_latitude >= -90 AND clock_in_latitude <= 90)),
  CONSTRAINT service_job_onsite_attendance_in_lng_chk CHECK (
    clock_in_longitude IS NULL OR (clock_in_longitude >= -180 AND clock_in_longitude <= 180)),
  CONSTRAINT service_job_onsite_attendance_out_lat_chk CHECK (
    clock_out_latitude IS NULL OR (clock_out_latitude >= -90 AND clock_out_latitude <= 90)),
  CONSTRAINT service_job_onsite_attendance_out_lng_chk CHECK (
    clock_out_longitude IS NULL OR (clock_out_longitude >= -180 AND clock_out_longitude <= 180)),
  CONSTRAINT service_job_onsite_attendance_in_acc_chk CHECK (
    clock_in_accuracy_m IS NULL OR clock_in_accuracy_m >= 0),
  CONSTRAINT service_job_onsite_attendance_out_acc_chk CHECK (
    clock_out_accuracy_m IS NULL OR clock_out_accuracy_m >= 0),
  -- Coordinates are always stored as a pair.
  CONSTRAINT service_job_onsite_attendance_in_pair_chk CHECK (
    (clock_in_latitude IS NULL) = (clock_in_longitude IS NULL)),
  CONSTRAINT service_job_onsite_attendance_out_pair_chk CHECK (
    (clock_out_latitude IS NULL) = (clock_out_longitude IS NULL)),
  -- A success result means a real captured position with accuracy evidence;
  -- a failure result means no coordinates at all.
  CONSTRAINT service_job_onsite_attendance_in_capture_chk CHECK (
    CASE WHEN clock_in_gps_result IN ('ok','low_accuracy')
         THEN clock_in_latitude IS NOT NULL AND clock_in_accuracy_m IS NOT NULL
         ELSE clock_in_latitude IS NULL AND clock_in_accuracy_m IS NULL END),
  CONSTRAINT service_job_onsite_attendance_out_capture_chk CHECK (
    clock_out_gps_result IS NULL OR
    CASE WHEN clock_out_gps_result IN ('ok','low_accuracy')
         THEN clock_out_latitude IS NOT NULL AND clock_out_accuracy_m IS NOT NULL
         ELSE clock_out_latitude IS NULL AND clock_out_accuracy_m IS NULL END),
  -- An uncaptured clock event must carry a reason.
  CONSTRAINT service_job_onsite_attendance_in_reason_chk CHECK (
    clock_in_gps_result IN ('ok','low_accuracy')
    OR btrim(coalesce(clock_in_exception_reason, '')) <> ''),
  CONSTRAINT service_job_onsite_attendance_out_reason_chk CHECK (
    clock_out_at IS NULL
    OR clock_out_gps_result IN ('ok','low_accuracy')
    OR btrim(coalesce(clock_out_exception_reason, '')) <> ''),
  CONSTRAINT service_job_onsite_attendance_order_chk CHECK (
    clock_out_at IS NULL OR clock_out_at >= clock_in_at),
  CONSTRAINT service_job_onsite_attendance_duration_chk CHECK (
    duration_minutes IS NULL OR duration_minutes >= 0)
);

-- Server-only by construction: no browser role may touch the table at all.
REVOKE ALL ON TABLE public.service_job_onsite_attendance FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.service_job_onsite_attendance TO service_role;

ALTER TABLE public.service_job_onsite_attendance ENABLE ROW LEVEL SECURITY;

-- Deliberately deny-all for every browser role (fail closed).
DROP POLICY IF EXISTS "onsite attendance is server-only"
  ON public.service_job_onsite_attendance;
CREATE POLICY "onsite attendance is server-only"
  ON public.service_job_onsite_attendance FOR ALL
  USING (false) WITH CHECK (false);


CREATE INDEX IF NOT EXISTS service_job_onsite_attendance_job_idx
  ON public.service_job_onsite_attendance (tenant_code, service_job_id, clock_in_at DESC);

CREATE INDEX IF NOT EXISTS service_job_onsite_attendance_actor_idx
  ON public.service_job_onsite_attendance (tenant_code, actor_user_id, clock_in_at DESC);

-- At most ONE open attendance session per tenant + actor, across every Job.
CREATE UNIQUE INDEX IF NOT EXISTS service_job_onsite_attendance_one_open_idx
  ON public.service_job_onsite_attendance (tenant_code, actor_user_id)
  WHERE clock_out_at IS NULL;

DROP TRIGGER IF EXISTS set_service_job_onsite_attendance_updated_at
  ON public.service_job_onsite_attendance;
CREATE TRIGGER set_service_job_onsite_attendance_updated_at
  BEFORE UPDATE ON public.service_job_onsite_attendance
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Atomic Clock In / Clock Out.
--    One transactional RPC, serialized per (tenant, actor) by an advisory
--    transaction lock and by locking the Job row. Duplicate / racing calls
--    produce exactly one success and a deterministic conflict, and a rejected
--    attempt writes no success audit (the whole function is one transaction).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sh_onsite_attendance_mutate(
  p_tenant_code text,
  p_job_id uuid,
  p_action text,
  p_actor_user_id text,
  p_actor_name text,
  p_actor_code text,
  p_actor_email text,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job          public.service_jobs%ROWTYPE;
  v_open         public.service_job_onsite_attendance%ROWTYPE;
  v_row          public.service_job_onsite_attendance%ROWTYPE;
  v_now          timestamptz := now();
  v_gps          text := coalesce(nullif(p_payload->>'gps_result', ''), 'ok');
  v_reason       text := nullif(btrim(coalesce(p_payload->>'exception_reason', '')), '');
  v_lat          double precision := nullif(p_payload->>'latitude', '')::double precision;
  v_lng          double precision := nullif(p_payload->>'longitude', '')::double precision;
  v_acc          double precision := nullif(p_payload->>'accuracy', '')::double precision;
  v_captured     boolean;
BEGIN
  IF p_tenant_code IS NULL OR btrim(p_tenant_code) = ''
     OR p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 401,
                              'error', 'Unresolved tenant or actor.');
  END IF;

  -- Serialize every attendance mutation for this person inside the tenant.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_code || ':' || p_actor_user_id, 0));

  SELECT * INTO v_job FROM public.service_jobs
    WHERE tenant_code = p_tenant_code AND id = p_job_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 404, 'error', 'Job not found.');
  END IF;
  IF v_job.is_deleted
     OR v_job.status IN ('Completed', 'Cancelled', 'Pending Approval') THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'On-site attendance is not available for this Job.');
  END IF;

  v_captured := (v_gps = 'ok' OR v_gps = 'low_accuracy') AND v_lat IS NOT NULL AND v_lng IS NOT NULL;
  IF NOT v_captured AND v_reason IS NULL THEN
    RETURN jsonb_build_object('outcome', 'error', 'status', 400,
      'error', 'A reason is required when location is not captured.');
  END IF;
  IF NOT v_captured THEN
    v_lat := NULL; v_lng := NULL; v_acc := NULL;
    IF v_gps = 'ok' OR v_gps = 'low_accuracy' THEN v_gps := 'unavailable'; END IF;
  END IF;

  -- Current open session for this actor anywhere in the tenant.
  SELECT * INTO v_open FROM public.service_job_onsite_attendance
    WHERE tenant_code = p_tenant_code
      AND actor_user_id = p_actor_user_id
      AND clock_out_at IS NULL
    FOR UPDATE;

  IF p_action = 'clock_in' THEN
    IF FOUND THEN
      IF v_open.service_job_id = p_job_id THEN
        RETURN jsonb_build_object('outcome', 'error', 'status', 409,
          'error', 'You are already clocked in on this Job.',
          'open_visit_id', v_open.id);
      END IF;
      RETURN jsonb_build_object('outcome', 'error', 'status', 409,
        'error', 'You are already clocked in on Job ' ||
                 coalesce(v_open.job_number_snapshot, 'another Job') ||
                 '. Clock out there first.',
        'conflict_job_number', v_open.job_number_snapshot);
    END IF;

    INSERT INTO public.service_job_onsite_attendance (
      tenant_code, service_job_id, job_number_snapshot,
      actor_user_id, actor_name_snapshot, actor_code_snapshot, actor_email_snapshot,
      support_mode_snapshot, clock_in_at,
      clock_in_latitude, clock_in_longitude, clock_in_accuracy_m,
      clock_in_gps_result, clock_in_exception_reason, has_gps_exception
    ) VALUES (
      p_tenant_code, p_job_id, v_job.job_number,
      p_actor_user_id, p_actor_name, p_actor_code, p_actor_email,
      v_job.support_mode, v_now,
      v_lat, v_lng, v_acc, v_gps, v_reason, NOT v_captured
    ) RETURNING * INTO v_row;

  ELSIF p_action = 'clock_out' THEN
    IF NOT FOUND THEN
      RETURN jsonb_build_object('outcome', 'error', 'status', 409,
        'error', 'You have no open on-site attendance session.');
    END IF;
    IF v_open.service_job_id <> p_job_id THEN
      RETURN jsonb_build_object('outcome', 'error', 'status', 409,
        'error', 'Your open session belongs to Job ' ||
                 coalesce(v_open.job_number_snapshot, '(unknown)') ||
                 '. Clock out there instead.',
        'conflict_job_number', v_open.job_number_snapshot);
    END IF;

    UPDATE public.service_job_onsite_attendance SET
      clock_out_at = v_now,
      duration_minutes = GREATEST(0, (EXTRACT(EPOCH FROM (v_now - clock_in_at)) / 60)::int),
      clock_out_latitude = v_lat,
      clock_out_longitude = v_lng,
      clock_out_accuracy_m = v_acc,
      clock_out_gps_result = v_gps,
      clock_out_exception_reason = v_reason,
      has_gps_exception = has_gps_exception OR NOT v_captured
    WHERE id = v_open.id
    RETURNING * INTO v_row;

  ELSE
    RETURN jsonb_build_object('outcome', 'error', 'status', 400,
                              'error', 'Unknown attendance action.');
  END IF;

  INSERT INTO public.service_job_activity_log (
    tenant_code, service_job_id, event_type, note, metadata_json,
    performed_by_user_id, performed_by_name_snapshot
  ) VALUES (
    p_tenant_code, p_job_id,
    CASE WHEN p_action = 'clock_in' THEN 'onsite_clock_in' ELSE 'onsite_clock_out' END,
    NULL,
    jsonb_build_object('visit_id', v_row.id, 'gps_result', v_gps,
                       'accuracy_m', v_acc, 'captured', v_captured),
    p_actor_user_id, p_actor_name
  );

  IF NOT v_captured THEN
    INSERT INTO public.service_job_activity_log (
      tenant_code, service_job_id, event_type, note, metadata_json,
      performed_by_user_id, performed_by_name_snapshot
    ) VALUES (
      p_tenant_code, p_job_id, 'onsite_gps_exception', v_reason,
      jsonb_build_object('visit_id', v_row.id, 'gps_result', v_gps, 'action', p_action),
      p_actor_user_id, p_actor_name
    );
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'action', p_action,
    'visit_id', v_row.id,
    'at', CASE WHEN p_action = 'clock_in' THEN v_row.clock_in_at ELSE v_row.clock_out_at END,
    'duration_minutes', v_row.duration_minutes,
    'gps_result', v_gps,
    'has_gps_exception', v_row.has_gps_exception
  );
EXCEPTION
  WHEN unique_violation THEN
    -- Racing Clock In lost to the partial unique index: deterministic conflict,
    -- and the whole transaction (including any audit) is rolled back.
    RETURN jsonb_build_object('outcome', 'error', 'status', 409,
      'error', 'You are already clocked in.');
END;
$$;

REVOKE ALL ON FUNCTION public.sh_onsite_attendance_mutate(
  text, uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sh_onsite_attendance_mutate(
  text, uuid, text, text, text, text, text, jsonb) TO service_role;
