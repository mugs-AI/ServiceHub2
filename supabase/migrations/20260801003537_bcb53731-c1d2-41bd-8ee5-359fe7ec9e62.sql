-- ============================================================
-- Field Operations + Completion model
-- ============================================================

ALTER TABLE public.service_jobs
  ADD COLUMN IF NOT EXISTS travel_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS arrived_on_site_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_for_completion_at timestamptz,
  ADD COLUMN IF NOT EXISTS total_work_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_snapshot jsonb;

-- ---------------- work sessions ----------------
CREATE TABLE public.service_job_work_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  technician_user_id text NOT NULL,
  technician_name_snapshot text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  pause_reason text,
  duration_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_session_status_chk
    CHECK (status IN ('active','paused','completed','cancelled'))
);

GRANT ALL ON public.service_job_work_sessions TO service_role;
ALTER TABLE public.service_job_work_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "work sessions are server-only"
  ON public.service_job_work_sessions FOR ALL
  USING (false) WITH CHECK (false);

-- one open (active or paused) session per technician per job
CREATE UNIQUE INDEX service_job_work_sessions_one_open
  ON public.service_job_work_sessions (service_job_id, technician_user_id)
  WHERE status IN ('active','paused');

CREATE INDEX service_job_work_sessions_job_idx
  ON public.service_job_work_sessions (tenant_code, service_job_id, started_at DESC);

CREATE TRIGGER set_updated_at_work_sessions
  BEFORE UPDATE ON public.service_job_work_sessions
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

-- ---------------- work notes ----------------
CREATE TABLE public.service_job_work_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  author_user_id text,
  author_name_snapshot text,
  note_type text NOT NULL,
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_note_type_chk CHECK (note_type IN
    ('diagnosis','action_taken','test_result','customer_update','vendor_update','general')),
  CONSTRAINT work_note_visibility_chk CHECK (visibility IN ('internal','visible_to_customer'))
);

GRANT ALL ON public.service_job_work_notes TO service_role;
ALTER TABLE public.service_job_work_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "work notes are server-only"
  ON public.service_job_work_notes FOR ALL
  USING (false) WITH CHECK (false);

CREATE INDEX service_job_work_notes_job_idx
  ON public.service_job_work_notes (tenant_code, service_job_id, created_at DESC);

-- ---------------- waiting periods ----------------
CREATE TABLE public.service_job_waiting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  waiting_type text NOT NULL,
  reason text NOT NULL,
  requested_action text,
  contact_method text,
  follow_up_date date,
  vendor_name text,
  vendor_contact text,
  vendor_reference text,
  expected_response_date date,
  visibility text NOT NULL DEFAULT 'internal',
  started_at timestamptz NOT NULL DEFAULT now(),
  started_by_user_id text,
  started_by_name_snapshot text,
  resolved_at timestamptz,
  resolved_by_user_id text,
  resolved_by_name_snapshot text,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waiting_type_chk CHECK (waiting_type IN ('customer','vendor')),
  CONSTRAINT waiting_visibility_chk CHECK (visibility IN ('internal','visible_to_customer'))
);

GRANT ALL ON public.service_job_waiting_periods TO service_role;
ALTER TABLE public.service_job_waiting_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "waiting periods are server-only"
  ON public.service_job_waiting_periods FOR ALL
  USING (false) WITH CHECK (false);

-- one unresolved waiting period per type per job
CREATE UNIQUE INDEX service_job_waiting_open_idx
  ON public.service_job_waiting_periods (service_job_id, waiting_type)
  WHERE resolved_at IS NULL;

CREATE TRIGGER set_updated_at_waiting_periods
  BEFORE UPDATE ON public.service_job_waiting_periods
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

-- ---------------- attachments ----------------
CREATE TABLE public.service_job_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  attachment_type text NOT NULL DEFAULT 'document',
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size integer NOT NULL,
  storage_path text NOT NULL,
  uploaded_by_user_id text,
  uploaded_by_name_snapshot text,
  visibility text NOT NULL DEFAULT 'internal',
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  deleted_by_user_id text,
  deleted_by_name_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attachment_type_chk CHECK (attachment_type IN
    ('site_photo','error_screenshot','document','customer_file','signature')),
  CONSTRAINT attachment_visibility_chk CHECK (visibility IN ('internal','visible_to_customer'))
);

GRANT ALL ON public.service_job_attachments TO service_role;
ALTER TABLE public.service_job_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attachments are server-only"
  ON public.service_job_attachments FOR ALL
  USING (false) WITH CHECK (false);

CREATE INDEX service_job_attachments_job_idx
  ON public.service_job_attachments (tenant_code, service_job_id, created_at DESC);

-- ---------------- completion ----------------
CREATE TABLE public.service_job_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution_summary text,
  work_performed text,
  test_result text,
  outstanding_issue text,
  follow_up_required boolean NOT NULL DEFAULT false,
  follow_up_date date,
  ack_customer_name text,
  ack_customer_role text,
  ack_confirmed boolean NOT NULL DEFAULT false,
  ack_at timestamptz,
  ack_remark text,
  signature_attachment_id uuid REFERENCES public.service_job_attachments(id),
  signature_data_url text,
  signature_signed_at timestamptz,
  signature_waived boolean NOT NULL DEFAULT false,
  signature_waiver_reason text,
  signature_waived_by_user_id text,
  signature_waived_by_name_snapshot text,
  is_final boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_job_completion_unique UNIQUE (service_job_id)
);

GRANT ALL ON public.service_job_completions TO service_role;
ALTER TABLE public.service_job_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "completions are server-only"
  ON public.service_job_completions FOR ALL
  USING (false) WITH CHECK (false);

CREATE TRIGGER set_updated_at_completions
  BEFORE UPDATE ON public.service_job_completions
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();