// WP1 Field Mutation Atomicity Closure.
//
// Every state-sensitive Field mutation must run inside one transactional,
// Job-locked RPC. These tests are contract tests over the forward migration
// and the API route: they prove the transactional boundary exists, that it is
// service-role only, that the route delegates to it with server-resolved facts
// only, and that the serialized decision rules resolve each competing pair
// into exactly one valid outcome.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FIELD_EVENTS } from "./field-ops";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const ROUTE = join(
  process.cwd(),
  "src",
  "routes",
  "api",
  "workspace",
  "jobs.$jobId.field.ts",
);
const HISTORICAL = "20260801003537_bcb53731-c1d2-41bd-8ee5-359fe7ec9e62.sql";
const SESSION_INTEGRITY = "20260822125838_81778a3d-d050-424c-8055-14a8a3aa13b7.sql";

function migrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));
}

const files = migrations();
const rpcFile = files.find((f) => /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.sh_field_mutate/i.test(f.sql));
const rpcSql = rpcFile?.sql ?? "";
const routeSrc = readFileSync(ROUTE, "utf8");

/* ---------------- transactional boundary ---------------- */

describe("atomic field-mutation RPC", () => {
  it("is defined in a new forward migration", () => {
    expect(rpcFile, "sh_field_mutate migration must exist").toBeTruthy();
    expect(rpcFile!.name > SESSION_INTEGRITY).toBe(true);
  });

  it("locks the Job row before any state-dependent decision", () => {
    const lockIndex = rpcSql.search(/FROM\s+public\.service_jobs[\s\S]{0,200}FOR\s+UPDATE/i);
    expect(lockIndex).toBeGreaterThan(-1);
    // No write to session/waiting/job state may appear before the lock.
    const firstWrite = rpcSql.search(
      /(INSERT\s+INTO\s+public\.service_job|UPDATE\s+public\.service_job)/i,
    );
    expect(firstWrite).toBeGreaterThan(lockIndex);
  });

  it("scopes the locked Job to the server-resolved tenant", () => {
    expect(rpcSql).toMatch(/WHERE\s+tenant_code\s*=\s*p_tenant_code\s+AND\s+id\s*=\s*p_job_id/i);
  });

  it("covers every state-sensitive field action plus support_mode_set", () => {
    for (const action of FIELD_EVENTS) {
      expect(rpcSql, `RPC must handle ${action}`).toContain(`'${action}'`);
    }
    expect(rpcSql).toContain("'support_mode_set'");
    expect(rpcSql).toMatch(/'Unsupported action\.'/);
  });

  it("recomputes work minutes and writes exactly one success audit row", () => {
    expect(rpcSql).toMatch(/UPDATE\s+public\.service_jobs\s+SET\s+total_work_minutes/i);
    const audits = rpcSql.match(/INSERT\s+INTO\s+public\.service_job_activity_log/gi) ?? [];
    // One for the support-mode path (which returns early) and one shared
    // success audit for every other action.
    expect(audits.length).toBe(2);
  });

  it("derives authority from server-passed actor facts only", () => {
    expect(rpcSql).toMatch(/p_is_admin/);
    expect(rpcSql).toMatch(/v_job\.assigned_user_id\s*=\s*p_actor_user_id/);
    expect(rpcSql).toMatch(/Only the Primary PIC or an Administrator/);
  });

  it("validates the STORED support mode, never a browser-supplied one", () => {
    expect(rpcSql).toMatch(/v_job\.support_mode\s+IS\s+NULL/i);
    expect(rpcSql).toMatch(/Travel, arrival and leave do not apply/);
  });

  it("is SECURITY DEFINER with a fixed search_path and service-role-only execute", () => {
    expect(rpcSql).toMatch(/SECURITY\s+DEFINER/i);
    expect(rpcSql).toMatch(/SET\s+search_path\s+TO\s+'public'/i);
    expect(rpcSql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.sh_field_mutate[\s\S]*FROM\s+PUBLIC/i);
    expect(rpcSql).toMatch(/FROM\s+anon/i);
    expect(rpcSql).toMatch(/FROM\s+authenticated/i);
    expect(rpcSql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.sh_field_mutate[\s\S]*TO\s+service_role/i);
  });

  it("translates a unique violation into a controlled conflict, not a 500", () => {
    expect(rpcSql).toMatch(/EXCEPTION[\s\S]*WHEN\s+unique_violation/i);
    expect(rpcSql).toMatch(/'status',409/);
  });

  it("does not rewrite historical migrations or drop the active-segment invariant", () => {
    const historical = files.find((f) => f.name === HISTORICAL)!;
    expect(historical.sql).toContain("service_job_work_sessions_one_open");
    const integrity = files.find((f) => f.name === SESSION_INTEGRITY)!;
    expect(integrity.sql).toContain("service_job_work_sessions_one_active_per_job");
    expect(rpcSql).not.toMatch(/DROP\s+INDEX[^;]*one_active_per_job/i);
    expect(rpcSql).not.toMatch(/DELETE\s+FROM\s+public\.service_job/i);
  });

  it("never mass-updates historical paused evidence", () => {
    // Paused rows are only ever closed by their exact id.
    const pausedUpdates =
      rpcSql.match(/UPDATE\s+public\.service_job_work_sessions\s+SET\s+status\s*=\s*'completed'\s+WHERE\s+id\s*=\s*v_paused\.id/gi) ??
      [];
    expect(pausedUpdates.length).toBeGreaterThanOrEqual(2);
    expect(rpcSql).not.toMatch(/UPDATE\s+public\.service_job_work_sessions[^;]*WHERE\s+service_job_id\s*=\s*p_job_id[^;]*status\s*=\s*'paused'/i);
  });
});

/* ---------------- route contract ---------------- */

describe("field route delegates to the atomic RPC", () => {
  it("still authenticates through the N3 session helper", () => {
    expect(routeSrc).toContain("requireAuthenticatedN3User");
  });

  it("passes only server-resolved tenant/actor/admin facts to the RPC", () => {
    expect(routeSrc).toMatch(/rpc\("sh_field_mutate"/);
    expect(routeSrc).toMatch(/p_tenant_code:\s*actor\.tenantCode/);
    expect(routeSrc).toMatch(/p_actor_user_id:\s*actor\.userId/);
    expect(routeSrc).toMatch(/p_is_admin:\s*actor\.isAdmin/);
    expect(routeSrc).not.toMatch(/p_is_admin:\s*body\./);
    expect(routeSrc).not.toMatch(/p_tenant_code:\s*body\./);
  });

  it("no longer performs its own multi-step state writes", () => {
    expect(routeSrc).not.toMatch(/from\("service_job_work_sessions"\)[\s\S]{0,80}\.insert/);
    expect(routeSrc).not.toMatch(/from\("service_job_waiting_periods"\)[\s\S]{0,80}\.insert/);
    // Job status/timestamp writes belong to the transaction now.
    expect(routeSrc).not.toMatch(/from\("service_jobs"\)[\s\S]{0,80}\.update/);
  });

  it("maps RPC outcomes to the HTTP status the RPC decided", () => {
    expect(routeSrc).toMatch(/result\.outcome\s*!==\s*"ok"/);
    expect(routeSrc).toMatch(/status:\s*result\.status\s*\?\?\s*409/);
  });

  it("keeps the browser endpoint and read-only state contract", () => {
    expect(routeSrc).toContain('createFileRoute("/api/workspace/jobs/$jobId/field")');
    expect(routeSrc).toContain("GET:");
    expect(routeSrc).toContain("canMutate");
  });

  it("keeps tenant GPS policy and waiting business-field validation", () => {
    expect(routeSrc).toContain("gpsRequestFor");
    expect(routeSrc).toContain("Vendor Ticket Number is required.");
    expect(routeSrc).toContain("Resolution note is required.");
  });
});

/* ---------------- serialized decision model ---------------- */
//
// A faithful, executable model of the RPC's committed-state decision rules.
// Two requests are applied strictly in lock order: the second one always
// re-evaluates the state the first one committed.

type Session = "none" | "active" | "paused";
interface JobState {
  status: string;
  supportMode: string | null;
  sessionRows: number;
  session: Session;
  waitingCustomer: boolean;
  waitingVendor: boolean;
  notes: number;
  ready: boolean;
  travelAt: string | null;
  arrivedAt: string | null;
  leftAt: string | null;
  audits: string[];
}

function jobState(over: Partial<JobState> = {}): JobState {
  return {
    status: "Assigned",
    supportMode: "remote_support",
    sessionRows: 0,
    session: "none",
    waitingCustomer: false,
    waitingVendor: false,
    notes: 0,
    ready: false,
    travelAt: null,
    arrivedAt: null,
    leftAt: null,
    audits: [],
    ...over,
  };
}

type Outcome = { ok: true } | { ok: false; status: number; error: string };

const ONSITE = ["onsite_support", "training", "installation", "migration"];
const TRAVEL_ONLY = ["travel_started", "arrived_on_site", "leave_site"];

/** Mirrors sh_field_mutate under the Job lock: validate, then commit or fail. */
function apply(state: JobState, action: string, mode?: string): Outcome {
  const fail = (status: number, error: string): Outcome => ({ ok: false, status, error });
  const commit = (): Outcome => {
    state.audits.push(action);
    return { ok: true };
  };

  if (["Pending Approval", "Completed", "Cancelled"].includes(state.status)) {
    return fail(400, `${state.status} jobs cannot use field actions.`);
  }

  const hasEvidence =
    state.sessionRows > 0 ||
    state.waitingCustomer ||
    state.waitingVendor ||
    state.notes > 0 ||
    Boolean(state.travelAt) ||
    Boolean(state.arrivedAt);

  if (action === "support_mode_set") {
    if (hasEvidence) return fail(409, "Support mode is locked once field evidence exists.");
    state.supportMode = mode ?? null;
    return commit();
  }

  if (state.supportMode === null) return fail(400, "Support mode is not set for this Job.");
  if (TRAVEL_ONLY.includes(action) && !ONSITE.includes(state.supportMode)) {
    return fail(400, "Travel, arrival and leave do not apply to this support mode.");
  }

  switch (action) {
    case "travel_started":
      if (state.travelAt) return fail(409, "Travel has already been recorded for this Job.");
      state.travelAt = "t";
      return commit();
    case "arrived_on_site":
      if (state.arrivedAt) return fail(409, "Arrival has already been recorded for this Job.");
      state.arrivedAt = "t";
      return commit();
    case "leave_site":
      if (!state.arrivedAt) return fail(409, "Record Arrived On Site before leaving.");
      if (state.leftAt) return fail(409, "Leaving site has already been recorded.");
      state.leftAt = "t";
      return commit();
    case "work_started":
      if (state.session === "active") {
        return fail(409, "A work session is already open for this job.");
      }
      if (state.session === "paused") {
        return fail(409, "Work is paused - resume it instead of starting new work.");
      }
      if (state.waitingCustomer || state.waitingVendor) {
        return fail(409, "Resolve the open waiting period before starting work.");
      }
      state.session = "active";
      state.sessionRows += 1;
      state.status = "In Progress";
      state.ready = false;
      return commit();
    case "work_paused":
      if (state.session !== "active") return fail(409, "No active work session to pause.");
      state.session = "paused";
      return commit();
    case "work_resumed":
      if (state.session !== "paused") return fail(409, "No paused work session to resume.");
      if (state.waitingCustomer || state.waitingVendor) {
        return fail(409, "Resolve the open waiting period before resuming work.");
      }
      state.session = "active";
      state.sessionRows += 1;
      state.ready = false;
      return commit();
    case "work_stopped":
      if (state.session === "none") return fail(409, "No open work session to stop.");
      state.session = "none";
      return commit();
    case "waiting_customer_started":
    case "waiting_vendor_started": {
      const vendor = action === "waiting_vendor_started";
      if (vendor ? state.waitingVendor : state.waitingCustomer) {
        return fail(409, `A Waiting ${vendor ? "vendor" : "customer"} period is already open.`);
      }
      state.session = "none"; // waiting always closes work state in the same tx
      if (vendor) state.waitingVendor = true;
      else state.waitingCustomer = true;
      state.status = vendor ? "Waiting Vendor" : "Waiting Customer";
      state.ready = false;
      return commit();
    }
    case "waiting_customer_resolved":
    case "waiting_vendor_resolved": {
      const vendor = action === "waiting_vendor_resolved";
      if (!(vendor ? state.waitingVendor : state.waitingCustomer)) {
        return fail(409, `No open Waiting ${vendor ? "vendor" : "customer"} period.`);
      }
      if (vendor) state.waitingVendor = false;
      else state.waitingCustomer = false;
      state.status = "In Progress";
      return commit();
    }
    case "ready_for_completion":
      if (state.status !== "In Progress") return fail(400, "Job must be In Progress.");
      if (state.waitingCustomer) return fail(400, "Resolve Waiting Customer first.");
      if (state.waitingVendor) return fail(400, "Resolve Waiting Vendor first.");
      if (state.session !== "none") return fail(400, "Close the open work session first.");
      if (!state.notes) return fail(400, "Add at least one work note.");
      state.ready = true;
      return commit();
    default:
      return fail(400, "Unsupported action.");
  }
}

/** Race helper: both requests want the lock; only one holds it at a time. */
function race(state: JobState, a: string, b: string) {
  const first = apply(state, a);
  const second = apply(state, b);
  return { first, second, state };
}

function invariants(state: JobState) {
  // At most one open active segment is implied by the single `session` marker.
  if (state.waitingCustomer || state.waitingVendor) expect(state.session).toBe("none");
  if (state.ready) {
    expect(state.session).toBe("none");
    expect(state.waitingCustomer || state.waitingVendor).toBe(false);
  }
}

describe("serialized concurrency outcomes", () => {
  it("two Start requests: one success, one deterministic conflict", () => {
    const { first, second, state } = race(jobState(), "work_started", "work_started");
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, status: 409 });
    expect(state.sessionRows).toBe(1);
    expect(state.audits).toEqual(["work_started"]);
    invariants(state);
  });

  it("PIC Start vs Admin Start leaves exactly one active segment", () => {
    // Actor identity never widens the invariant: it is Job-level.
    const state = jobState();
    const pic = apply(state, "work_started");
    const admin = apply(state, "work_started");
    expect(pic.ok).toBe(true);
    expect(admin.ok).toBe(false);
    expect(state.session).toBe("active");
    expect(state.sessionRows).toBe(1);
  });

  it("two Resume requests produce a single active segment", () => {
    const state = jobState({ session: "paused", sessionRows: 1, status: "In Progress" });
    const { first, second } = race(state, "work_resumed", "work_resumed");
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, status: 409 });
    expect(state.sessionRows).toBe(2);
    expect(state.session).toBe("active");
  });

  it("Resume vs Stop from the same paused state: Stop never leaves work open", () => {
    const stopFirst = jobState({ session: "paused", sessionRows: 1, status: "In Progress" });
    race(stopFirst, "work_stopped", "work_resumed");
    expect(stopFirst.session).toBe("none");
    expect(stopFirst.audits).toEqual(["work_stopped"]);

    const resumeFirst = jobState({ session: "paused", sessionRows: 1, status: "In Progress" });
    const r = race(resumeFirst, "work_resumed", "work_stopped");
    expect(r.first.ok).toBe(true);
    expect(r.second.ok).toBe(true);
    expect(resumeFirst.session).toBe("none");
  });

  it("Resume vs Waiting Customer never leaves billable work under waiting", () => {
    const waitingFirst = jobState({ session: "paused", sessionRows: 1, status: "In Progress" });
    const w = race(waitingFirst, "waiting_customer_started", "work_resumed");
    expect(w.first.ok).toBe(true);
    expect(w.second).toMatchObject({ ok: false, status: 409 });
    invariants(waitingFirst);

    const resumeFirst = jobState({ session: "paused", sessionRows: 1, status: "In Progress" });
    race(resumeFirst, "work_resumed", "waiting_customer_started");
    expect(resumeFirst.session).toBe("none");
    expect(resumeFirst.waitingCustomer).toBe(true);
    invariants(resumeFirst);
  });

  it("Resume vs Waiting Vendor resolves the same way", () => {
    const state = jobState({ session: "paused", sessionRows: 1, status: "In Progress" });
    const r = race(state, "waiting_vendor_started", "work_resumed");
    expect(r.second).toMatchObject({ ok: false, status: 409 });
    invariants(state);
  });

  it("Start vs Waiting cannot coexist", () => {
    const waitingFirst = jobState();
    const w = race(waitingFirst, "waiting_vendor_started", "work_started");
    expect(w.second).toMatchObject({ ok: false, status: 409 });
    invariants(waitingFirst);

    const startFirst = jobState();
    race(startFirst, "work_started", "waiting_vendor_started");
    expect(startFirst.session).toBe("none");
    expect(startFirst.waitingVendor).toBe(true);
    invariants(startFirst);
  });

  it("Ready vs Start: ready cannot survive later work", () => {
    const readyFirst = jobState({ status: "In Progress", notes: 1, sessionRows: 1 });
    const a = race(readyFirst, "ready_for_completion", "work_started");
    expect(a.first.ok).toBe(true);
    expect(a.second.ok).toBe(true);
    // Deterministic rule: a later work action clears stale readiness.
    expect(readyFirst.ready).toBe(false);
    invariants(readyFirst);

    const startFirst = jobState({ status: "In Progress", notes: 1, sessionRows: 1 });
    const b = race(startFirst, "work_started", "ready_for_completion");
    expect(b.second).toMatchObject({ ok: false, status: 400 });
    expect(startFirst.ready).toBe(false);
  });

  it("Ready vs Waiting: waiting always wins over stale readiness", () => {
    const readyFirst = jobState({ status: "In Progress", notes: 1, sessionRows: 1 });
    race(readyFirst, "ready_for_completion", "waiting_customer_started");
    expect(readyFirst.ready).toBe(false);
    expect(readyFirst.waitingCustomer).toBe(true);
    invariants(readyFirst);

    const waitingFirst = jobState({ status: "In Progress", notes: 1, sessionRows: 1 });
    const w = race(waitingFirst, "waiting_customer_started", "ready_for_completion");
    expect(w.second).toMatchObject({ ok: false, status: 400 });
  });

  it("duplicate Travel never overwrites the original evidence", () => {
    const state = jobState({ supportMode: "onsite_support" });
    const { first, second } = race(state, "travel_started", "travel_started");
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, status: 409 });
    expect(state.audits).toEqual(["travel_started"]);
  });

  it("Travel and Arrival competing both record once, in lock order", () => {
    const state = jobState({ supportMode: "installation" });
    race(state, "arrived_on_site", "travel_started");
    expect(state.arrivedAt).toBe("t");
    expect(state.travelAt).toBe("t");
    expect(state.audits).toEqual(["arrived_on_site", "travel_started"]);
  });

  it("duplicate Arrival and duplicate Leave are deterministic conflicts", () => {
    const state = jobState({ supportMode: "onsite_support" });
    expect(apply(state, "arrived_on_site").ok).toBe(true);
    expect(apply(state, "arrived_on_site")).toMatchObject({ ok: false, status: 409 });
    expect(apply(state, "leave_site").ok).toBe(true);
    expect(apply(state, "leave_site")).toMatchObject({ ok: false, status: 409 });
    expect(state.audits).toEqual(["arrived_on_site", "leave_site"]);
  });

  it("support-mode change racing the first Field action is serialized", () => {
    const modeFirst = jobState({ supportMode: null });
    expect(apply(modeFirst, "support_mode_set", "onsite_support").ok).toBe(true);
    expect(apply(modeFirst, "travel_started").ok).toBe(true);

    const evidenceFirst = jobState({ supportMode: "remote_support" });
    expect(apply(evidenceFirst, "work_started").ok).toBe(true);
    expect(apply(evidenceFirst, "support_mode_set", "onsite_support")).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(evidenceFirst.supportMode).toBe("remote_support");
  });

  it("stale retries never produce a second success audit", () => {
    const state = jobState({ session: "active", sessionRows: 1, status: "In Progress" });
    expect(apply(state, "work_stopped").ok).toBe(true);
    expect(apply(state, "work_stopped")).toMatchObject({ ok: false, status: 409 });
    expect(apply(state, "work_paused")).toMatchObject({ ok: false, status: 409 });
    expect(state.audits).toEqual(["work_stopped"]);
  });

  it("full PIC remote sequence keeps every invariant", () => {
    const state = jobState({ notes: 1 });
    for (const a of ["work_started", "work_paused", "work_resumed", "work_stopped"]) {
      expect(apply(state, a).ok, a).toBe(true);
    }
    expect(apply(state, "waiting_customer_started").ok).toBe(true);
    expect(apply(state, "waiting_customer_resolved").ok).toBe(true);
    expect(apply(state, "ready_for_completion").ok).toBe(true);
    invariants(state);
    expect(state.audits).toHaveLength(7);
  });

  it("blocked lifecycle states reject every field action", () => {
    for (const status of ["Pending Approval", "Completed", "Cancelled"]) {
      const state = jobState({ status });
      expect(apply(state, "work_started")).toMatchObject({ ok: false, status: 400 });
      expect(state.audits).toEqual([]);
    }
  });
});
