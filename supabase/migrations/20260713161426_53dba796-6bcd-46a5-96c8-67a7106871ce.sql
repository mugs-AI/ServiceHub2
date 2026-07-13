
-- Phase 1.0.3: classify line snapshots by line_type and track stable ordering.
-- Columns are additive; existing rows default to sensible values and will be
-- reclassified on the next subscription sync.

ALTER TABLE public.sales_invoice_line_snapshots
  ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS has_stock_code BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_line_id TEXT,
  ADD COLUMN IF NOT EXISTS source_line_order INTEGER,
  ADD COLUMN IF NOT EXISTS is_void_source BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.delivery_order_line_snapshots
  ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS has_stock_code BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_line_id TEXT,
  ADD COLUMN IF NOT EXISTS source_line_order INTEGER,
  ADD COLUMN IF NOT EXISTS is_void_source BOOLEAN NOT NULL DEFAULT false;

-- Restrict line_type to the allowed set.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoice_line_snapshots_line_type_chk') THEN
    ALTER TABLE public.sales_invoice_line_snapshots
      ADD CONSTRAINT sales_invoice_line_snapshots_line_type_chk
      CHECK (line_type IN ('stock','description','serial_or_reference','child_detail','unknown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_order_line_snapshots_line_type_chk') THEN
    ALTER TABLE public.delivery_order_line_snapshots
      ADD CONSTRAINT delivery_order_line_snapshots_line_type_chk
      CHECK (line_type IN ('stock','description','serial_or_reference','child_detail','unknown'));
  END IF;
END $$;

-- Backfill has_stock_code + is_void_source from existing columns so
-- diagnostics remain accurate before the next sync run reclassifies.
UPDATE public.sales_invoice_line_snapshots
   SET has_stock_code = (stock_code IS NOT NULL AND btrim(stock_code) <> ''),
       is_void_source = COALESCE(is_void, false);
UPDATE public.delivery_order_line_snapshots
   SET has_stock_code = (stock_code IS NOT NULL AND btrim(stock_code) <> ''),
       is_void_source = COALESCE(is_void, false);

-- Best-effort backfill of line_type from what we already have.
UPDATE public.sales_invoice_line_snapshots
   SET line_type = CASE
     WHEN has_stock_code THEN 'stock'
     WHEN COALESCE(btrim(description), '') <> '' THEN 'description'
     ELSE 'unknown'
   END
 WHERE line_type = 'unknown';

UPDATE public.delivery_order_line_snapshots
   SET line_type = CASE
     WHEN has_stock_code THEN 'stock'
     WHEN COALESCE(btrim(description), '') <> '' THEN 'description'
     ELSE 'unknown'
   END
 WHERE line_type = 'unknown';
