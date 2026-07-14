
-- Phase 1.1.2 — Identity Hardening: add immutable N3 IDs across snapshot tables.
-- Additive only. Existing unique constraints on code-based keys stay in place
-- until Pass 2 backfill verification. Partial unique indexes enforce ID uniqueness
-- where the ID has been populated.

-- ============ Customer ============
ALTER TABLE public.customer_snapshots
  ADD COLUMN IF NOT EXISTS n3_customer_id text;

CREATE UNIQUE INDEX IF NOT EXISTS customer_snapshots_tenant_n3id_uidx
  ON public.customer_snapshots (tenant_code, n3_customer_id)
  WHERE n3_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_snapshots_tenant_code_idx
  ON public.customer_snapshots (tenant_code, customer_code);

-- ============ Stock ============
ALTER TABLE public.stock_snapshots
  ADD COLUMN IF NOT EXISTS n3_stock_id text;

CREATE UNIQUE INDEX IF NOT EXISTS stock_snapshots_tenant_n3id_uidx
  ON public.stock_snapshots (tenant_code, n3_stock_id)
  WHERE n3_stock_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS stock_snapshots_tenant_code_idx
  ON public.stock_snapshots (tenant_code, stock_code);

-- ============ Renewal stock mappings ============
ALTER TABLE public.renewal_stock_mappings
  ADD COLUMN IF NOT EXISTS n3_stock_id text,
  ADD COLUMN IF NOT EXISTS stock_name text;

CREATE UNIQUE INDEX IF NOT EXISTS renewal_stock_mappings_tenant_n3id_uidx
  ON public.renewal_stock_mappings (tenant_code, n3_stock_id)
  WHERE n3_stock_id IS NOT NULL;

-- ============ Sales invoice line snapshots ============
ALTER TABLE public.sales_invoice_line_snapshots
  ADD COLUMN IF NOT EXISTS n3_stock_id text,
  ADD COLUMN IF NOT EXISTS n3_customer_id text,
  ADD COLUMN IF NOT EXISTS stock_code_at_transaction text,
  ADD COLUMN IF NOT EXISTS stock_name_at_transaction text,
  ADD COLUMN IF NOT EXISTS customer_code_at_transaction text,
  ADD COLUMN IF NOT EXISTS customer_name_at_transaction text;

CREATE INDEX IF NOT EXISTS sales_invoice_line_tenant_stockid_idx
  ON public.sales_invoice_line_snapshots (tenant_code, n3_stock_id)
  WHERE n3_stock_id IS NOT NULL;

-- ============ Delivery order line snapshots ============
ALTER TABLE public.delivery_order_line_snapshots
  ADD COLUMN IF NOT EXISTS n3_stock_id text,
  ADD COLUMN IF NOT EXISTS n3_customer_id text,
  ADD COLUMN IF NOT EXISTS stock_code_at_transaction text,
  ADD COLUMN IF NOT EXISTS stock_name_at_transaction text,
  ADD COLUMN IF NOT EXISTS customer_code_at_transaction text,
  ADD COLUMN IF NOT EXISTS customer_name_at_transaction text;

CREATE INDEX IF NOT EXISTS delivery_order_line_tenant_stockid_idx
  ON public.delivery_order_line_snapshots (tenant_code, n3_stock_id)
  WHERE n3_stock_id IS NOT NULL;

-- ============ Subscription renewal events ============
ALTER TABLE public.subscription_renewal_events
  ADD COLUMN IF NOT EXISTS n3_customer_id text,
  ADD COLUMN IF NOT EXISTS n3_stock_id text,
  ADD COLUMN IF NOT EXISTS n3_document_id text,
  ADD COLUMN IF NOT EXISTS n3_line_id text,
  ADD COLUMN IF NOT EXISTS customer_code_at_event text,
  ADD COLUMN IF NOT EXISTS customer_name_at_event text,
  ADD COLUMN IF NOT EXISTS stock_code_at_event text,
  ADD COLUMN IF NOT EXISTS stock_name_at_event text,
  ADD COLUMN IF NOT EXISTS document_no_at_event text;

CREATE INDEX IF NOT EXISTS subscription_renewal_events_ids_idx
  ON public.subscription_renewal_events (tenant_code, n3_customer_id, n3_stock_id)
  WHERE n3_customer_id IS NOT NULL AND n3_stock_id IS NOT NULL;

-- ============ Customer subscription snapshots ============
ALTER TABLE public.customer_subscription_snapshots
  ADD COLUMN IF NOT EXISTS n3_customer_id text,
  ADD COLUMN IF NOT EXISTS n3_stock_id text;

CREATE UNIQUE INDEX IF NOT EXISTS customer_subscription_snapshots_id_uidx
  ON public.customer_subscription_snapshots (tenant_code, n3_customer_id, subscription_category, n3_stock_id)
  WHERE n3_customer_id IS NOT NULL AND n3_stock_id IS NOT NULL;

-- ============ Customer contract snapshots (legacy) ============
ALTER TABLE public.customer_contract_snapshots
  ADD COLUMN IF NOT EXISTS n3_customer_id text,
  ADD COLUMN IF NOT EXISTS n3_stock_id text,
  ADD COLUMN IF NOT EXISTS n3_document_id text;

-- ============ Identity backfill report ============
CREATE TABLE IF NOT EXISTS public.snapshot_identity_backfill (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  entity_type text NOT NULL,           -- 'customer' | 'stock' | 'sales_invoice_line' | 'delivery_order_line' | 'renewal_mapping' | 'subscription' | 'renewal_event'
  entity_id uuid,                       -- row id in the source table (nullable for aggregates)
  natural_key text,                     -- e.g. customer_code / stock_code / document_no
  n3_id text,                           -- resolved N3 ID, if any
  match_method text NOT NULL,           -- 'already_had_id' | 'exact_code' | 'from_transaction' | 'manual' | 'unresolved' | 'ambiguous'
  confidence text NOT NULL,             -- 'high' | 'medium' | 'low'
  migration_status text NOT NULL,       -- 'backfilled' | 'unchanged' | 'ambiguous' | 'missing' | 'needs_review'
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.snapshot_identity_backfill TO authenticated;
GRANT ALL ON public.snapshot_identity_backfill TO service_role;
ALTER TABLE public.snapshot_identity_backfill ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backfill_report tenant read" ON public.snapshot_identity_backfill
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "backfill_report service write" ON public.snapshot_identity_backfill
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS snapshot_identity_backfill_tenant_entity_idx
  ON public.snapshot_identity_backfill (tenant_code, entity_type, created_at DESC);

-- ============ Sync run orchestration (for Run All progress panel) ============
CREATE TABLE IF NOT EXISTS public.sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  kind text NOT NULL,                   -- 'run_all' | 'customers' | 'stock' | 'contracts' | 'subscriptions'
  status text NOT NULL,                 -- 'running' | 'success' | 'partial' | 'failed'
  current_stage text,
  current_stage_index int NOT NULL DEFAULT 0,
  total_stages int NOT NULL DEFAULT 1,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms int,
  error_message text,
  summary jsonb
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_runs TO authenticated;
GRANT ALL ON public.sync_runs TO service_role;
ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync_runs tenant read" ON public.sync_runs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sync_runs service write" ON public.sync_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS sync_runs_tenant_started_idx
  ON public.sync_runs (tenant_code, started_at DESC);
CREATE INDEX IF NOT EXISTS sync_runs_tenant_running_idx
  ON public.sync_runs (tenant_code, status) WHERE status = 'running';

CREATE TRIGGER sync_runs_updated_at
  BEFORE UPDATE ON public.sync_runs
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();
