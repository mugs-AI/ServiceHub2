-- WP1 Field Mutation Atomicity Closure.
-- Every state-sensitive Field mutation is serialized per Service Job through a
-- single SECURITY DEFINER routine that locks the Job row (SELECT ... FOR UPDATE)
-- before it re-reads state, validates authority and lifecycle, performs the
-- work-session / waiting / job writes, recomputes total work minutes and writes
-- exactly one success audit record. A conflicting request leaves no partial
-- state and no audit row because the whole routine is one transaction.

CREATE OR REPLACE FUNCTION public.sh_field_mutate(
  p_tenant_code text,
  p_job_id uuid,
  p_action text,
  p_actor_user_id text,
  p_actor_name text,
  p_is_admin boolean,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.service_jobs%ROWTYPE;
  v_now timestamptz := now();
  v_meta jsonb := coalesce(p_payload -> 'meta', '{}'::jsonb);
  v_note text := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
  v_active public.service_job_work_sessions%ROWTYPE;
  v_paused public.service_job_work_sessions%ROWTYPE;
  v_session_state text;
  v_waiting_customer boolean;
  v_waiting_vendor boolean;
  v_note_count integer;
  v_session_count integer;
  v_waiting_count integer;
  v_minutes integer;
  v_total integer;
  v_type text;
  v_mode text;
  v_open_waiting_id uuid;
  v_touched integer;
  v_reason text;
  v_onsite constant text[] := ARRAY['onsite_support','training','installation','migration'];
  v_travel_only constant text[] := ARRAY['travel_started','arrived_on_site','leave_site'];
BEGIN
  SELECT * INTO v_job
    FROM public.service_jobs
   WHERE tenant_code = p_tenant_code AND id = p_job_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','error','status',404,'error','Job not found.');
  END IF;

  IF NOT (coalesce(p_is_admin,false)
          OR (v_job.assigned_user_id IS NOT NULL
              AND p_actor_user_id IS NOT NULL
              AND v_job.assigned_user_id = p_actor_user_id)) THEN
    RETURN jsonb_build_object('outcome','error','status',403,
      'error','Only the Primary PIC or an Administrator can perform field actions.');
  END IF;

  IF v_job.is_deleted THEN
    RETURN jsonb_build_object('outcome','error','status',400,
      'error','Deleted jobs cannot use field actions.');
  END IF;
  IF v_job.status IN ('Pending Approval','Completed','Cancelled') THEN
    RETURN jsonb_build_object('outcome','error','status',400,
      'error', v_job.status || ' jobs cannot use field actions.');
  END IF;

  SELECT count(*) INTO v_session_count
    FROM public.service_job_work_sessions
   WHERE tenant_code = p_tenant_code AND service_job_id = p_job_id;
  SELECT count(*) INTO v_waiting_count
    FROM public.service_job_waiting_periods
   WHERE tenant_code = p_tenant_code AND service_job_id = p_job_id;
  SELECT count(*) INTO v_note_count
    FROM public.service_job_work_notes
   WHERE tenant_code = p_tenant_code AND service_job_id = p_job_id;

  IF p_action = 'support_mode_set' THEN
    v_mode := p_payload ->> 'support_mode';
    IF v_mode IS NULL OR v_mode NOT IN ('remote_support','onsite_support','phone_whatsapp',
        'training','installation','migration','consultation','other') THEN
      RETURN jsonb_build_object('outcome','error','status',400,'error','Invalid support mode.');
    END IF;
    IF v_session_count > 0 OR v_waiting_count > 0 OR v_note_count > 0
       OR v_job.travel_started_at IS NOT NULL OR v_job.arrived_on_site_at IS NOT NULL THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error','Support mode is locked once field evidence exists.');
    END IF;
    UPDATE public.service_jobs SET support_mode = v_mode
     WHERE tenant_code = p_tenant_code AND id = p_job_id;
    INSERT INTO public.service_job_activity_log (
      tenant_code, service_job_id, event_type, old_value, new_value, note,
      metadata_json, performed_by_user_id, performed_by_name_snapshot)
    VALUES (p_tenant_code, p_job_id, 'support_mode_set', v_job.support_mode, v_mode,
            coalesce(p_payload ->> 'mode_note', v_note), nullif(v_meta,'{}'::jsonb),
            p_actor_user_id, p_actor_name);
    RETURN jsonb_build_object('outcome','ok','support_mode',v_mode,'at', to_jsonb(v_now));
  END IF;

  IF v_job.support_mode IS NULL THEN
    RETURN jsonb_build_object('outcome','error','status',400,
      'error','Support mode is not set for this Job.');
  END IF;
  IF p_action = ANY (v_travel_only) AND NOT (v_job.support_mode = ANY (v_onsite)) THEN
    RETURN jsonb_build_object('outcome','error','status',400,
      'error','Travel, arrival and leave do not apply to this support mode.');
  END IF;

  SELECT * INTO v_active
    FROM public.service_job_work_sessions
   WHERE tenant_code = p_tenant_code AND service_job_id = p_job_id
     AND status = 'active' AND ended_at IS NULL
   ORDER BY started_at DESC
   LIMIT 1;
  IF FOUND THEN
    v_session_state := 'active';
  ELSE
    SELECT * INTO v_paused
      FROM public.service_job_work_sessions
     WHERE tenant_code = p_tenant_code AND service_job_id = p_job_id
       AND status <> 'cancelled'
     ORDER BY started_at DESC
     LIMIT 1;
    IF FOUND AND v_paused.status = 'paused' THEN
      v_session_state := 'paused';
    ELSE
      v_session_state := NULL;
    END IF;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.service_job_waiting_periods
                  WHERE tenant_code = p_tenant_code AND service_job_id = p_job_id
                    AND waiting_type = 'customer' AND resolved_at IS NULL),
         EXISTS (SELECT 1 FROM public.service_job_waiting_periods
                  WHERE tenant_code = p_tenant_code AND service_job_id = p_job_id
                    AND waiting_type = 'vendor' AND resolved_at IS NULL)
    INTO v_waiting_customer, v_waiting_vendor;

  IF p_action = 'travel_started' THEN
    IF v_job.travel_started_at IS NOT NULL THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error','Travel has already been recorded for this Job.');
    END IF;
    UPDATE public.service_jobs SET travel_started_at = v_now, travel_note = v_note
     WHERE tenant_code = p_tenant_code AND id = p_job_id;

  ELSIF p_action = 'arrived_on_site' THEN
    IF v_job.arrived_on_site_at IS NOT NULL THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error','Arrival has already been recorded for this Job.');
    END IF;
    UPDATE public.service_jobs SET arrived_on_site_at = v_now, arrival_note = v_note
     WHERE tenant_code = p_tenant_code AND id = p_job_id;
    IF v_job.travel_started_at IS NOT NULL THEN
      v_meta := v_meta || jsonb_build_object('travel_minutes',
        greatest(0, (EXTRACT(EPOCH FROM (v_now - v_job.travel_started_at)) / 60)::int));
    END IF;

  ELSIF p_action = 'leave_site' THEN
    IF v_job.arrived_on_site_at IS NULL THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error','Record Arrived On Site before leaving.');
    END IF;
    IF v_job.left_site_at IS NOT NULL THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error','Leaving site has already been recorded.');
    END IF;
    UPDATE public.service_jobs SET left_site_at = v_now, leave_note = v_note
     WHERE tenant_code = p_tenant_code AND id = p_job_id;
    v_meta := v_meta || jsonb_build_object('onsite_minutes',
      greatest(0, (EXTRACT(EPOCH FROM (v_now - v_job.arrived_on_site_at)) / 60)::int));

  ELSIF p_action = 'work_started' THEN
    IF v_session_state = 'active' THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error','A work session is already open for this job.');
    ELSIF v_session_state = 'paused' THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error','Work is paused - resume it instead of starting new work.');
    END IF;
    IF v_waiting_customer OR v_waiting_vendor THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error','Resolve the open waiting period before starting work.');
    END IF;
    INSERT INTO public.service_job_work_sessions (
      tenant_code, service_job_id, technician_user_id, technician_name_snapshot,
      started_at, status)
    VALUES (p_tenant_code, p_job_id, coalesce(p_actor_user_id,'unknown'), p_actor_name,
            v_now, 'active');
    UPDATE public.service_jobs
       SET status = 'In Progress',
           started_at = coalesce(started_at, v_now),
           ready_for_completion_at = NULL
     WHERE tenant_code = p_tenant_code AND id = p_job_id;

  ELSIF p_action = 'work_paused' THEN
    IF v_session_state IS DISTINCT FROM 'active' THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error','No active work session to pause.');
    END IF;
    v_minutes := greatest(0, (EXTRACT(EPOCH FROM (v_now - v_active.started_at)) / 60)::int);
    UPDATE public.service_job_work_sessions
       SET status = 'paused', ended_at = v_now, duration_minutes = v_minutes,
           pause_reason = v_note
     WHERE id = v_active.id AND status = 'active' AND ended_at IS NULL;
    GET DIAGNOSTICS v_touched = ROW_COUNT;
    IF v_touched = 0 THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error','The work session changed in another session. Refresh and try again.');
    END IF;
    v_meta := v_meta || jsonb_build_object('segment_minutes', v_minutes);

  ELSIF p_action = 'work_resumed' THEN
    IF v_session_state IS DISTINCT FROM 'paused' THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error','No paused work session to resume.');
    END IF;
    IF v_waiting_customer OR v_waiting_vendor THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error','Resolve the open waiting period before resuming work.');
    END IF;
    INSERT INTO public.service_job_work_sessions (
      tenant_code, service_job_id, technician_user_id, technician_name_snapshot,
      started_at, status)
    VALUES (p_tenant_code, p_job_id, coalesce(p_actor_user_id,'unknown'), p_actor_name,
            v_now, 'active');
    UPDATE public.service_jobs SET ready_for_completion_at = NULL
     WHERE tenant_code = p_tenant_code AND id = p_job_id;

  ELSIF p_action = 'work_stopped' THEN
    IF v_session_state IS NULL THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error','No open work session to stop.');
    END IF;
    IF v_session_state = 'active' THEN
      v_minutes := greatest(0, (EXTRACT(EPOCH FROM (v_now - v_active.started_at)) / 60)::int);
      UPDATE public.service_job_work_sessions
         SET status = 'completed', ended_at = v_now, duration_minutes = v_minutes
       WHERE id = v_active.id AND status = 'active' AND ended_at IS NULL;
      GET DIAGNOSTICS v_touched = ROW_COUNT;
      IF v_touched = 0 THEN
        RETURN jsonb_build_object('outcome','error','status',409,
          'error','The work session changed in another session. Refresh and try again.');
      END IF;
      v_meta := v_meta || jsonb_build_object('segment_minutes', v_minutes);
    ELSE
      UPDATE public.service_job_work_sessions
         SET status = 'completed'
       WHERE id = v_paused.id AND status = 'paused';
      GET DIAGNOSTICS v_touched = ROW_COUNT;
      IF v_touched = 0 THEN
        RETURN jsonb_build_object('outcome','error','status',409,
          'error','The work session changed in another session. Refresh and try again.');
      END IF;
    END IF;

  ELSIF p_action IN ('waiting_customer_started','waiting_vendor_started') THEN
    v_type := CASE WHEN p_action = 'waiting_customer_started' THEN 'customer' ELSE 'vendor' END;
    IF (v_type = 'customer' AND v_waiting_customer) OR (v_type = 'vendor' AND v_waiting_vendor) THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error', 'A Waiting ' || v_type || ' period is already open.');
    END IF;
    v_reason := nullif(btrim(coalesce(p_payload ->> 'reason','')), '');
    IF v_reason IS NULL THEN
      RETURN jsonb_build_object('outcome','error','status',400,'error','Reason is required.');
    END IF;

    IF v_session_state = 'active' THEN
      v_minutes := greatest(0, (EXTRACT(EPOCH FROM (v_now - v_active.started_at)) / 60)::int);
      UPDATE public.service_job_work_sessions
         SET status = 'completed', ended_at = v_now, duration_minutes = v_minutes
       WHERE id = v_active.id AND status = 'active' AND ended_at IS NULL;
      GET DIAGNOSTICS v_touched = ROW_COUNT;
      IF v_touched = 0 THEN
        RETURN jsonb_build_object('outcome','error','status',409,
          'error','The work session changed in another session. Refresh and try again.');
      END IF;
    ELSIF v_session_state = 'paused' THEN
      UPDATE public.service_job_work_sessions SET status = 'completed'
       WHERE id = v_paused.id AND status = 'paused';
      GET DIAGNOSTICS v_touched = ROW_COUNT;
      IF v_touched = 0 THEN
        RETURN jsonb_build_object('outcome','error','status',409,
          'error','The work session changed in another session. Refresh and try again.');
      END IF;
    END IF;

    INSERT INTO public.service_job_waiting_periods (
      tenant_code, service_job_id, waiting_type, reason, requested_action,
      contact_method, follow_up_date, vendor_name, vendor_ticket_number,
      vendor_contact, vendor_reference, expected_response_date, visibility,
      started_at, started_by_user_id, started_by_name_snapshot)
    VALUES (p_tenant_code, p_job_id, v_type, left(v_reason, 2000),
            nullif(btrim(coalesce(p_payload ->> 'requested_action','')), ''),
            nullif(btrim(coalesce(p_payload ->> 'contact_method','')), ''),
            (nullif(p_payload ->> 'follow_up_date',''))::date,
            nullif(btrim(coalesce(p_payload ->> 'vendor_name','')), ''),
            nullif(btrim(coalesce(p_payload ->> 'vendor_ticket_number','')), ''),
            nullif(btrim(coalesce(p_payload ->> 'vendor_contact','')), ''),
            nullif(btrim(coalesce(p_payload ->> 'vendor_reference','')), ''),
            (nullif(p_payload ->> 'expected_response_date',''))::date,
            CASE WHEN p_payload ->> 'visibility' = 'visible_to_customer'
                 THEN 'visible_to_customer' ELSE 'internal' END,
            v_now, p_actor_user_id, p_actor_name);
    UPDATE public.service_jobs
       SET status = CASE WHEN v_type = 'customer' THEN 'Waiting Customer'
                         ELSE 'Waiting Vendor' END,
           ready_for_completion_at = NULL
     WHERE tenant_code = p_tenant_code AND id = p_job_id;
    v_meta := v_meta || jsonb_build_object('waiting_type', v_type);

  ELSIF p_action IN ('waiting_customer_resolved','waiting_vendor_resolved') THEN
    v_type := CASE WHEN p_action = 'waiting_customer_resolved' THEN 'customer' ELSE 'vendor' END;
    v_reason := nullif(btrim(coalesce(p_payload ->> 'resolution_note','')), '');
    IF v_reason IS NULL THEN
      RETURN jsonb_build_object('outcome','error','status',400,
        'error','Resolution note is required.');
    END IF;
    SELECT id INTO v_open_waiting_id
      FROM public.service_job_waiting_periods
     WHERE tenant_code = p_tenant_code AND service_job_id = p_job_id
       AND waiting_type = v_type AND resolved_at IS NULL
     ORDER BY started_at DESC
     LIMIT 1;
    IF v_open_waiting_id IS NULL THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error', 'No open Waiting ' || v_type || ' period.');
    END IF;
    UPDATE public.service_job_waiting_periods
       SET resolved_at = v_now,
           resolved_by_user_id = p_actor_user_id,
           resolved_by_name_snapshot = p_actor_name,
           resolution_note = left(v_reason, 2000),
           vendor_response = CASE WHEN v_type = 'vendor'
             THEN nullif(btrim(coalesce(p_payload ->> 'vendor_response','')), '')
             ELSE vendor_response END
     WHERE id = v_open_waiting_id AND resolved_at IS NULL;
    GET DIAGNOSTICS v_touched = ROW_COUNT;
    IF v_touched = 0 THEN
      RETURN jsonb_build_object('outcome','error','status',409,
        'error','The waiting period changed in another session. Refresh and try again.');
    END IF;
    UPDATE public.service_jobs SET status = 'In Progress'
     WHERE tenant_code = p_tenant_code AND id = p_job_id;
    v_meta := v_meta || jsonb_build_object('waiting_type', v_type);

  ELSIF p_action = 'ready_for_completion' THEN
    IF v_job.status <> 'In Progress' THEN
      RETURN jsonb_build_object('outcome','error','status',400,
        'error','Job must be In Progress.');
    END IF;
    IF v_waiting_customer THEN
      RETURN jsonb_build_object('outcome','error','status',400,
        'error','Resolve Waiting Customer first.');
    END IF;
    IF v_waiting_vendor THEN
      RETURN jsonb_build_object('outcome','error','status',400,
        'error','Resolve Waiting Vendor first.');
    END IF;
    IF v_session_state IS NOT NULL THEN
      RETURN jsonb_build_object('outcome','error','status',400,
        'error','Close the open work session first.');
    END IF;
    IF v_note_count = 0 THEN
      RETURN jsonb_build_object('outcome','error','status',400,
        'error','Add at least one work note.');
    END IF;
    UPDATE public.service_jobs SET ready_for_completion_at = v_now
     WHERE tenant_code = p_tenant_code AND id = p_job_id;

  ELSE
    RETURN jsonb_build_object('outcome','error','status',400,'error','Unsupported action.');
  END IF;

  SELECT coalesce(sum(
           greatest(0, coalesce(duration_minutes,
             CASE WHEN ended_at IS NOT NULL
                  THEN (EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)::int
                  ELSE 0 END))), 0)::int
    INTO v_total
    FROM public.service_job_work_sessions
   WHERE tenant_code = p_tenant_code AND service_job_id = p_job_id
     AND status <> 'cancelled';
  UPDATE public.service_jobs SET total_work_minutes = v_total
   WHERE tenant_code = p_tenant_code AND id = p_job_id;

  INSERT INTO public.service_job_activity_log (
    tenant_code, service_job_id, event_type, note, metadata_json,
    performed_by_user_id, performed_by_name_snapshot)
  VALUES (p_tenant_code, p_job_id, p_action, v_note, nullif(v_meta, '{}'::jsonb),
          p_actor_user_id, p_actor_name);

  RETURN jsonb_build_object('outcome','ok','at', to_jsonb(v_now),
                            'total_work_minutes', v_total);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome','error','status',409,
      'error','A work session is already open for this job.');
END;
$function$;

REVOKE ALL ON FUNCTION public.sh_field_mutate(text, uuid, text, text, text, boolean, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sh_field_mutate(text, uuid, text, text, text, boolean, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.sh_field_mutate(text, uuid, text, text, text, boolean, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sh_field_mutate(text, uuid, text, text, text, boolean, jsonb) TO service_role;