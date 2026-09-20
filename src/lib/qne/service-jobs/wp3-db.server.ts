// WP3 — narrow, server-only accessor for schema the candidate migration ADDS
// but which has NOT been applied to the live database yet.
//
// docs/migrations/WP3_simple_atomic_completion.candidate.sql adds the
// server-owned actor/timestamp columns on public.service_job_completions and
// the atomic RPC public.sh_job_complete_simple. Until that candidate is
// applied, the generated Supabase types (read-only) do not describe them, so
// WP3 reaches them through this deliberately small accessor rather than
// faking generated types.
//
// Nothing here bypasses tenant scoping: every call site still filters by the
// tenant_code resolved from the authenticated N3 session.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { PendingClient } from "./wp2c-db.server";

export const wp3Schema = supabaseAdmin as unknown as PendingClient;

export const COMPLETIONS_TABLE = "service_job_completions";
export const COMPLETE_JOB_RPC = "sh_job_complete_simple";
export const ONSITE_ATTENDANCE_TABLE_REF = "service_job_onsite_attendance";
