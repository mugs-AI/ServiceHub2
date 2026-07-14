-- Phase 1.1 — allow multiple independent entitlements per Customer + Category
-- when they use different Stock Codes (e.g. Maintenance + Q-SW-Warranty
-- vs Maintenance + Q-ENT-M5-OPTIMUM). The old unique key collapsed both
-- into one row.
ALTER TABLE public.customer_subscription_snapshots
  DROP CONSTRAINT IF EXISTS customer_subscription_snapsho_tenant_code_customer_code_sub_key;

-- Use a partial-style unique index treating NULLs as equal so legacy rows
-- with NULL stock_code don't produce duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS customer_subscription_snapshots_entitlement_key
  ON public.customer_subscription_snapshots
  (tenant_code, customer_code, subscription_category, stock_code)
  NULLS NOT DISTINCT;