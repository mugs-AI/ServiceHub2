
ALTER TABLE public.service_jobs
  ADD COLUMN IF NOT EXISTS assigned_user_id text,
  ADD COLUMN IF NOT EXISTS assigned_user_name_snapshot text,
  ADD COLUMN IF NOT EXISTS assigned_user_code_snapshot text,
  ADD COLUMN IF NOT EXISTS assigned_user_email_snapshot text,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by_user_id text,
  ADD COLUMN IF NOT EXISTS assigned_by_name_snapshot text;

CREATE INDEX IF NOT EXISTS service_jobs_tenant_assigned_idx
  ON public.service_jobs (tenant_code, assigned_user_id);

CREATE TABLE IF NOT EXISTS public.service_job_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('assigned','reassigned','unassigned')),
  assigned_user_id text,
  assigned_user_name_snapshot text,
  assigned_user_code_snapshot text,
  assigned_user_email_snapshot text,
  previous_assigned_user_id text,
  previous_assigned_user_name_snapshot text,
  performed_by_user_id text,
  performed_by_name_snapshot text,
  performed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.service_job_assignment_history TO authenticated;
GRANT ALL ON public.service_job_assignment_history TO service_role;

ALTER TABLE public.service_job_assignment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assignment history service role only"
  ON public.service_job_assignment_history
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS sjah_tenant_job_idx
  ON public.service_job_assignment_history (tenant_code, service_job_id, performed_at DESC);
