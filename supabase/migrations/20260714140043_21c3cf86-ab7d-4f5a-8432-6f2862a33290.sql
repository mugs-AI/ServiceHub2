
ALTER TABLE public.sync_locks
  ADD COLUMN IF NOT EXISTS run_id uuid,
  ADD COLUMN IF NOT EXISTS sync_log_id uuid,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'running';

ALTER TABLE public.snapshot_sync_logs
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS progress jsonb;
