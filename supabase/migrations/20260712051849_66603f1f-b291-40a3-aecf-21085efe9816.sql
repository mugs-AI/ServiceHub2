-- Snapshot sync audit log + unique constraints needed for upserts

CREATE TABLE public.snapshot_sync_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_code TEXT NOT NULL,
  snapshot_type TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.snapshot_sync_logs TO service_role;
ALTER TABLE public.snapshot_sync_logs ENABLE ROW LEVEL SECURITY;
-- deny-default: no anon/authenticated policies. Only service_role (server) writes/reads.

CREATE INDEX idx_snapshot_sync_logs_tenant_type
  ON public.snapshot_sync_logs (tenant_code, snapshot_type, started_at DESC);

-- Tenant-scoped uniqueness for upserts (idempotent if already present)
CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_snapshots_tenant_code
  ON public.customer_snapshots (tenant_code, customer_code);

CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_snapshots_tenant_code
  ON public.stock_snapshots (tenant_code, stock_code);

CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_contract_snapshots_tenant_customer
  ON public.customer_contract_snapshots (tenant_code, customer_code);

CREATE UNIQUE INDEX IF NOT EXISTS ux_renewal_stock_mappings_tenant_stock
  ON public.renewal_stock_mappings (tenant_code, stock_code);
