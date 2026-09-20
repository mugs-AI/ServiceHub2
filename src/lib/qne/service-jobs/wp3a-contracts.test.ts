// WP3A — source-text contracts for the Job Operations correction.
//
// These guard the security and atomicity boundaries that cannot be exercised
// without a live database: RPC-only mutation, server-derived identity, the
// unapplied candidate migration, the UI layout corrections and the frozen
// areas (Field Operations, generic status bypass, WP2 behaviour).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

const SQL = read("docs", "migrations", "WP3A_job_operations_correction.candidate.sql");
const SERVER = read("src", "lib", "qne", "service-jobs", "wp3a.server.ts");
const WAITING_ROUTE = read("src", "routes", "api", "workspace", "jobs.$jobId.waiting.ts");
const REOPEN_ROUTE = read("src", "routes", "api", "workspace", "jobs.$jobId.reopen.ts");
const DECISION_ROUTE = read("src", "routes", "api", "workspace", "jobs.$jobId.reopen.decision.ts");
const STATUS_ROUTE = read("src", "routes", "api", "workspace", "jobs.$jobId.status.ts");
const JOB_PAGE = read("src", "routes", "jobs.$jobId.tsx");
const CANCEL_PANEL = read("src", "components", "qne", "CancellationPanel.tsx");
const COMPLETION_CARD = read("src", "components", "qne", "SimpleCompletionCard.tsx");
const REOPEN_CARD = read("src", "components", "qne", "JobReopenSection.tsx");
const ATTENDANCE_CARD = read("src", "components", "qne", "OnSiteAttendanceCard.tsx");

describe("candidate migration", () => {
  it("is the single WP3A candidate and is NOT applied", () => {
    expect(
      existsSync(
        join(
          process.cwd(),
          "supabase",
          "migrations",
          "WP3A_job_operations_correction.candidate.sql",
        ),
      ),
    ).toBe(false);
    expect(SQL).toContain("CANDIDATE, NOT APPLIED");
    expect(SQL).toContain("ROLLBACK NOTES");
  });

  it("adds the waiting reference and completion cycle schema additively", () => {
    expect(SQL).toContain("ADD COLUMN IF NOT EXISTS latest_customer_ref_no text");
    expect(SQL).toContain("ADD COLUMN IF NOT EXISTS latest_vendor_ref_no text");
    expect(SQL).toContain("ADD COLUMN IF NOT EXISTS completion_cycle integer NOT NULL DEFAULT 1");
    expect(SQL).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS service_job_completions_cycle_unique_idx",
    );
    expect(SQL).toContain("(tenant_code, service_job_id, completion_cycle)");
    expect(SQL).toContain("DROP INDEX IF EXISTS public.service_job_completions_one_per_job_idx");
  });

  it("removes the old one-per-job uniqueness safely and keeps the primary key", () => {
    // service_job_completion_unique is a UNIQUE CONSTRAINT: DROP INDEX cannot
    // remove it, so the candidate uses a guarded ALTER TABLE ... DROP CONSTRAINT.
    expect(SQL).toContain("DROP CONSTRAINT service_job_completion_unique");
    expect(SQL).toContain("WHERE conname = 'service_job_completion_unique'");
    expect(SQL).toContain("AND contype = 'u'");
    expect(SQL).not.toContain("DROP INDEX IF EXISTS public.service_job_completion_unique");
    // Never touches the primary key.
    expect(SQL).not.toMatch(/DROP CONSTRAINT\s+service_job_completions_pkey/);

    // The replacement uniqueness must exist before the old rules are removed.
    const newIndexAt = SQL.indexOf("service_job_completions_cycle_unique_idx");
    const dropConstraintAt = SQL.indexOf("DROP CONSTRAINT service_job_completion_unique");
    const dropIndexAt = SQL.indexOf(
      "DROP INDEX IF EXISTS public.service_job_completions_one_per_job_idx",
    );
    expect(newIndexAt).toBeGreaterThan(0);
    expect(newIndexAt).toBeLessThan(dropConstraintAt);
    expect(newIndexAt).toBeLessThan(dropIndexAt);
  });

  it("ships candidate types instead of editing the generated Supabase types", () => {
    const candidate = read("src", "lib", "qne", "service-jobs", "wp3a-candidate-types.ts");
    expect(candidate).toContain("latest_customer_ref_no");
    expect(candidate).toContain("latest_vendor_ref_no");
    expect(candidate).toContain("completion_cycle");
    expect(candidate).toContain("CandidateServiceJobReopenRequestRow");
    expect(candidate).toContain("CandidateWaitingSetResult");
    expect(candidate).toContain("CandidateReopenRequestResult");
    expect(candidate).toContain("CandidateReopenDecideResult");
    expect(candidate.replace(/\s*\n\/\/\s*/g, " ")).toMatch(
      /regenerated only after an authorised migration application/i,
    );
    // The generated types must not describe unapplied schema.
    const generated = read("src", "integrations", "supabase", "types.ts");
    expect(generated).not.toContain("service_job_reopen_requests");
    expect(generated).not.toContain("latest_customer_ref_no");
  });

  it("creates one-pending-per-job reopen requests with server-only access", () => {
    expect(SQL).toContain("CREATE TABLE IF NOT EXISTS public.service_job_reopen_requests");
    expect(SQL).toContain("service_job_reopen_requests_one_pending_idx");
    expect(SQL).toContain("WHERE status = 'pending'");
    expect(SQL).toContain(
      "ALTER TABLE public.service_job_reopen_requests ENABLE ROW LEVEL SECURITY",
    );
    expect(SQL).toContain(
      "REVOKE ALL ON TABLE public.service_job_reopen_requests FROM PUBLIC, anon, authenticated",
    );
    expect(SQL).toContain("GRANT ALL ON TABLE public.service_job_reopen_requests TO service_role");
  });

  it("locks the Job row and rechecks the exact status in every RPC", () => {
    for (const fn of ["sh_job_waiting_set", "sh_job_reopen_request", "sh_job_reopen_decide"]) {
      expect(SQL).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}(`);
    }
    expect(SQL.match(/pg_advisory_xact_lock/g)?.length).toBeGreaterThanOrEqual(4);
    expect(SQL.match(/FOR UPDATE/g)?.length).toBeGreaterThanOrEqual(5);
    expect(SQL).toContain("IF v_job.status <> 'In Progress' THEN");
    expect(SQL).toContain("AND status = 'In Progress'");
    expect(SQL).toContain("RAISE EXCEPTION 'concurrent_waiting_change'");
    expect(SQL).toContain("RAISE EXCEPTION 'concurrent_reopen'");
  });

  it("rejects a blank waiting reference inside the transaction", () => {
    expect(SQL).toContain("'error', 'A reference number is required.'");
    expect(SQL).toContain("IF length(v_ref) > 200 THEN");
  });

  it("writes immutable activity evidence in the same transaction", () => {
    for (const evt of [
      "'waiting_reference_set'",
      "'reopen_requested'",
      "'reopen_approved'",
      "'reopen_rejected'",
    ]) {
      expect(SQL).toContain(evt);
    }
    expect(
      SQL.match(/INSERT INTO public\.service_job_activity_log/g)?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("keeps decision authority server-side and admin-only", () => {
    expect(SQL).toContain("IF NOT coalesce(p_is_admin, false) THEN");
    expect(SQL).toContain("'Only an Owner or Administrator can decide a reopen request.'");
  });

  it("approving preserves assignment and prior evidence while advancing one cycle", () => {
    expect(SQL).toContain("completion_cycle = coalesce(completion_cycle, 1) + 1");
    // Only current-state fields are touched; assignment columns are absent.
    const approve = SQL.slice(SQL.indexOf("IF p_decision = 'approve' THEN"));
    expect(approve).not.toContain("assigned_user_id =");
    expect(SQL).not.toMatch(/UPDATE public\.service_job_completions/);
    expect(SQL).not.toMatch(/DELETE FROM public\.service_job_completions/);
  });

  it("keeps completion cycle-aware and idempotent for the same cycle", () => {
    expect(SQL).toContain("v_cycle := coalesce(v_job.completion_cycle, 1)");
    expect(SQL).toContain("AND coalesce(completion_cycle, 1) = v_cycle");
    expect(SQL).toContain("'outcome', 'ok', 'idempotent', true");
  });
});

describe("server module and routes", () => {
  it("routes every mutation through an atomic RPC", () => {
    expect(SERVER).toContain("wp3aSchema.rpc(WAITING_SET_RPC");
    expect(SERVER).toContain("wp3aSchema.rpc(REOPEN_REQUEST_RPC");
    expect(SERVER).toContain("wp3aSchema.rpc(REOPEN_DECIDE_RPC");
    for (const src of [SERVER, WAITING_ROUTE, REOPEN_ROUTE, DECISION_ROUTE]) {
      expect(src).not.toMatch(/\.update\(/);
      expect(src).not.toMatch(/\.insert\(/);
      expect(src).not.toMatch(/\.delete\(/);
    }
  });

  it("derives tenant, actor and admin authority from the session only", () => {
    for (const src of [WAITING_ROUTE, REOPEN_ROUTE]) {
      expect(src).toContain("requireAuthenticatedN3User(request)");
      expect(src).toContain("tenantCode: user.tenantCode");
      expect(src).toContain("isAdmin: Boolean(user.isAdministrator)");
    }
    expect(DECISION_ROUTE).toContain("requireAdministrator(request)");
    for (const src of [WAITING_ROUTE, REOPEN_ROUTE, DECISION_ROUTE]) {
      expect(src).not.toContain("body.tenant");
      expect(src).not.toContain("body.tenantCode");
      expect(src).not.toContain("body.isAdmin");
      expect(src).not.toContain("body.actor");
    }
  });

  it("validates the waiting reference and reopen reason server-side", () => {
    expect(WAITING_ROUTE).toContain("parseWaitingInput(body)");
    expect(WAITING_ROUTE).toContain("status: 400");
    expect(REOPEN_ROUTE).toContain("parseReopenReason(body)");
    expect(DECISION_ROUTE).toContain("parseReopenDecision(body)");
  });

  it("surfaces the RPC's typed status instead of inventing one", () => {
    for (const src of [WAITING_ROUTE, REOPEN_ROUTE, DECISION_ROUTE]) {
      expect(src).toContain("status: result.status ?? 409");
    }
  });
});

describe("frozen boundaries", () => {
  it("generic /status still rejects direct Completed and Cancelled", () => {
    expect(STATUS_ROUTE).toContain("isGenericCompleteBlocked(to)");
    expect(STATUS_ROUTE).toContain('if (to === "Cancelled")');
  });

  it("Field Operations stays unmounted", () => {
    expect(JOB_PAGE).not.toContain("FieldOperationsPanel");
  });
});

describe("Job detail UI corrections", () => {
  it("collects the waiting Ref. No. before changing status", () => {
    expect(JOB_PAGE).toContain('data-testid="waiting-ref-prompt"');
    expect(JOB_PAGE).toContain("Ref. No. *");
    expect(JOB_PAGE).toContain("waitingPartyForStatus(to)");
    expect(JOB_PAGE).toContain("/waiting`");
    expect(JOB_PAGE).toContain("disabled={!waitingRef.trim() || !!busy}");
  });

  it("shows both latest references compactly, with an em dash fallback", () => {
    expect(JOB_PAGE).toContain('data-testid="waiting-refs"');
    expect(JOB_PAGE).toContain("Customer Ref. No.");
    expect(JOB_PAGE).toContain("Vendor Ref. No.");
    expect(JOB_PAGE).toContain("refDisplay(job.latest_customer_ref_no)");
    expect(JOB_PAGE).toContain("refDisplay(job.latest_vendor_ref_no)");
    expect(JOB_PAGE).toContain("flex flex-col gap-2 md:flex-row");
  });

  it("labels the new timeline events", () => {
    expect(JOB_PAGE).toContain('case "waiting_reference_set":');
    expect(JOB_PAGE).toContain('case "reopen_requested":');
    expect(JOB_PAGE).toContain('case "reopen_approved":');
    expect(JOB_PAGE).toContain('case "reopen_rejected":');
  });

  it("puts Request Cancellation on the Cancellation header row with an [i] balloon", () => {
    expect(CANCEL_PANEL).toContain('data-testid="cancellation-header"');
    const header = CANCEL_PANEL.slice(
      CANCEL_PANEL.indexOf('data-testid="cancellation-header"'),
      CANCEL_PANEL.indexOf("{active && ("),
    );
    expect(header).toContain("{label}");
    expect(header).toContain('testId="cancellation-approval-info"');
    expect(header).toContain("CANCEL_APPROVAL_MODE_LABEL[state.settings.approvalMode]");
    // The approval wording no longer consumes a permanent line.
    expect(CANCEL_PANEL).not.toContain(
      '<span className="text-[11px] text-muted-foreground">\n          {CANCEL_APPROVAL_MODE_LABEL',
    );
    // Exactly one request trigger remains.
    expect(CANCEL_PANEL.match(/onClick=\{\(\) => setOpen\(true\)\}/g)?.length).toBe(1);
  });

  it("keeps the cancellation API surface and server authorisation unchanged", () => {
    expect(CANCEL_PANEL).toContain("/api/workspace/jobs/${jobId}/cancellation`");
    expect(CANCEL_PANEL).toContain("/api/workspace/jobs/${jobId}/cancellation/decision`");
    expect(CANCEL_PANEL).toContain("state.isAdmin &&");
    expect(CANCEL_PANEL).toContain("!state.canRequest");
  });
});

describe("completion card + reopen", () => {
  it("keeps exactly the three approved completion controls", () => {
    const form = COMPLETION_CARD.slice(
      COMPLETION_CARD.indexOf('view.mode === "form" && state.canComplete'),
    );
    expect(form.match(/<textarea/g)?.length).toBe(1);
    expect(form.match(/type="checkbox"/g)?.length).toBe(1);
    expect(form).toContain("Complete Job");
    expect(COMPLETION_CARD).not.toContain("Diagnosis");
    expect(COMPLETION_CARD).not.toContain("signature");
  });

  it("mounts the reopen section only in the completed / legacy view", () => {
    expect(COMPLETION_CARD).toContain('{(view.mode === "locked" || view.mode === "legacy") && (');
    expect(COMPLETION_CARD).toContain("<JobReopenSection jobId={jobId}");
  });

  it("requests a reopen with a mandatory reason and never reopens directly", () => {
    expect(REOPEN_CARD).toContain("Request Reopen");
    expect(REOPEN_CARD).toContain("disabled={!reason.trim() || !!busy}");
    expect(REOPEN_CARD).toContain("/reopen`");
    expect(REOPEN_CARD).toContain("/reopen/decision`");
    expect(REOPEN_CARD).toContain("view.canDecide &&");
    expect(REOPEN_CARD).not.toContain("/status`");
  });

  it("guards against duplicate submission and is mobile safe", () => {
    expect(REOPEN_CARD).toContain("if (busy) return;");
    expect(REOPEN_CARD).toContain("min-h-[44px]");
    expect(REOPEN_CARD).toContain("w-full min-w-0");
  });
});

describe("compact attendance visit rows", () => {
  it("renders one wrapping row per visit with peach map buttons", () => {
    expect(ATTENDANCE_CARD).toContain('data-testid="attendance-visit-row"');
    expect(ATTENDANCE_CARD).toContain("flex flex-wrap items-center gap-x-2 gap-y-1");
    expect(ATTENDANCE_CARD).toContain('tone="peach"');
    expect(ATTENDANCE_CARD).toContain("bg-orange-100");
    expect(ATTENDANCE_CARD).toContain("min-h-11");
  });

  it("shows an em dash and an unavailable Map Out for an ongoing visit", () => {
    expect(ATTENDANCE_CARD).toContain(
      'Out {v.clock_out_at ? formatMYDateTime(v.clock_out_at) : "—"}',
    );
    expect(ATTENDANCE_CARD).toContain('aria-disabled="true"');
    expect(ATTENDANCE_CARD).toContain("placeholder");
  });

  it("moves GPS result, accuracy and exception detail into one [i] balloon", () => {
    expect(ATTENDANCE_CARD).toContain('testId="attendance-visit-info"');
    const row = ATTENDANCE_CARD.slice(
      ATTENDANCE_CARD.indexOf('data-testid="attendance-visit-row"'),
    );
    const balloon = row.slice(row.indexOf('testId="attendance-visit-info"'));
    expect(balloon).toContain("gpsSummary(v.clock_in_gps_result");
    expect(balloon).toContain("clock_in_exception_reason");
    expect(balloon).toContain("GPS exception recorded");
    // Raw coordinates are never rendered as text.
    expect(ATTENDANCE_CARD).not.toMatch(/\{v\.clock_in_latitude\}/);
    expect(ATTENDANCE_CARD).not.toMatch(/\{v\.clock_out_longitude\}/);
  });

  it("keeps the existing chooser destinations untouched", () => {
    expect(ATTENDANCE_CARD).toContain("mapChoicesForPoint");
    expect(ATTENDANCE_CARD).toContain("hasMapAction(point)");
  });
});

describe("info balloon primitive", () => {
  it("is keyboard accessible and dismissible", () => {
    const INFO = read("src", "components", "qne", "InfoPopover.tsx");
    expect(INFO).toContain('if (e.key === "Escape") setOpen(false);');
    expect(INFO).toContain("aria-expanded={open}");
    expect(INFO).toContain("aria-label={label}");
    expect(INFO).toContain("onClick={() => setOpen(false)}");
  });
});
