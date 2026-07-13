
-- Phase 1.0.1 — Transaction detail snapshots + renewal event history.

-- 1. Sales Invoice detail lines (tenant-scoped, lightweight audit copy).
CREATE TABLE IF NOT EXISTS public.sales_invoice_line_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  n3_document_id text NOT NULL,
  n3_line_id text NOT NULL,
  document_no text,
  document_date date,
  document_status text,
  customer_code text,
  customer_name text,
  line_no integer,
  stock_code text,
  stock_name text,
  description text,
  quantity numeric,
  uom text,
  is_void boolean NOT NULL DEFAULT false,
  is_deleted_in_source boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_code, n3_document_id, n3_line_id)
);

CREATE INDEX IF NOT EXISTS sales_inv_line_tenant_doc_idx
  ON public.sales_invoice_line_snapshots (tenant_code, n3_document_id);
CREATE INDEX IF NOT EXISTS sales_inv_line_tenant_customer_idx
  ON public.sales_invoice_line_snapshots (tenant_code, customer_code);
CREATE INDEX IF NOT EXISTS sales_inv_line_tenant_stock_idx
  ON public.sales_invoice_line_snapshots (tenant_code, stock_code);
CREATE INDEX IF NOT EXISTS sales_inv_line_tenant_date_idx
  ON public.sales_invoice_line_snapshots (tenant_code, document_date);

GRANT ALL ON public.sales_invoice_line_snapshots TO service_role;
ALTER TABLE public.sales_invoice_line_snapshots ENABLE ROW LEVEL SECURITY;
-- Deny-default: no policies. Server access via service_role only.

CREATE TRIGGER sh_sales_inv_line_updated
  BEFORE UPDATE ON public.sales_invoice_line_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();


-- 2. Delivery Order detail lines.
CREATE TABLE IF NOT EXISTS public.delivery_order_line_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  n3_document_id text NOT NULL,
  n3_line_id text NOT NULL,
  document_no text,
  document_date date,
  document_status text,
  customer_code text,
  customer_name text,
  line_no integer,
  stock_code text,
  stock_name text,
  description text,
  quantity numeric,
  uom text,
  is_void boolean NOT NULL DEFAULT false,
  is_deleted_in_source boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_code, n3_document_id, n3_line_id)
);

CREATE INDEX IF NOT EXISTS do_line_tenant_doc_idx
  ON public.delivery_order_line_snapshots (tenant_code, n3_document_id);
CREATE INDEX IF NOT EXISTS do_line_tenant_customer_idx
  ON public.delivery_order_line_snapshots (tenant_code, customer_code);
CREATE INDEX IF NOT EXISTS do_line_tenant_stock_idx
  ON public.delivery_order_line_snapshots (tenant_code, stock_code);
CREATE INDEX IF NOT EXISTS do_line_tenant_date_idx
  ON public.delivery_order_line_snapshots (tenant_code, document_date);

GRANT ALL ON public.delivery_order_line_snapshots TO service_role;
ALTER TABLE public.delivery_order_line_snapshots ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER sh_do_line_updated
  BEFORE UPDATE ON public.delivery_order_line_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();


-- 3. Renewal event history — one row per qualifying mapped renewal line.
CREATE TABLE IF NOT EXISTS public.subscription_renewal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  customer_code text NOT NULL,
  customer_name text,
  subscription_category_id uuid,
  subscription_category_name text NOT NULL,
  stock_code text NOT NULL,
  stock_name text,
  source_type text NOT NULL CHECK (source_type IN ('invoice','delivery_order')),
  source_document_id text NOT NULL,
  source_document_no text,
  source_document_date date NOT NULL,
  source_line_id text NOT NULL,
  renewal_cycle_value integer NOT NULL,
  renewal_cycle_unit text NOT NULL CHECK (renewal_cycle_unit IN ('day','month','year')),
  start_date date NOT NULL,
  expiry_date date NOT NULL,
  is_source_void boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_code, source_document_id, source_line_id)
);

CREATE INDEX IF NOT EXISTS sre_tenant_customer_category_idx
  ON public.subscription_renewal_events (tenant_code, customer_code, subscription_category_name);
CREATE INDEX IF NOT EXISTS sre_tenant_expiry_idx
  ON public.subscription_renewal_events (tenant_code, expiry_date);

GRANT ALL ON public.subscription_renewal_events TO service_role;
ALTER TABLE public.subscription_renewal_events ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER sh_sre_updated
  BEFORE UPDATE ON public.subscription_renewal_events
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();


-- 4. Sync log: extended per-run counters (detail requests, mapped/unmapped
--    lines, voided documents, etc.).
ALTER TABLE public.snapshot_sync_logs
  ADD COLUMN IF NOT EXISTS details jsonb;


-- 5. Current subscription snapshot: link back to the winning source line so
--    the Administrator verification tool can trace end-to-end.
ALTER TABLE public.customer_subscription_snapshots
  ADD COLUMN IF NOT EXISTS latest_source_document_id text,
  ADD COLUMN IF NOT EXISTS latest_source_line_id text;
