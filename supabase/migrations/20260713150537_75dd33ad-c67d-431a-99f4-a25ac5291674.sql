
CREATE TABLE public.sync_locks (
  tenant_code text NOT NULL,
  snapshot_type text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  acquired_by text,
  PRIMARY KEY (tenant_code, snapshot_type)
);
GRANT ALL ON public.sync_locks TO service_role;
ALTER TABLE public.sync_locks ENABLE ROW LEVEL SECURITY;
-- No policies: only trusted server code (service_role) touches this table.
