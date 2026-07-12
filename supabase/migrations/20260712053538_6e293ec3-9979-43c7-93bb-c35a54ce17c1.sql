CREATE TABLE public.snapshot_health (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_code text NOT NULL,
  snapshot_type text NOT NULL,
  health_status text NOT NULL DEFAULT 'Healthy',
  last_successful_sync timestamptz,
  last_attempt timestamptz,
  records_total integer NOT NULL DEFAULT 0,
  records_inserted integer NOT NULL DEFAULT 0,
  records_updated integer NOT NULL DEFAULT 0,
  records_failed integer NOT NULL DEFAULT 0,
  stale_records integer NOT NULL DEFAULT 0,
  calculation_errors integer NOT NULL DEFAULT 0,
  warning_message text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT snapshot_health_tenant_type_unique UNIQUE (tenant_code, snapshot_type),
  CONSTRAINT snapshot_health_status_chk CHECK (health_status IN ('Healthy','Warning','Error')),
  CONSTRAINT snapshot_health_type_chk CHECK (snapshot_type IN ('Customers','Stock','Contract'))
);

GRANT ALL ON public.snapshot_health TO service_role;

ALTER TABLE public.snapshot_health ENABLE ROW LEVEL SECURITY;

-- Deny-default: no policies for anon/authenticated. Service role bypasses RLS.

CREATE TRIGGER snapshot_health_set_updated_at
BEFORE UPDATE ON public.snapshot_health
FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();

CREATE INDEX snapshot_health_tenant_idx ON public.snapshot_health (tenant_code);
