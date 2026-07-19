
-- 1. Extend service_jobs
ALTER TABLE public.service_jobs
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id text,
  ADD COLUMN IF NOT EXISTS deleted_by_name_snapshot text,
  ADD COLUMN IF NOT EXISTS deletion_reason text,
  ADD COLUMN IF NOT EXISTS approved_by_user_id text,
  ADD COLUMN IF NOT EXISTS approved_by_name_snapshot text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_note text,
  ADD COLUMN IF NOT EXISTS rejected_by_user_id text,
  ADD COLUMN IF NOT EXISTS rejected_by_name_snapshot text,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id text,
  ADD COLUMN IF NOT EXISTS cancelled_by_name_snapshot text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS service_jobs_tenant_deleted_status_idx
  ON public.service_jobs (tenant_code, is_deleted, status);
CREATE INDEX IF NOT EXISTS service_jobs_tenant_customer_deleted_idx
  ON public.service_jobs (tenant_code, customer_code_snapshot, is_deleted);

-- 2. Activity log (append-only)
CREATE TABLE IF NOT EXISTS public.service_job_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  old_value text,
  new_value text,
  note text,
  performed_by_user_id text,
  performed_by_name_snapshot text,
  metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_job_activity_log_job_idx
  ON public.service_job_activity_log (tenant_code, service_job_id, created_at DESC);

GRANT ALL ON public.service_job_activity_log TO service_role;
ALTER TABLE public.service_job_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_job_activity_log service_role only"
  ON public.service_job_activity_log FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- 3. Comments (append-only)
CREATE TABLE IF NOT EXISTS public.service_job_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','customer')),
  body text NOT NULL,
  author_user_id text,
  author_name_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_job_comments_job_idx
  ON public.service_job_comments (tenant_code, service_job_id, created_at DESC);

GRANT ALL ON public.service_job_comments TO service_role;
ALTER TABLE public.service_job_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_job_comments service_role only"
  ON public.service_job_comments FOR ALL
  TO service_role USING (true) WITH CHECK (true);
