-- WP2A SECURITY CORRECTION -------------------------------------------------

-- P1-1: truthful Drive account identity column (about.get user.permissionId).
ALTER TABLE public.google_drive_connections
  RENAME COLUMN google_account_sub TO google_account_permission_id;

-- P1-2: sharing status must be DERIVED from Google, never claimed by ServiceHub.
ALTER TABLE public.google_drive_connections
  DROP CONSTRAINT IF EXISTS google_drive_connections_sharing_chk;

ALTER TABLE public.google_drive_connections
  DROP COLUMN IF EXISTS sharing_policy;

ALTER TABLE public.google_drive_connections
  ADD COLUMN IF NOT EXISTS detected_sharing_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS sharing_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS sharing_detail text,
  ADD COLUMN IF NOT EXISTS public_sharing_acknowledged boolean NOT NULL DEFAULT false;

ALTER TABLE public.google_drive_connections
  ADD CONSTRAINT google_drive_connections_detected_sharing_chk
  CHECK (detected_sharing_status IN ('restricted','anyone_with_link','unknown','error'));

-- P1-4: connection mutation + audit must commit atomically.
CREATE OR REPLACE FUNCTION public.sh_gdrive_apply(
  p_tenant_code text,
  p_patch jsonb,
  p_action text,
  p_detail jsonb DEFAULT '{}'::jsonb,
  p_actor_user_id text DEFAULT NULL,
  p_actor_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.google_drive_connections%ROWTYPE;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
BEGIN
  IF p_tenant_code IS NULL OR btrim(p_tenant_code) = '' THEN
    RAISE EXCEPTION 'tenant_code is required';
  END IF;

  SELECT * INTO v_row FROM public.google_drive_connections
   WHERE tenant_code = p_tenant_code AND is_active
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.google_drive_connections (tenant_code, is_active)
    VALUES (p_tenant_code, true)
    RETURNING * INTO v_row;
  END IF;

  UPDATE public.google_drive_connections AS c SET
    status = CASE WHEN v_patch ? 'status' THEN v_patch ->> 'status' ELSE c.status END,
    google_account_email = CASE WHEN v_patch ? 'google_account_email'
      THEN v_patch ->> 'google_account_email' ELSE c.google_account_email END,
    google_account_permission_id = CASE WHEN v_patch ? 'google_account_permission_id'
      THEN v_patch ->> 'google_account_permission_id' ELSE c.google_account_permission_id END,
    root_folder_id = CASE WHEN v_patch ? 'root_folder_id'
      THEN v_patch ->> 'root_folder_id' ELSE c.root_folder_id END,
    root_folder_name = CASE WHEN v_patch ? 'root_folder_name'
      THEN v_patch ->> 'root_folder_name' ELSE c.root_folder_name END,
    drive_id = CASE WHEN v_patch ? 'drive_id' THEN v_patch ->> 'drive_id' ELSE c.drive_id END,
    drive_context = CASE WHEN v_patch ? 'drive_context'
      THEN v_patch ->> 'drive_context' ELSE c.drive_context END,
    access_token_ciphertext = CASE WHEN v_patch ? 'access_token_ciphertext'
      THEN v_patch ->> 'access_token_ciphertext' ELSE c.access_token_ciphertext END,
    access_token_expires_at = CASE WHEN v_patch ? 'access_token_expires_at'
      THEN (v_patch ->> 'access_token_expires_at')::timestamptz ELSE c.access_token_expires_at END,
    refresh_token_ciphertext = CASE WHEN v_patch ? 'refresh_token_ciphertext'
      THEN v_patch ->> 'refresh_token_ciphertext' ELSE c.refresh_token_ciphertext END,
    cipher_version = CASE WHEN v_patch ? 'cipher_version'
      THEN (v_patch ->> 'cipher_version')::smallint ELSE c.cipher_version END,
    scopes = CASE WHEN v_patch ? 'scopes'
      THEN ARRAY(SELECT jsonb_array_elements_text(v_patch -> 'scopes')) ELSE c.scopes END,
    detected_sharing_status = CASE WHEN v_patch ? 'detected_sharing_status'
      THEN v_patch ->> 'detected_sharing_status' ELSE c.detected_sharing_status END,
    sharing_checked_at = CASE WHEN v_patch ? 'sharing_checked_at'
      THEN (v_patch ->> 'sharing_checked_at')::timestamptz ELSE c.sharing_checked_at END,
    sharing_detail = CASE WHEN v_patch ? 'sharing_detail'
      THEN v_patch ->> 'sharing_detail' ELSE c.sharing_detail END,
    public_sharing_acknowledged = CASE WHEN v_patch ? 'public_sharing_acknowledged'
      THEN (v_patch ->> 'public_sharing_acknowledged')::boolean ELSE c.public_sharing_acknowledged END,
    sharing_confirmed_by_user_id = CASE WHEN v_patch ? 'sharing_confirmed_by_user_id'
      THEN v_patch ->> 'sharing_confirmed_by_user_id' ELSE c.sharing_confirmed_by_user_id END,
    sharing_confirmed_by_name = CASE WHEN v_patch ? 'sharing_confirmed_by_name'
      THEN v_patch ->> 'sharing_confirmed_by_name' ELSE c.sharing_confirmed_by_name END,
    sharing_confirmed_at = CASE WHEN v_patch ? 'sharing_confirmed_at'
      THEN (v_patch ->> 'sharing_confirmed_at')::timestamptz ELSE c.sharing_confirmed_at END,
    last_error = CASE WHEN v_patch ? 'last_error' THEN v_patch ->> 'last_error' ELSE c.last_error END,
    last_tested_at = CASE WHEN v_patch ? 'last_tested_at'
      THEN (v_patch ->> 'last_tested_at')::timestamptz ELSE c.last_tested_at END,
    last_test_result = CASE WHEN v_patch ? 'last_test_result'
      THEN v_patch ->> 'last_test_result' ELSE c.last_test_result END,
    connected_by_user_id = CASE WHEN v_patch ? 'connected_by_user_id'
      THEN v_patch ->> 'connected_by_user_id' ELSE c.connected_by_user_id END,
    connected_by_name = CASE WHEN v_patch ? 'connected_by_name'
      THEN v_patch ->> 'connected_by_name' ELSE c.connected_by_name END
  WHERE c.id = v_row.id
  RETURNING * INTO v_row;

  IF p_action IS NOT NULL AND btrim(p_action) <> '' THEN
    INSERT INTO public.google_drive_audit_log (
      tenant_code, action, detail, actor_user_id, actor_name)
    VALUES (p_tenant_code, p_action, coalesce(p_detail, '{}'::jsonb),
            p_actor_user_id, p_actor_name);
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

-- P1-4: OAuth state creation + connect_started audit must commit atomically.
CREATE OR REPLACE FUNCTION public.sh_gdrive_state_create(
  p_tenant_code text,
  p_state_hash text,
  p_verifier_ciphertext text,
  p_redirect_uri text,
  p_expires_at timestamptz,
  p_actor_user_id text DEFAULT NULL,
  p_actor_name text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.google_drive_oauth_states (
    state_hash, tenant_code, actor_user_id, actor_name,
    code_verifier_ciphertext, redirect_uri, purpose, expires_at)
  VALUES (p_state_hash, p_tenant_code, p_actor_user_id, p_actor_name,
          p_verifier_ciphertext, p_redirect_uri, 'connect', p_expires_at)
  RETURNING id INTO v_id;

  INSERT INTO public.google_drive_audit_log (
    tenant_code, action, detail, actor_user_id, actor_name)
  VALUES (p_tenant_code, 'connect_started', '{}'::jsonb, p_actor_user_id, p_actor_name);

  RETURN v_id;
END;
$$;

-- P1-5: service-role-only access. No browser role may touch these tables.
REVOKE ALL ON public.google_drive_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.google_drive_oauth_states FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.google_drive_audit_log FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.google_drive_connections TO service_role;
GRANT ALL ON public.google_drive_oauth_states TO service_role;
GRANT ALL ON public.google_drive_audit_log TO service_role;

ALTER TABLE public.google_drive_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_drive_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_drive_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.sh_gdrive_apply(text, jsonb, text, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sh_gdrive_state_create(text, text, text, text, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sh_gdrive_apply(text, jsonb, text, jsonb, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.sh_gdrive_state_create(text, text, text, text, timestamptz, text, text)
  TO service_role;