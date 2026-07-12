
CREATE TABLE public.service_hub_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  email text NOT NULL,
  granted_by text,
  is_bootstrap boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX service_hub_admins_tenant_email_unique
  ON public.service_hub_admins (tenant_code, lower(email));
CREATE INDEX service_hub_admins_tenant_idx
  ON public.service_hub_admins (tenant_code);

GRANT ALL ON public.service_hub_admins TO service_role;

ALTER TABLE public.service_hub_admins ENABLE ROW LEVEL SECURITY;
-- Deny-default: access is only via server functions using service_role.
-- No anon/authenticated policies. All reads/writes go through the
-- ServiceHub server-side admin guard.

CREATE TRIGGER service_hub_admins_set_updated_at
  BEFORE UPDATE ON public.service_hub_admins
  FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();
