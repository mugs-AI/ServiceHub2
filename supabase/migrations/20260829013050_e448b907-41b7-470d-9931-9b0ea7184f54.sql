CREATE TABLE public.google_drive_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'connected',
  google_account_email text,
  google_account_sub text,
  root_folder_id text,
  root_folder_name text,
  drive_id text,
  drive_context text,
  access_token_ciphertext text,
  access_token_expires_at timestamptz,
  refresh_token_ciphertext text,
  cipher_version smallint NOT NULL DEFAULT 1,
  scopes text[] NOT NULL DEFAULT '{}',
  sharing_policy text NOT NULL DEFAULT 'restricted',
  sharing_confirmed_by_user_id text,
  sharing_confirmed_by_name text,
  sharing_confirmed_at timestamptz,
  last_error text,
  last_tested_at timestamptz,
  last_test_result text,
  connected_by_user_id text,
  connected_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_drive_connections_status_chk CHECK (status IN ('connected','needs_reconnect','error','disconnected')),
  CONSTRAINT google_drive_connections_sharing_chk CHECK (sharing_policy IN ('restricted','anyone_with_link')),
  CONSTRAINT google_drive_connections_context_chk CHECK (drive_context IS NULL OR drive_context IN ('my_drive','shared_drive'))
);

CREATE UNIQUE INDEX google_drive_connections_one_active
  ON public.google_drive_connections (tenant_code)
  WHERE is_active;

GRANT ALL ON public.google_drive_connections TO service_role;
ALTER TABLE public.google_drive_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.google_drive_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  tenant_code text NOT NULL,
  actor_user_id text,
  actor_name text,
  code_verifier_ciphertext text NOT NULL,
  redirect_uri text NOT NULL,
  purpose text NOT NULL DEFAULT 'connect',
  used_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX google_drive_oauth_states_expiry ON public.google_drive_oauth_states (expires_at);

GRANT ALL ON public.google_drive_oauth_states TO service_role;
ALTER TABLE public.google_drive_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.google_drive_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id text,
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX google_drive_audit_log_tenant ON public.google_drive_audit_log (tenant_code, created_at DESC);

GRANT ALL ON public.google_drive_audit_log TO service_role;
ALTER TABLE public.google_drive_audit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_google_drive_connections_updated_at
BEFORE UPDATE ON public.google_drive_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_google_drive_oauth_states_updated_at
BEFORE UPDATE ON public.google_drive_oauth_states
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();