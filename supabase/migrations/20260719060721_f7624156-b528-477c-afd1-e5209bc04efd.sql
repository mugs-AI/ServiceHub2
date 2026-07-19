ALTER TABLE public.subscription_renewal_events
  ADD COLUMN IF NOT EXISTS quantity_used integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.subscription_renewal_events.quantity_used IS
  'Phase 1.1.6c: effective renewal quantity applied to the configured cycle. Line qty=2 with a 1-year cycle produces a 2-year effective duration.';