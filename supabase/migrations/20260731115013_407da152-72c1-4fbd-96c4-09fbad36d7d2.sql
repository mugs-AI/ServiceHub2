ALTER TABLE public.service_jobs
  ADD COLUMN IF NOT EXISTS scheduled_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_timezone text NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  ADD COLUMN IF NOT EXISTS schedule_status text NOT NULL DEFAULT 'unscheduled',
  ADD COLUMN IF NOT EXISTS scheduled_by_user_id text,
  ADD COLUMN IF NOT EXISTS scheduled_by_name_snapshot text,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_service_jobs_sched_tech_day
  ON public.service_jobs (tenant_code, assigned_user_id, scheduled_start_at)
  WHERE scheduled_start_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_service_jobs_sched_tenant_day
  ON public.service_jobs (tenant_code, scheduled_start_at)
  WHERE scheduled_start_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.service_job_schedule_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  service_job_id uuid NOT NULL,
  previous_start_at timestamptz,
  previous_end_at timestamptz,
  new_start_at timestamptz,
  new_end_at timestamptz,
  previous_technician_user_id text,
  new_technician_user_id text,
  action text NOT NULL,
  reason text,
  changed_by_user_id text,
  changed_by_name_snapshot text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.service_job_schedule_history TO service_role;

ALTER TABLE public.service_job_schedule_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedule history service role only"
  ON public.service_job_schedule_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_sched_history_job
  ON public.service_job_schedule_history (tenant_code, service_job_id, changed_at DESC);