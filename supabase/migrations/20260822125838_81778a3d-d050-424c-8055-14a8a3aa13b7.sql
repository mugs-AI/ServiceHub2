-- WP1 Session Integrity Correction: work-session open-segment invariant.
-- The historical rule treated both 'active' and 'paused' rows as open, per
-- technician. That blocked Resume after Pause and allowed two actors to hold
-- parallel work clocks on one Job. Replace it with a Job-wide invariant that
-- covers only genuinely open active segments. No rows are modified or deleted.

DROP INDEX IF EXISTS public.service_job_work_sessions_one_open;

CREATE UNIQUE INDEX service_job_work_sessions_one_active_per_job
  ON public.service_job_work_sessions (service_job_id)
  WHERE status = 'active' AND ended_at IS NULL;