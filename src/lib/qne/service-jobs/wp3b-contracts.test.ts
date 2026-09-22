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
