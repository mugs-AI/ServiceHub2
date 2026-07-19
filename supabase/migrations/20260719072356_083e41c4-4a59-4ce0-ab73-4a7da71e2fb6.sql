
-- Phase 1.1.6c correction migration.

-- 1) Support fractional quantities in renewal events.
ALTER TABLE public.subscription_renewal_events
  ALTER COLUMN quantity_used TYPE numeric(18,6) USING quantity_used::numeric(18,6);
ALTER TABLE public.subscription_renewal_events
  ALTER COLUMN quantity_used SET DEFAULT 1;

-- 2) Real, non-partial unique constraint on (tenant_code, n3_stock_id) so
-- .upsert({ onConflict: "tenant_code,n3_stock_id" }) works. The prior partial
-- unique index cannot be used as an ON CONFLICT target without a matching
-- WHERE clause (which supabase-js does not emit), producing 42P10.
UPDATE public.renewal_stock_mappings
   SET n3_stock_id = 'legacy:' || id::text
 WHERE n3_stock_id IS NULL OR btrim(n3_stock_id) = '';

ALTER TABLE public.renewal_stock_mappings
  ALTER COLUMN n3_stock_id SET NOT NULL;

DROP INDEX IF EXISTS public.renewal_stock_mappings_tenant_n3id_uidx;

ALTER TABLE public.renewal_stock_mappings
  ADD CONSTRAINT renewal_stock_mappings_tenant_n3id_key
  UNIQUE (tenant_code, n3_stock_id);
