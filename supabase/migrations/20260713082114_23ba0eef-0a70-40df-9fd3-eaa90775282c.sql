
-- Phase 1.0 — Customer Subscription Engine
-- Adds tenant-managed subscription categories, extends renewal_stock_mappings
-- with subscription category + renewal cycle, and creates the
-- customer_subscription_snapshots table (one row per customer + category).

-- 1. subscription_categories (tenant-managed master; seed defaults)
CREATE TABLE IF NOT EXISTS public.subscription_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  name text NOT NULL,
  display_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_code, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscription_categories TO authenticated;
GRANT ALL ON public.subscription_categories TO service_role;

ALTER TABLE public.subscription_categories ENABLE ROW LEVEL SECURITY;

-- Deny-default; server code uses service_role, matching sibling tables.
CREATE POLICY "subscription_categories service role only"
  ON public.subscription_categories FOR ALL
  USING (false) WITH CHECK (false);

CREATE TRIGGER trg_subscription_categories_updated_at
  BEFORE UPDATE ON public.subscription_categories
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

-- 2. Extend renewal_stock_mappings for subscription category + cycle.
ALTER TABLE public.renewal_stock_mappings
  ADD COLUMN IF NOT EXISTS subscription_category text,
  ADD COLUMN IF NOT EXISTS renewal_cycle_value integer,
  ADD COLUMN IF NOT EXISTS renewal_cycle_unit text;

-- Backfill existing rows: preserve contract_days as Day cycle under
-- default "Maintenance" category. Only applies to Renewal type.
UPDATE public.renewal_stock_mappings
   SET subscription_category = COALESCE(subscription_category, 'Maintenance'),
       renewal_cycle_value   = COALESCE(renewal_cycle_value, contract_days),
       renewal_cycle_unit    = COALESCE(renewal_cycle_unit, 'day')
 WHERE service_type = 'Renewal';

-- Sanity check constraint: cycle unit ∈ (day, month, year) when present.
ALTER TABLE public.renewal_stock_mappings
  DROP CONSTRAINT IF EXISTS renewal_stock_mappings_cycle_unit_ck;
ALTER TABLE public.renewal_stock_mappings
  ADD CONSTRAINT renewal_stock_mappings_cycle_unit_ck
  CHECK (renewal_cycle_unit IS NULL OR renewal_cycle_unit IN ('day','month','year'));

-- 3. customer_subscription_snapshots — one row per (tenant, customer, category)
CREATE TABLE IF NOT EXISTS public.customer_subscription_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  customer_code text NOT NULL,
  customer_name text,
  subscription_category text NOT NULL,
  stock_code text,
  stock_name text,
  renewal_cycle_value integer,
  renewal_cycle_unit text,
  latest_source_type text,        -- 'invoice' | 'delivery_order'
  latest_document_no text,
  latest_document_date date,
  contract_start_date date,
  expiry_date date,
  remaining_days integer,
  subscription_status text NOT NULL DEFAULT 'Unknown',
  last_calculated_at timestamptz,
  calculation_error text,
  is_stale boolean NOT NULL DEFAULT true,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_code, customer_code, subscription_category)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_subscription_snapshots TO authenticated;
GRANT ALL ON public.customer_subscription_snapshots TO service_role;

ALTER TABLE public.customer_subscription_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_subscription_snapshots service role only"
  ON public.customer_subscription_snapshots FOR ALL
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_css_tenant_customer
  ON public.customer_subscription_snapshots (tenant_code, customer_code);
CREATE INDEX IF NOT EXISTS idx_css_tenant_category
  ON public.customer_subscription_snapshots (tenant_code, subscription_category);
CREATE INDEX IF NOT EXISTS idx_css_tenant_expiry
  ON public.customer_subscription_snapshots (tenant_code, expiry_date);

CREATE TRIGGER trg_css_updated_at
  BEFORE UPDATE ON public.customer_subscription_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();
