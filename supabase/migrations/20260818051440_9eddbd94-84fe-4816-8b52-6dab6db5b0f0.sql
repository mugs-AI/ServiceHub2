-- WP0E-R atomic cancellation integrity correction.
CREATE OR REPLACE FUNCTION public.sh_cancellation_request_create(
  p_tenant_code text,
  p_job_id uuid,
  p_reason text,
  p_requester_policy text,
  p_approval_mode text,
  p_actor_user_id text,
  p_actor_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job public.service_jobs%ROWTYPE;
  v_req public.service_job_cancellation_requests%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('outcome', 'reason_required');
  END IF;

  SELECT * INTO v_job FROM public.service_jobs
   WHERE tenant_code = p_tenant_code AND id = p_job_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'job_not_found');
  END IF;
  IF v_job.is_deleted OR v_job.status IN ('Cancelled', 'Completed') THEN
    RETURN jsonb_build_object('outcome', 'job_not_cancellable', 'status', v_job.status);
  END IF;

  BEGIN
    INSERT INTO public.service_job_cancellation_requests (
      tenant_code, service_job_id, status, reason, prior_status,
      requester_policy_at_request, approval_mode_at_request,
      requested_by_user_id, requested_by_name_snapshot)
    VALUES (p_tenant_code, p_job_id, 'pending', btrim(p_reason), v_job.status,
            p_requester_policy, p_approval_mode, p_actor_user_id, p_actor_name)
    RETURNING * INTO v_req;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome', 'duplicate_active_request');
  END;

  INSERT INTO public.service_job_activity_log (
    tenant_code, service_job_id, event_type, old_value, new_value, note,
    performed_by_user_id, performed_by_name_snapshot)
  VALUES (p_tenant_code, p_job_id, 'cancellation_requested', v_job.status, NULL,
          btrim(p_reason), p_actor_user_id, p_actor_name);

  RETURN jsonb_build_object('outcome', 'created', 'request', to_jsonb(v_req));
END;
$$;

CREATE OR REPLACE FUNCTION public.sh_cancellation_cancel_direct(
  p_tenant_code text,
  p_job_id uuid,
  p_reason text,
  p_actor_user_id text,
  p_actor_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job public.service_jobs%ROWTYPE;
  v_prior text;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('outcome', 'reason_required');
  END IF;

  SELECT * INTO v_job FROM public.service_jobs
   WHERE tenant_code = p_tenant_code AND id = p_job_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'job_not_found');
  END IF;
  IF v_job.is_deleted OR v_job.status IN ('Cancelled', 'Completed') THEN
    RETURN jsonb_build_object('outcome', 'job_not_cancellable', 'status', v_job.status);
  END IF;
  v_prior := v_job.status;

  UPDATE public.service_jobs
     SET status = 'Cancelled',
         cancelled_at = now(),
         cancellation_reason = btrim(p_reason),
         cancelled_by_user_id = p_actor_user_id,
         cancelled_by_name_snapshot = p_actor_name
   WHERE tenant_code = p_tenant_code AND id = p_job_id
  RETURNING * INTO v_job;

  INSERT INTO public.service_job_activity_log (
    tenant_code, service_job_id, event_type, old_value, new_value, note,
    performed_by_user_id, performed_by_name_snapshot)
  VALUES (p_tenant_code, p_job_id, 'job_cancelled', v_prior, 'Cancelled',
          btrim(p_reason), p_actor_user_id, p_actor_name);

  RETURN jsonb_build_object('outcome', 'cancelled', 'job', to_jsonb(v_job));
END;
$$;

CREATE OR REPLACE FUNCTION public.sh_cancellation_decide(
  p_tenant_code text,
  p_request_id uuid,
  p_decision text,
  p_note text,
  p_actor_user_id text,
  p_actor_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_req public.service_job_cancellation_requests%ROWTYPE;
  v_job public.service_jobs%ROWTYPE;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('outcome', 'invalid_decision');
  END IF;

  SELECT * INTO v_req FROM public.service_job_cancellation_requests
   WHERE tenant_code = p_tenant_code AND id = p_request_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'request_not_found');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('outcome', 'already_decided', 'status', v_req.status);
  END IF;

  SELECT * INTO v_job FROM public.service_jobs
   WHERE tenant_code = p_tenant_code AND id = v_req.service_job_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'job_not_found');
  END IF;
  IF p_decision = 'approved'
     AND (v_job.is_deleted OR v_job.status IN ('Cancelled', 'Completed')) THEN
    RETURN jsonb_build_object('outcome', 'job_not_cancellable', 'status', v_job.status);
  END IF;

  UPDATE public.service_job_cancellation_requests
     SET status = p_decision,
         decision = p_decision,
         decision_note = p_note,
         decided_by_user_id = p_actor_user_id,
         decided_by_name_snapshot = p_actor_name,
         decided_at = now()
   WHERE tenant_code = p_tenant_code AND id = p_request_id AND status = 'pending'
  RETURNING * INTO v_req;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'already_decided');
  END IF;

  IF p_decision = 'rejected' THEN
    INSERT INTO public.service_job_activity_log (
      tenant_code, service_job_id, event_type, old_value, new_value, note,
      performed_by_user_id, performed_by_name_snapshot)
    VALUES (p_tenant_code, v_job.id, 'cancellation_rejected', v_req.prior_status,
            v_job.status, p_note, p_actor_user_id, p_actor_name);
    RETURN jsonb_build_object('outcome', 'rejected', 'request', to_jsonb(v_req),
                              'job', to_jsonb(v_job));
  END IF;

  UPDATE public.service_jobs
     SET status = 'Cancelled',
         cancelled_at = now(),
         cancellation_reason = v_req.reason,
         cancelled_by_user_id = p_actor_user_id,
         cancelled_by_name_snapshot = p_actor_name
   WHERE tenant_code = p_tenant_code AND id = v_job.id
  RETURNING * INTO v_job;

  INSERT INTO public.service_job_activity_log (
    tenant_code, service_job_id, event_type, old_value, new_value, note,
    performed_by_user_id, performed_by_name_snapshot)
  VALUES (p_tenant_code, v_job.id, 'job_cancelled', v_req.prior_status, 'Cancelled',
          'Approved cancellation requested by '
            || coalesce(v_req.requested_by_name_snapshot, 'a support user')
            || ': ' || v_req.reason,
          p_actor_user_id, p_actor_name);

  RETURN jsonb_build_object('outcome', 'approved', 'request', to_jsonb(v_req),
                            'job', to_jsonb(v_job));
END;
$$;

REVOKE ALL ON FUNCTION public.sh_cancellation_request_create(text, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sh_cancellation_cancel_direct(text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sh_cancellation_decide(text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sh_cancellation_request_create(text, uuid, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sh_cancellation_cancel_direct(text, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sh_cancellation_decide(text, uuid, text, text, text, text) TO service_role;