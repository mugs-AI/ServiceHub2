
-- ServiceHub2 Phase 0.5: Persistent Foundation
-- Auth model: this app authenticates end-users via N3 JWT (not Supabase Auth).
-- All ServiceHub tables are tenant-scoped by N3 tenant_code and accessed
-- server-side through the same-origin proxy / server functions using the
-- service_role key. RLS is ENABLED with a restrictive default so that no
-- browser client (anon/authenticated) can reach these tables directly; only
-- service_role (which bypasses RLS) may read/write. Placeholder policies for
-- future Supabase-authenticated users are included but disabled-by-default
-- (they reference a tenant_code claim that does not exist yet).

-- ---------- helper: updated_at trigger ----------
CREATE OR REPLACE FUNCTION public.sh_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------- 1. customer_snapshots ----------
CREATE TABLE public.customer_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code TEXT NOT NULL,
  customer_code TEXT NOT NULL,
  customer_name TEXT,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  n3_status TEXT,
  last_synced_at TIMESTAMPTZ,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_code, customer_code)
);
CREATE INDEX customer_snapshots_tenant_idx ON public.customer_snapshots (tenant_code);
GRANT ALL ON public.customer_snapshots TO service_role;
ALTER TABLE public.customer_snapshots ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER customer_snapshots_touch BEFORE UPDATE ON public.customer_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

-- ---------- 2. customer_contract_snapshots ----------
CREATE TABLE public.customer_contract_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code TEXT NOT NULL,
  customer_code TEXT NOT NULL,
  latest_document_type TEXT,
  latest_document_no TEXT,
  latest_document_date DATE,
  renewal_stock_code TEXT,
  contract_days INTEGER,
  contract_start_date DATE,
  expiry_date DATE,
  remaining_days INTEGER,
  contract_status TEXT NOT NULL DEFAULT 'Unknown',
  last_calculated_at TIMESTAMPTZ,
  is_stale BOOLEAN NOT NULL DEFAULT true,
  calculation_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_code, customer_code)
);
CREATE INDEX contract_snapshots_tenant_idx ON public.customer_contract_snapshots (tenant_code);
CREATE INDEX contract_snapshots_status_idx ON public.customer_contract_snapshots (tenant_code, contract_status);
GRANT ALL ON public.customer_contract_snapshots TO service_role;
ALTER TABLE public.customer_contract_snapshots ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER contract_snapshots_touch BEFORE UPDATE ON public.customer_contract_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

-- ---------- 3. stock_snapshots ----------
CREATE TABLE public.stock_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_code, stock_code)
);
CREATE INDEX stock_snapshots_tenant_idx ON public.stock_snapshots (tenant_code);
GRANT ALL ON public.stock_snapshots TO service_role;
ALTER TABLE public.stock_snapshots ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER stock_snapshots_touch BEFORE UPDATE ON public.stock_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

-- ---------- 4. renewal_stock_mappings ----------
CREATE TABLE public.renewal_stock_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  service_type TEXT NOT NULL CHECK (service_type IN ('Renewal','Ad Hoc')),
  contract_days INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_code, stock_code)
);
CREATE INDEX renewal_mappings_tenant_idx ON public.renewal_stock_mappings (tenant_code);
GRANT ALL ON public.renewal_stock_mappings TO service_role;
ALTER TABLE public.renewal_stock_mappings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER renewal_mappings_touch BEFORE UPDATE ON public.renewal_stock_mappings
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

-- ---------- 5. general_settings ----------
CREATE TABLE public.general_settings (
  tenant_code TEXT PRIMARY KEY,
  due_soon_days INTEGER NOT NULL DEFAULT 30,
  assigned_user_label TEXT NOT NULL DEFAULT 'Assignee',
  default_assignment_mode TEXT NOT NULL DEFAULT 'manual',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.general_settings TO service_role;
ALTER TABLE public.general_settings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER general_settings_touch BEFORE UPDATE ON public.general_settings
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

-- ---------- 6. notifications ----------
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code TEXT NOT NULL,
  user_email TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  related_module TEXT,
  related_id TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_tenant_user_idx ON public.notifications (tenant_code, user_email, is_read);
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ---------- RLS: default DENY for anon/authenticated ----------
-- No permissive policies for anon or authenticated roles are created. RLS is
-- enabled with no matching policies, so browser-side (anon / authenticated)
-- queries return zero rows and are rejected for writes. service_role bypasses
-- RLS by design and is the only path used by server-side code today.
--
-- When Supabase Auth is introduced later and JWTs carry a `tenant_code` claim,
-- add tenant-scoped policies of the shape:
--   USING ((auth.jwt() ->> 'tenant_code') = tenant_code)
-- for each table above, plus role-gated WITH CHECK clauses. Do not add
-- permissive policies before that claim exists.
