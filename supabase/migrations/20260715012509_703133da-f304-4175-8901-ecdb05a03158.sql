
-- Phase 1.1.2 Pass 3: Complete Identity Migration

-- 1. Drop code-based unique constraints on customer_snapshots. Keep the code
--    columns and a plain btree index for search performance; permanent
--    identity is (tenant_code, n3_customer_id).
ALTER TABLE public.customer_snapshots
  DROP CONSTRAINT IF EXISTS customer_snapshots_tenant_code_customer_code_key;
DROP INDEX IF EXISTS public.ux_customer_snapshots_tenant_code;

-- 2. Same for stock_snapshots.
ALTER TABLE public.stock_snapshots
  DROP CONSTRAINT IF EXISTS stock_snapshots_tenant_code_stock_code_key;
DROP INDEX IF EXISTS public.ux_stock_snapshots_tenant_code;

-- 3. Same for renewal_stock_mappings.
ALTER TABLE public.renewal_stock_mappings
  DROP CONSTRAINT IF EXISTS renewal_stock_mappings_tenant_code_stock_code_key;
DROP INDEX IF EXISTS public.ux_renewal_stock_mappings_tenant_stock;

-- 4. Backfill renewal_stock_mappings.n3_stock_id from stock_snapshots by code.
--    Only writes when the mapping row lacks an ID and exactly one stock
--    snapshot matches by tenant + code.
UPDATE public.renewal_stock_mappings m
   SET n3_stock_id = s.n3_stock_id,
       stock_name  = COALESCE(m.stock_name, s.stock_name)
  FROM public.stock_snapshots s
 WHERE m.n3_stock_id IS NULL
   AND s.n3_stock_id IS NOT NULL
   AND s.tenant_code = m.tenant_code
   AND s.stock_code  = m.stock_code;

-- 5. Log any resolutions into snapshot_identity_backfill (best-effort audit).
INSERT INTO public.snapshot_identity_backfill
  (tenant_code, entity_type, entity_id, natural_key, n3_id,
   match_method, confidence, migration_status, notes)
SELECT m.tenant_code, 'renewal_mapping', m.id, m.stock_code, m.n3_stock_id,
       'exact_tenant_code_match', 'high', 'resolved',
       'Backfilled from stock_snapshots during Pass 3 migration'
  FROM public.renewal_stock_mappings m
 WHERE m.n3_stock_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.snapshot_identity_backfill b
      WHERE b.entity_type = 'renewal_mapping' AND b.entity_id = m.id
   );

-- 6. Orchestration table for unified "Sync N3 Data & Recalculate" runs.
CREATE TABLE IF NOT EXISTS public.sync_orchestrations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code              text NOT NULL,
  orchestration_type       text NOT NULL DEFAULT 'full',
  overall_status           text NOT NULL DEFAULT 'queued',
  current_stage            text,
  current_stage_index      integer NOT NULL DEFAULT 0,
  total_stages             integer NOT NULL DEFAULT 9,
  current_stage_progress   jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_run_id          uuid,
  stock_run_id             uuid,
  subscription_run_id      uuid,
  customer_result          jsonb,
  stock_result             jsonb,
  subscription_result      jsonb,
  safe_error_summary       text,
  started_at               timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at        timestamptz NOT NULL DEFAULT now(),
  completed_at             timestamptz,
  total_duration_ms        integer,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sync_orchestrations TO authenticated;
GRANT ALL    ON public.sync_orchestrations TO service_role;

ALTER TABLE public.sync_orchestrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_orchestrations service write"
  ON public.sync_orchestrations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "sync_orchestrations tenant read"
  ON public.sync_orchestrations
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS sync_orchestrations_tenant_running_idx
  ON public.sync_orchestrations (tenant_code, overall_status)
  WHERE overall_status IN ('queued','running');

CREATE INDEX IF NOT EXISTS sync_orchestrations_tenant_started_idx
  ON public.sync_orchestrations (tenant_code, started_at DESC);

CREATE TRIGGER sync_orchestrations_touch
  BEFORE UPDATE ON public.sync_orchestrations
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();
