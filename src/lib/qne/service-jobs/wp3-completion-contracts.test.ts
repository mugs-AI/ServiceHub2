// WP3 — source-text contracts: atomic server surface, candidate SQL, UI
// placement, mobile safety, and preservation of the frozen legacy areas.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

const ROUTE = read("src", "routes", "jobs.$jobId.tsx");
const CARD = read("src", "components", "qne", "SimpleCompletionCard.tsx");
const API = read("src", "routes", "api", "workspace", "jobs.$jobId.complete.ts");
const SERVER = read("src", "lib", "qne", "service-jobs", "wp3-completion.server.ts");
const SQL = read("docs", "migrations", "WP3_simple_atomic_completion.candidate.sql");

describe("API authority, tenant and actor", () => {
  it("authenticates every handler through the N3 session helper", () => {
    expect(API.match(/requireAuthenticatedN3User/g)?.length).toBeGreaterThanOrEqual(2);
    expect(API).toContain("guardResponse");
  });

  it("resolves tenant, actor, role and timestamps server-side only", () => {
    expect(API).toContain("tenantCode: user.tenantCode");
    expect(API).toContain("user.diagnostics.matchedN3UserId ?? user.userCode ?? null");
    expect(API).not.toMatch(/body\.(tenant_code|actor_user_id|user_id|is_admin|completed_at)/);
  });

  it("fails closed when the actor cannot be resolved", () => {
    expect(API).toContain('{ error: "Your user could not be resolved." }, { status: 401 }');
    expect(SERVER).toContain('throw new CompletionError("Your user could not be resolved.", 401)');
  });

  it("scopes every read by the resolved tenant", () => {
    expect(SERVER.match(/\.eq\("tenant_code", tenantCode\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("POST delegates readiness and permission to the RPC as the single authoritative operation", () => {
    const post = API.slice(API.indexOf("POST:"));
    // After auth + strict body parse, POST must call the RPC directly with no
    // stale precheck gate that would reject a lost-response retry on a
    // now-Completed Job before it can reach the RPC's idempotent branch.
    expect(post).toContain("completeJobAtomic(actor, params.jobId, parsed.value)");
    expect(post).not.toContain("loadCompletionJob(");
    expect(post).not.toContain("canCompleteJob(");
    expect(post).not.toContain("countOpenAttendance(");
    expect(post).not.toContain("completionBlockedReason(");
    // Auth, actor resolution and strict parsing still gate the RPC call.
    expect(post.indexOf("requireAuthenticatedN3User(request)")).toBeLessThan(
      post.indexOf("completeJobAtomic("),
    );
    expect(post.indexOf("parseCompletionInput(body)")).toBeLessThan(
      post.indexOf("completeJobAtomic("),
    );
  });

  it("POST surfaces the RPC's typed permission (403) and conflict (409) outcomes", () => {
    const post = API.slice(API.indexOf("POST:"));
    expect(post).toContain("result.outcome !== \"ok\"");
    expect(post).toContain("result.status ?? 409");
    expect(post).toContain("idempotent: Boolean(result.idempotent)");
  });

  it("GET keeps the read-model prechecks for rendering only", () => {
    const get = API.slice(API.indexOf("GET:"), API.indexOf("POST:"));
    expect(get).toContain("canCompleteJob(");
    expect(get).toContain("countOpenAttendance(");
    expect(get).toContain("completionBlockedReason(job, openAttendance)");
  });
});

describe("atomicity", () => {
  it("mutates only through the transactional RPC", () => {
    expect(SERVER).toContain("COMPLETE_JOB_RPC");
    expect(SERVER).toContain("wp3Schema.rpc(");
    expect(API).toContain("completeJobAtomic(");
    // No direct table writes anywhere in WP3 server code or the route.
    expect(SERVER).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(API).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("locks the Job, rechecks authority and writes completion, status and audit together", () => {
    expect(SQL).toContain("pg_advisory_xact_lock");
    expect(SQL).toContain("FROM public.service_jobs");
    expect(SQL).toContain("FOR UPDATE");
    expect(SQL).toContain("INSERT INTO public.service_job_completions");
    expect(SQL).toContain("UPDATE public.service_jobs SET");
    expect(SQL).toContain("INSERT INTO public.service_job_activity_log");
    expect(SQL).toContain("completion_snapshot = v_snapshot");
    expect(SQL).toContain("RAISE EXCEPTION 'concurrent_completion'");
  });

  it("is idempotent for an identical retry and unique per Job", () => {
    expect(SQL).toContain("'idempotent', true");
    expect(SQL).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS service_job_completions_one_per_job_idx",
    );
    expect(SQL).toContain("WHEN unique_violation THEN");
  });

  it("fails closed on inconsistent pre-existing state and never backfills legacy Jobs", () => {
    expect(SQL).toContain("inconsistent completion record");
    expect(SQL).not.toMatch(/UPDATE\s+public\.service_job_completions/i);
    expect(SQL).not.toMatch(/INSERT INTO public\.service_job_completions[\s\S]{0,400}SELECT/i);
  });

  it("validates identity and payload before any lock or write", () => {
    const beforeLock = SQL.slice(
      SQL.indexOf("AS $$"),
      SQL.indexOf("PERFORM pg_advisory_xact_lock"),
    );
    expect(beforeLock).toContain("Unresolved tenant or actor.");
    expect(beforeLock).toContain("A resolution summary is required.");
    expect(beforeLock).toContain("4000");
  });

  it("keeps the RPC server-only", () => {
    expect(SQL).toContain("SECURITY DEFINER");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.sh_job_complete_simple(");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.sh_job_complete_simple(");
    expect(SQL).toContain("GRANT ALL ON TABLE public.service_job_completions TO service_role;");
    expect(SQL).toContain(
      "REVOKE ALL ON TABLE public.service_job_completions FROM PUBLIC, anon, authenticated;",
    );
  });
});

describe("candidate SQL is additive and unapplied", () => {
  it("exists at the reviewed path and was not applied", () => {
    expect(
      existsSync(join(process.cwd(), "docs/migrations/WP3_simple_atomic_completion.candidate.sql")),
    ).toBe(true);
    // No WP3 migration recorded in the applied migration history.
    const applied = read(
      "supabase",
      "migrations",
      "20260917143341_a9308359-65c3-4292-9078-1e7f86946d70.sql",
    );
    expect(applied).not.toContain("sh_job_complete_simple");
  });

  it("drops or renames nothing and leaves legacy Field RPCs alone", () => {
    expect(SQL).not.toMatch(/\bDROP\s+(TABLE|COLUMN|FUNCTION|INDEX)\b/i);
    expect(SQL).not.toMatch(/\bALTER\s+TABLE[^;]*RENAME\b/i);
    expect(SQL).not.toContain("sh_field_mutate");
    expect(SQL).toContain("ADD COLUMN IF NOT EXISTS");
  });
});

describe("UI contract", () => {
  it("mounts the compact completion card on the Job detail page", () => {
    expect(ROUTE).toContain("<SimpleCompletionCard jobId={job.id}");
    expect(ROUTE).toContain(
      'import { SimpleCompletionCard } from "@/components/qne/SimpleCompletionCard"',
    );
  });

  it("offers exactly the three approved controls", () => {
    expect(CARD).toContain("Resolution Summary *");
    expect(CARD).toContain("Follow-up still required");
    expect(CARD).toContain(">Complete Job<");
    expect(CARD).toContain('type="checkbox"');
    expect(CARD.match(/<textarea/g)?.length).toBe(1);
    expect(CARD.match(/<button/g)?.length).toBe(1);
  });

  it("shows no legacy completion fields", () => {
    for (const legacy of [
      "checklist",
      "diagnosis",
      "Action taken",
      "Test result",
      "Acknowledgement",
      "signature",
      "waiver",
      "follow_up_date",
      "Service report",
    ]) {
      expect(CARD.toLowerCase()).not.toContain(legacy.toLowerCase());
    }
  });

  it("renders the locked state and the legacy label without inventing evidence", () => {
    expect(CARD).toContain('data-testid="completion-locked"');
    expect(CARD).toContain("LEGACY_COMPLETION_LABEL");
    expect(CARD).toContain("Completed by");
    expect(CARD).toContain("Completed at");
    expect(CARD).toContain("formatMYDateTime(record.completed_at)");
  });

  it("prevents duplicate submission and refreshes Job state after success", () => {
    expect(CARD).toContain("if (busy) return;");
    expect(CARD).toContain("disabled={!summary.trim() || busy}");
    expect(CARD).toContain("await load();");
    expect(CARD).toContain("onCompleted?.()");
    expect(ROUTE).toContain("onCompleted={reloadAll}");
  });

  it("is mobile safe at 320px and 390px", () => {
    expect(CARD).toContain("w-full min-w-0");
    expect(CARD).toContain("min-h-[44px]");
    expect(CARD.match(/break-words/g)?.length).toBeGreaterThanOrEqual(4);
    expect(CARD).not.toMatch(/\bw-\[\d{3,}px\]|\bmin-w-\[\d{3,}px\]|overflow-x-visible/);
  });
});

describe("frozen areas", () => {
  it("keeps legacy Field Operations unmounted and the old completion form removed", () => {
    expect(ROUTE).not.toContain("FieldOperationsPanel");
    expect(existsSync(join(process.cwd(), "src/components/qne/CompletionPanel.tsx"))).toBe(false);
    expect(ROUTE).not.toContain("CompletionPanel");
  });

  it("leaves WP2B attachments, WP2C attendance and the Timeline drawer mounted", () => {
    expect(ROUTE).toContain("<JobAttachmentsCard jobId={job.id} />");
    expect(ROUTE).toContain("<OnSiteAttendanceCard jobId={job.id} />");
    expect(ROUTE).toContain('data-testid="timeline-drawer"');
  });

  it("does not modify the frozen legacy field-ops rules module", () => {
    const fieldOps = read("src", "lib", "qne", "service-jobs", "field-ops.ts");
    expect(fieldOps).not.toContain("wp3");
    expect(fieldOps).not.toContain("sh_job_complete_simple");
  });
});
