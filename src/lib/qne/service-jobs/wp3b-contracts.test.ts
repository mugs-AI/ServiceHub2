// WP3B — source contracts: candidate SQL, atomicity, authority, immutability,
// UI composition and mobile safety. Text-level assertions keep the guarantees
// from silently regressing.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

const SQL = read("docs/migrations/WP3B_followup_lifecycle.candidate.sql");
const SERVER = read("src/lib/qne/service-jobs/wp3b.server.ts");
const ROUTE = read("src/routes/api/workspace/jobs.$jobId.followup.ts");
const CARD = read("src/components/qne/SimpleCompletionCard.tsx");
const SECTION = read("src/components/qne/JobFollowupSection.tsx");
const PENDING = read("src/routes/api/workspace/jobs.pending.ts");
const ADMIN = read("src/routes/api/admin/dashboard.ts");
const MYWORK = read("src/routes/api/dashboard/my-work.ts");
const JOB_PAGE = read("src/routes/jobs.$jobId.tsx");

describe("WP3B candidate migration", () => {
  it("is a candidate only and is never placed under supabase/migrations", () => {
    expect(SQL).toMatch(/CANDIDATE — NOT APPLIED/);
    expect(() => read("supabase/migrations/WP3B_followup_lifecycle.candidate.sql")).toThrow();
  });

  it("is additive with safe-forward and rollback notes", () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.service_job_followups/);
    expect(SQL).toMatch(/Safe-forward notes:/);
    expect(SQL).toMatch(/Rollback notes:/);
    expect(SQL).not.toMatch(/DROP TABLE public\.service_job_completions/);
  });

  it("materialises the missing rows for existing ticked current cycles", () => {
    const block = SQL.slice(
      SQL.indexOf("1b. Additive compatibility materialisation"),
      SQL.indexOf("2. Central outcome projection"),
    );
    expect(block).toMatch(/INSERT INTO public\.service_job_followups/);
    // Identity comes from canonical Job + completion evidence.
    expect(block).toMatch(/FROM public\.service_jobs j/);
    expect(block).toMatch(/JOIN public\.service_job_completions c/);
    expect(block).toMatch(
      /coalesce\(c\.completion_cycle, 1\) = coalesce\(j\.completion_cycle, 1\)/,
    );
    // Only non-deleted, currently Completed, ticked cycles with no row.
    expect(block).toMatch(/j\.is_deleted = false/);
    expect(block).toMatch(/j\.status = 'Completed'/);
    expect(block).toMatch(/coalesce\(c\.follow_up_required, false\) = true/);
    expect(block).toMatch(/NOT EXISTS/);
    // Trusted timestamps and actor snapshots, server now() only as a fallback.
    expect(block).toMatch(/coalesce\(c\.completed_at, j\.completed_at, now\(\)\)/);
    expect(block).toMatch(/c\.completed_by_user_id/);
    expect(block).toMatch(/c\.completed_by_name_snapshot/);
    // Existing follow-up evidence is preserved; nothing is rewritten.
    expect(block).toMatch(
      /ON CONFLICT \(tenant_code, service_job_id, completion_cycle\) DO NOTHING/,
    );
    expect(block).not.toMatch(/UPDATE /);
    expect(block).not.toMatch(/DELETE /);
    // The safe-forward note no longer claims no backfill is needed.
    expect(SQL).not.toMatch(/needs\s+no backfill/);
    expect(SQL).toMatch(/not a destructive backfill/);
  });

  it("never rewrites completion evidence", () => {
    expect(SQL).not.toMatch(/UPDATE public\.service_job_completions/);
    expect(SQL).not.toMatch(/DELETE FROM public\.service_job_completions/);
  });

  it("stores one follow-up per tenant + Job + completion cycle", () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS service_job_followups_one_per_cycle_idx[\s\S]*?\(tenant_code, service_job_id, completion_cycle\)/,
    );
  });

  it("keeps the table server-authoritative: RLS on, browser roles revoked", () => {
    expect(SQL).toMatch(/ALTER TABLE public\.service_job_followups ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/REVOKE ALL ON public\.service_job_followups FROM anon/);
    expect(SQL).toMatch(/REVOKE ALL ON public\.service_job_followups FROM authenticated/);
    expect(SQL).toMatch(/GRANT ALL ON public\.service_job_followups TO service_role/);
  });

  it("derives every completed cycle in one central projection", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE VIEW public\.service_job_completion_outcomes/);
    for (const outcome of [
      "resolved_at_completion",
      "follow_up_open",
      "resolved_after_follow_up",
      "reopen_pending",
      "legacy_unknown",
    ]) {
      expect(SQL).toContain(`'${outcome}'`);
    }
  });

  it("opens follow-up evidence only for a ticked completion, in the same transaction", () => {
    expect(SQL).toMatch(/IF v_follow_up THEN[\s\S]*?INSERT INTO public\.service_job_followups/);
  });

  it("clear-follow-up locks, rechecks authority and state, and is idempotent", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.sh_followup_clear/);
    expect(SQL).toMatch(/pg_advisory_xact_lock\([\s\S]*?':followup:'/);
    expect(SQL).toMatch(/FROM public\.service_jobs[\s\S]*?FOR UPDATE/);
    expect(SQL).toMatch(
      /Only the assigned technician or an administrator can clear this follow-up/,
    );
    expect(SQL).toMatch(/A follow-up result is required/);
    expect(SQL).toMatch(/'idempotent', true/);
    expect(SQL).toMatch(/concurrent_followup/);
    expect(SQL).toMatch(/'followup_cleared'/);
  });

  it("clearing never changes the Job status", () => {
    const fn = SQL.slice(
      SQL.indexOf("CREATE OR REPLACE FUNCTION public.sh_followup_clear"),
      SQL.indexOf("CREATE OR REPLACE FUNCTION public.sh_job_reopen_decide"),
    );
    expect(fn).not.toMatch(/UPDATE public\.service_jobs/);
  });

  it("an approved reopen marks the cycle's open follow-up as reopened", () => {
    expect(SQL).toMatch(
      /UPDATE public\.service_job_followups SET[\s\S]*?state = 'reopened'[\s\S]*?AND state = 'open'/,
    );
  });

  it("keeps the RPCs executable only by the trusted server role", () => {
    for (const fn of ["sh_followup_clear", "sh_job_complete_simple", "sh_job_reopen_decide"]) {
      expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[\\s\\S]*?FROM anon`));
      expect(SQL).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]*?TO service_role`),
      );
    }
  });
});

describe("WP3B server boundary", () => {
  it("mutates only through the atomic RPC", () => {
    expect(SERVER).toMatch(/rpc\(FOLLOWUP_CLEAR_RPC/);
    expect(SERVER).not.toMatch(/\.insert\(/);
    expect(SERVER).not.toMatch(/\.update\(/);
    expect(SERVER).not.toMatch(/\.delete\(/);
  });

  it("derives tenant and actor from the session, never from the body", () => {
    expect(ROUTE).toMatch(/requireAuthenticatedN3User/);
    expect(ROUTE).toMatch(/tenantCode: user\.tenantCode/);
    expect(ROUTE).not.toMatch(/body\.tenant/);
    expect(ROUTE).not.toMatch(/body\.is_admin/);
    expect(ROUTE).not.toMatch(/body\.actor/);
  });

  it("POST has no precheck gate that would block an identical retry", () => {
    const post = ROUTE.slice(ROUTE.indexOf("POST: async"));
    expect(post).toMatch(/clearFollowupAtomic/);
    expect(post).not.toMatch(/followupBlockedReason/);
    expect(post).not.toMatch(/canClearFollowup/);
  });

  it("every read stays tenant-scoped", () => {
    const matches = SERVER.match(/\.from\(/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    expect(SERVER.match(/eq\("tenant_code"/g)?.length ?? 0).toBeGreaterThanOrEqual(matches.length);
  });
});

describe("WP3B dashboard and queue data contract", () => {
  it("admin and personal counts use the shared scope definition", () => {
    for (const src of [ADMIN, MYWORK]) {
      expect(src).toMatch(/loadCompletionOutcomes/);
      expect(src).toMatch(/countScopes/);
    }
    expect(ADMIN).toMatch(/followUpOpen: wp3b\.followUpOpen/);
    expect(ADMIN).toMatch(/legacyCompleted: wp3b\.legacyUnknown/);
    expect(MYWORK).toMatch(/myFollowUps: wp3b\.myFollowUps/);
    expect(MYWORK).toMatch(/resolvedByMeToday: wp3b\.resolvedByMeToday/);
  });

  it("the Pending Queue serves the three WP3B scopes from the same derivation", () => {
    for (const key of ["follow_up_open", "reopen_pending", "resolved"]) {
      expect(PENDING).toContain(`"${key}"`);
    }
    expect(PENDING).toMatch(/loadCompletionOutcomes/);
    expect(PENDING).toMatch(/outcomesForQueue/);
    expect(PENDING).toMatch(/eq\("tenant_code", user\.tenantCode\)/);
  });

  it("Resolved by Me is attributed to the actual actor, not the assignee", () => {
    const SCOPE = read("src/lib/qne/dashboard/followup-scope.ts");
    // The read model retains the completion actor and derives the resolver.
    expect(SERVER).toMatch(/completed_by_user_id/);
    expect(SERVER).toMatch(/resolved_by_user_id: resolvedBy/);
    expect(SERVER).toMatch(
      /outcome === "resolved_at_completion"[\s\S]*?completion\?\.completed_by_user_id/,
    );
    expect(SERVER).toMatch(
      /outcome === "resolved_after_follow_up"[\s\S]*?followup\?\.resolved_by_user_id/,
    );
    // The shared count credits the resolver; workload scopes keep the assignee.
    expect(SCOPE).toMatch(/export function resolvedByFor/);
    expect(SCOPE).toMatch(/resolvedByMeToday"\) return me !== null && resolvedByFor\(row\) === me/);
    expect(SCOPE).toMatch(/matchesWp3bCard\(row, "resolvedByMeToday", opts\)\) counts\.resolvedByMeToday/);
    expect(SCOPE).toMatch(/matchesWp3bCard\(row, "myFollowUps", opts\)\) counts\.myFollowUps/);
    expect(SCOPE).toMatch(/matchesWp3bCard\(row, "myReopenPending", opts\)\) counts\.myReopenPending/);
    // Both dashboards pass the resolver through the shared scope rows.
    for (const src of [ADMIN, MYWORK]) {
      expect(src).toMatch(/resolved_by_user_id: r\.resolved_by_user_id/);
    }
  });

  it("an open follow-up is only actionable with durable current-cycle evidence", () => {
    const RULES = read("src/lib/qne/service-jobs/wp3b-followup.ts");
    // UI: no row -> no control, whatever the derived outcome says.
    expect(RULES).toMatch(
      /const fu = input\.followup;\s*\n\s*if \(!fu\) return \{ mode: "hidden" \}/,
    );
    // Server: the RPC rejects a clear with no follow-up row for the cycle.
    expect(SQL).toMatch(/This Job has no open follow-up for its current completion cycle/);
    // The card only renders the action for the "open" view mode.
    expect(SECTION).toMatch(/view\.mode === "open" && view\.canClear/);
  });
});

describe("WP3B Job UI", () => {
  it("mounts the follow-up section once, only in the locked / legacy view", () => {
    expect(CARD.match(/<JobFollowupSection/g)?.length).toBe(1);
    expect(CARD).toMatch(
      /view\.mode === "locked" \|\| view\.mode === "legacy"\) && \(\s*<JobFollowupSection/,
    );
  });

  it("shows exactly one outcome badge and one Clear Follow-up control", () => {
    expect(SECTION.match(/data-testid="completion-outcome-badge"/g)?.length).toBe(1);
    expect(SECTION.match(/data-testid="followup-clear-button"/g)?.length).toBe(1);
  });

  it("requires the Follow-up Result and explains the Job stays Completed", () => {
    expect(SECTION).toMatch(/Follow-up Result \*/);
    expect(SECTION).toMatch(/Job stays Completed/);
    expect(SECTION).toMatch(/disabled=\{!note\.trim\(\) \|\| busy\}/);
  });

  it("shows result, cleared by and Malaysian date-time after clearing", () => {
    expect(SECTION).toMatch(/Follow-up result/);
    expect(SECTION).toMatch(/Cleared by/);
    expect(SECTION).toMatch(/formatMYDateTime\(view\.record\.resolved_at\)/);
  });

  it("stays mobile-first: 44px controls and no fixed widths", () => {
    expect(SECTION).toMatch(/min-h-\[44px\]/);
    expect(SECTION).toMatch(/w-full min-w-0/);
    expect(SECTION).not.toMatch(/w-\[\d+px\]/);
    expect(SECTION).not.toMatch(/overflow-x-(auto|scroll)/);
  });

  it("keeps the coloured Request Reopen button and adds no duplicate controls", () => {
    const REOPEN = read("src/components/qne/JobReopenSection.tsx");
    expect(REOPEN).toMatch(/border-amber-400 bg-amber-100/);
    expect(CARD.match(/<JobReopenSection/g)?.length).toBe(1);
    expect(SECTION).not.toMatch(/Request Reopen/);
    expect(SECTION).not.toMatch(/Comments/);
    expect(JOB_PAGE.match(/<SimpleCompletionCard/g)?.length).toBe(1);
  });
});
