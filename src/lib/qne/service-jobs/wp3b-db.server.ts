// WP3B — narrow, server-only accessor for schema the WP3B candidate migration
// ADDS but which has NOT been applied to the live database yet.
//
// docs/migrations/WP3B_followup_lifecycle.candidate.sql adds
// public.service_job_followups, the projection
// public.service_job_completion_outcomes and the RPC
// public.sh_followup_clear. Until the candidate is applied, the generated
// Supabase types (read-only) do not describe them, so WP3B reaches them
// through this deliberately small accessor rather than faking generated types.
//
// Nothing here bypasses tenant scoping: every call site still filters by the
// tenant_code resolved from the authenticated N3 session.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { PendingClient } from "./wp2c-db.server";

export const wp3bSchema = supabaseAdmin as unknown as PendingClient;

export const FOLLOWUPS_TABLE = "service_job_followups";
export const OUTCOMES_VIEW = "service_job_completion_outcomes";
export const FOLLOWUP_CLEAR_RPC = "sh_followup_clear";
