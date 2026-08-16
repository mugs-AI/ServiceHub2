CREATE TABLE public.service_job_cancellation_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_code text NOT NULL,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  reason text NOT NULL,
  requested_by_user_id text,
  requested_by_name_snapshot text,
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  prior_status text NOT NULL,
  requester_policy_at_request text NOT NULL,
  approval_mode_at_request text NOT NULL,
  decision text,
  decided_by_user_id text,
  decided_by_name_snapshot text,
  decided_at timestamp with time zone,
  decision_note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT service_job_cancellation_requests_status_chk
    CHECK (status IN ('pending','approved','rejected','withdrawn'))
);

CREATE UNIQUE INDEX service_job_cancellation_requests_one_active
  ON public.service_job_cancellation_requests (tenant_code, service_job_id)
  WHERE status = 'pending';

CREATE INDEX service_job_cancellation_requests_job_idx
  ON public.service_job_cancellation_requests (tenant_code, service_job_id, requested_at DESC);

GRANT ALL ON public.service_job_cancellation_requests TO service_role;

ALTER TABLE public.service_job_cancellation_requests ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER service_job_cancellation_requests_set_updated_at
  BEFORE UPDATE ON public.service_job_cancellation_requests
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();