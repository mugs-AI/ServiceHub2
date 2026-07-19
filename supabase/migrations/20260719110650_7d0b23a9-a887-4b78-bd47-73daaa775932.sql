
-- Milestone 2.0.1 — Service Job Foundation
-- Two new tenant-scoped tables:
--   service_jobs                  — the job header
--   job_number_sequences          — daily counter used to atomically mint
--                                    tenant-scoped job numbers JByyMMddnn
-- Concurrency-safe via an INSERT ... ON CONFLICT ... RETURNING RPC.

CREATE TABLE public.job_number_sequences (
  tenant_code text NOT NULL,
  date_key    text NOT NULL,   -- yyMMdd, tenant/server local
  last_seq    integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_code, date_key)
);

GRANT SELECT ON public.job_number_sequences TO service_role;
GRANT ALL    ON public.job_number_sequences TO service_role;
ALTER TABLE public.job_number_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job_number_sequences service role only"
  ON public.job_number_sequences FOR ALL USING (false) WITH CHECK (false);

-- Atomic increment. UPSERT with RETURNING is a single statement, so
-- concurrent callers serialise on the row lock and each receives a unique
-- sequence value.
CREATE OR REPLACE FUNCTION public.sh_next_job_number(
  p_tenant_code text,
  p_date_key    text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq integer;
BEGIN
  INSERT INTO public.job_number_sequences (tenant_code, date_key, last_seq)
       VALUES (p_tenant_code, p_date_key, 1)
  ON CONFLICT (tenant_code, date_key)
    DO UPDATE SET last_seq = job_number_sequences.last_seq + 1,
                  updated_at = now()
  RETURNING last_seq INTO v_seq;
  RETURN v_seq;
END;
$$;

CREATE TABLE public.service_jobs (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code                     text NOT NULL,
  job_number                      text NOT NULL,

  -- Customer identity (immutable N3 ID + display snapshot)
  n3_customer_id                  text,
  customer_code_snapshot          text NOT NULL,
  customer_name_snapshot          text,

  -- Contact
  contact_person                  text,
  contact_phone                   text,
  contact_email                   text,
  service_address                 text,

  -- Job details
  subject                         text NOT NULL,
  problem_description             text NOT NULL,
  status                          text NOT NULL DEFAULT 'Draft',   -- Draft | Pending Approval
  priority                        text NOT NULL DEFAULT 'Medium',  -- High | Medium | Low
  source                          text NOT NULL DEFAULT 'Phone',   -- Phone | WhatsApp | Email | Walk-in | Remote Support | Other

  -- Entitlement gate
  requires_approval               boolean NOT NULL DEFAULT false,
  approval_reason                 text,   -- 'Overdue Entitlement' | 'No Active Entitlement' | null

  -- Optional entitlement snapshot (audit only; never mutates source)
  subscription_snapshot_id        uuid,
  subscription_category_snapshot  text,
  n3_stock_id_snapshot            text,
  stock_code_snapshot             text,
  entitlement_expiry_snapshot     date,
  entitlement_status_snapshot     text,

  internal_note                   text,

  -- Audit
  created_by_user_id              text,
  created_by_name                 text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT service_jobs_tenant_number_uidx UNIQUE (tenant_code, job_number),
  CONSTRAINT service_jobs_status_chk    CHECK (status   IN ('Draft','Pending Approval')),
  CONSTRAINT service_jobs_priority_chk  CHECK (priority IN ('High','Medium','Low')),
  CONSTRAINT service_jobs_source_chk    CHECK (source   IN ('Phone','WhatsApp','Email','Walk-in','Remote Support','Other'))
);

CREATE INDEX service_jobs_tenant_created_idx  ON public.service_jobs (tenant_code, created_at DESC);
CREATE INDEX service_jobs_tenant_customer_idx ON public.service_jobs (tenant_code, customer_code_snapshot);
CREATE INDEX service_jobs_tenant_status_idx   ON public.service_jobs (tenant_code, status);

GRANT ALL ON public.service_jobs TO service_role;
ALTER TABLE public.service_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_jobs service role only"
  ON public.service_jobs FOR ALL USING (false) WITH CHECK (false);

CREATE TRIGGER service_jobs_touch
BEFORE UPDATE ON public.service_jobs
FOR EACH ROW EXECUTE FUNCTION public.sh_set_updated_at();
