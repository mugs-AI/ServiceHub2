-- Software support mode + travel/leave tracking on jobs
ALTER TABLE public.service_jobs
  ADD COLUMN IF NOT EXISTS support_mode text,
  ADD COLUMN IF NOT EXISTS travel_note text,
  ADD COLUMN IF NOT EXISTS arrival_note text,
  ADD COLUMN IF NOT EXISTS left_site_at timestamptz,
  ADD COLUMN IF NOT EXISTS leave_note text;

-- Vendor ticket support on waiting periods
ALTER TABLE public.service_job_waiting_periods
  ADD COLUMN IF NOT EXISTS vendor_ticket_number text,
  ADD COLUMN IF NOT EXISTS vendor_response text;

CREATE INDEX IF NOT EXISTS idx_waiting_vendor_ticket
  ON public.service_job_waiting_periods (tenant_code, vendor_ticket_number);

-- Software-service completion fields
ALTER TABLE public.service_job_completions
  ADD COLUMN IF NOT EXISTS diagnosis text,
  ADD COLUMN IF NOT EXISTS action_taken text,
  ADD COLUMN IF NOT EXISTS software_module text,
  ADD COLUMN IF NOT EXISTS version_after text,
  ADD COLUMN IF NOT EXISTS internal_completion_note text,
  ADD COLUMN IF NOT EXISTS ack_method text,
  ADD COLUMN IF NOT EXISTS ack_evidence_reference text;

-- Attachment provider metadata (multi-provider foundation)
ALTER TABLE public.service_job_attachments
  ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 'supabase',
  ADD COLUMN IF NOT EXISTS storage_connection_id uuid,
  ADD COLUMN IF NOT EXISTS storage_container text,
  ADD COLUMN IF NOT EXISTS external_file_id text,
  ADD COLUMN IF NOT EXISTS checksum text,
  ADD COLUMN IF NOT EXISTS availability_status text NOT NULL DEFAULT 'available';

-- Tenant storage provider connections
CREATE TABLE IF NOT EXISTS public.tenant_storage_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  provider text NOT NULL,
  display_name text,
  is_active boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'not_connected',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ciphertext text,
  root_folder_id text,
  root_folder_name text,
  last_tested_at timestamptz,
  last_test_result text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.tenant_storage_connections TO service_role;
ALTER TABLE public.tenant_storage_connections ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_conn_tenant_provider
  ON public.tenant_storage_connections (tenant_code, provider);
CREATE TRIGGER trg_storage_conn_updated
  BEFORE UPDATE ON public.tenant_storage_connections
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

-- Storage responsibility acknowledgements / provider change audit
CREATE TABLE IF NOT EXISTS public.storage_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  old_provider text,
  new_provider text,
  confirmed_by_user_id text,
  confirmed_by_name text,
  confirmation_text_version text NOT NULL DEFAULT 'v1',
  confirmation_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.storage_change_log TO service_role;
ALTER TABLE public.storage_change_log ENABLE ROW LEVEL SECURITY;

-- Report registry role permissions
CREATE TABLE IF NOT EXISTS public.report_role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  report_code text NOT NULL,
  role text NOT NULL,
  can_view boolean NOT NULL DEFAULT false,
  can_print boolean NOT NULL DEFAULT false,
  can_export_excel boolean NOT NULL DEFAULT false,
  can_export_csv boolean NOT NULL DEFAULT false,
  data_scope text NOT NULL DEFAULT 'own',
  view_private_notes boolean NOT NULL DEFAULT false,
  view_financial boolean NOT NULL DEFAULT false,
  view_gps boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_code, report_code, role)
);
GRANT ALL ON public.report_role_permissions TO service_role;
ALTER TABLE public.report_role_permissions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_report_perm_updated
  BEFORE UPDATE ON public.report_role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

-- Settings / permission change audit
CREATE TABLE IF NOT EXISTS public.settings_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  area text NOT NULL,
  action text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  performed_by_user_id text,
  performed_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.settings_audit_log TO service_role;
ALTER TABLE public.settings_audit_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_settings_audit_tenant
  ON public.settings_audit_log (tenant_code, created_at DESC);