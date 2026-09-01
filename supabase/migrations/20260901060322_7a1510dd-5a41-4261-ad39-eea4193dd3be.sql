-- WP2B — Google Drive Job Attachments (ADDITIVE CANDIDATE, NOT APPLIED)
--
-- Run ID: SH22-WP2B-BUILD-20260901
--
-- IMPORTANT — why this file is here and not in supabase/migrations/:
-- the build platform refuses direct writes to supabase/migrations/; the only
-- way to create a file there is to EXECUTE the migration, which this build was
-- explicitly forbidden to do. The SQL below is therefore checked in as a
-- reviewable candidate. To apply it, run it through the migration tool
-- verbatim; the generated Supabase types will then regenerate and the
-- temporary accessor in src/lib/qne/storage/wp2b-db.server.ts can be retired.
--
-- No DROP, no RENAME, no destructive backfill, no deletion of legacy
-- attachment rows or legacy Supabase Storage objects.

-- ---------------------------------------------------------------------------
-- 1. Per-tenant / per-job / per-connection Google Drive folder mapping.
--    Server-only: no anon or authenticated policy exists, so the Data API
--    cannot reach it at all; only the service role and postgres can.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_job_job_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  drive_folder_id text NOT NULL,
  container_folder_id text,
  job_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_job_job_folders_unique
    UNIQUE (tenant_code, service_job_id, connection_id)
);

GRANT ALL ON public.service_job_job_folders TO service_role;

ALTER TABLE public.service_job_job_folders ENABLE ROW LEVEL SECURITY;

-- Deliberately deny-all: every read/write goes through server-side code that
-- resolves the tenant from the authenticated N3 session.
CREATE POLICY "job folder mapping is server-only"
  ON public.service_job_job_folders FOR ALL
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS service_job_job_folders_job_idx
  ON public.service_job_job_folders (tenant_code, service_job_id);

DROP TRIGGER IF EXISTS set_service_job_job_folders_updated_at
  ON public.service_job_job_folders;
CREATE TRIGGER set_service_job_job_folders_updated_at
  BEFORE UPDATE ON public.service_job_job_folders
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Truthful remote-delete state on attachment metadata.
--    'n/a'      — no remote object (legacy / disabled provider)
--    'pending'  — remote delete not attempted yet
--    'trashed'  — provider confirmed the file is in Trash
--    'failed'   — provider refused; the attachment stays ACTIVE and visible
-- ---------------------------------------------------------------------------
ALTER TABLE public.service_job_attachments
  ADD COLUMN IF NOT EXISTS remote_delete_status text NOT NULL DEFAULT 'n/a',
  ADD COLUMN IF NOT EXISTS remote_delete_error text,
  ADD COLUMN IF NOT EXISTS remote_deleted_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. Efficient active count / active total per Job.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS service_job_attachments_active_idx
  ON public.service_job_attachments (tenant_code, service_job_id)
  INCLUDE (file_size)
  WHERE is_deleted = false;