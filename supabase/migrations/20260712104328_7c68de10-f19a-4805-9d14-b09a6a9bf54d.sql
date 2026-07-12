
CREATE TABLE public.report_access_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_code TEXT NOT NULL,
  report_code TEXT NOT NULL,
  report_name TEXT NOT NULL,
  visible_to_normal_users BOOLEAN NOT NULL DEFAULT false,
  allow_print BOOLEAN NOT NULL DEFAULT false,
  allow_excel BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_code, report_code)
);

GRANT ALL ON public.report_access_rules TO service_role;

ALTER TABLE public.report_access_rules ENABLE ROW LEVEL SECURITY;

-- No policies: deny-default. All access is server-side via service_role,
-- matching the existing snapshot/health tables pattern under the current
-- N3-auth model (see Phase 0.5/0.9).

CREATE TRIGGER trg_report_access_rules_updated_at
  BEFORE UPDATE ON public.report_access_rules
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

CREATE INDEX idx_report_access_rules_tenant ON public.report_access_rules(tenant_code, display_order);
