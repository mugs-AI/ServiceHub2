
-- Run 3 — Performance, approval remarks, and index review.

-- 1) Approval remarks (public + private). Preserve legacy approval_note.
ALTER TABLE public.service_jobs
  ADD COLUMN IF NOT EXISTS approval_remark_public text,
  ADD COLUMN IF NOT EXISTS approval_remark_private text;

-- Backfill: legacy approval_note is treated as public.
UPDATE public.service_jobs
   SET approval_remark_public = approval_note
 WHERE approval_note IS NOT NULL
   AND approval_remark_public IS NULL;

-- 2) Indexes justified by hot paths:
--    Pending Queue / Workspace list: filter (tenant_code, is_deleted, status) then sort created_at.
CREATE INDEX IF NOT EXISTS idx_service_jobs_tenant_deleted_status_created
  ON public.service_jobs (tenant_code, is_deleted, status, created_at DESC);

--    Dashboard "assigned to me" counts: (tenant, assigned_user_id, is_deleted, status).
CREATE INDEX IF NOT EXISTS idx_service_jobs_tenant_assignee_deleted_status
  ON public.service_jobs (tenant_code, assigned_user_id, is_deleted, status);

--    Customer summary + Workspace filter by customer.
CREATE INDEX IF NOT EXISTS idx_service_jobs_tenant_customer_deleted_created
  ON public.service_jobs (tenant_code, customer_code_snapshot, is_deleted, created_at DESC);

--    Timeline aggregation on activity log and comments.
CREATE INDEX IF NOT EXISTS idx_activity_tenant_job_created
  ON public.service_job_activity_log (tenant_code, service_job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_comments_tenant_job_created
  ON public.service_job_comments (tenant_code, service_job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assignhist_tenant_job_performed
  ON public.service_job_assignment_history (tenant_code, service_job_id, performed_at DESC);
