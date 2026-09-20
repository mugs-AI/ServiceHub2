// WP3A — narrow, server-only accessor for schema the WP3A candidate migration
// ADDS but which has NOT been applied to the live database yet.
//
// docs/migrations/WP3A_job_operations_correction.candidate.sql adds the latest
// waiting reference columns on public.service_jobs, the completion cycle
// counters, public.service_job_reopen_requests and the RPCs
// sh_job_waiting_set / sh_job_reopen_request / sh_job_reopen_decide. Until the
// candidate is applied, the generated Supabase types (read-only) do not
// describe them, so WP3A reaches them through this deliberately small
// accessor rather than faking generated types.
//
// Nothing here bypasses tenant scoping: every call site still filters by the
// tenant_code resolved from the authenticated N3 session.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { PendingClient } from "./wp2c-db.server";

export const wp3aSchema = supabaseAdmin as unknown as PendingClient;

export const REOPEN_REQUESTS_TABLE = "service_job_reopen_requests";
export const JOBS_TABLE_REF = "service_jobs";

export const WAITING_SET_RPC = "sh_job_waiting_set";
export const REOPEN_REQUEST_RPC = "sh_job_reopen_request";
export const REOPEN_DECIDE_RPC = "sh_job_reopen_decide";
