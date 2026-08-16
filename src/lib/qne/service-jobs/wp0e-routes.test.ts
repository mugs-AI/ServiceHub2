// WP0E verification closure — route-level evidence that the SME collaboration
// model behaves as approved: collaborative transitions, explicit Primary PIC
// takeover, teammate scheduling, and no generic Cancel/Complete bypass.
//
// The handlers run for real against an in-memory Supabase double.

import { beforeEach, describe, expect, it, vi } from "vitest";

/* ---------------- session double ---------------- */

interface FakeUser {
  tenantCode: string;
  isAdministrator: boolean;
  userId: string | null;
  displayName: string;
  email: string;
}

let session: FakeUser | null = null;
class UnauthorizedError extends Error {}

vi.mock("@/lib/qne/session/current-user.server", () => ({
  requireAuthenticatedN3User: async () => {
    if (!session) throw new UnauthorizedError("Authentication required");
    return {
      tenantCode: session.tenantCode,
      isAdministrator: session.isAdministrator,
      displayName: session.displayName,
      email: session.email,
      userCode: null,
      diagnostics: { matchedN3UserId: session.userId },
    };
  },
  guardResponse: (err: unknown) =>
    err instanceof UnauthorizedError ? Response.json({ error: "Unauthorized" }, { status: 401 }) : null,
}));

/* ---------------- supabase double ---------------- */

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};

interface Filter {
  kind: "eq" | "neq" | "notIn" | "notNull" | "gte" | "gt" | "lte" | "lt";
  col: string;
  value: unknown;
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = row[f.col];
    if (f.kind === "eq") return v === f.value;
    if (f.kind === "neq") return v !== f.value;
    if (f.kind === "notIn") return !(f.value as unknown[]).includes(v);
    if (f.kind === "notNull") return v !== null && v !== undefined;
    if (v === null || v === undefined) return false;
    if (f.kind === "gte") return String(v) >= String(f.value);
    if (f.kind === "gt") return String(v) > String(f.value);
    if (f.kind === "lte") return String(v) <= String(f.value);
    return String(v) < String(f.value);
  });
}

function query(table: string, op: "select" | "update" | "insert" | "delete", payload?: Row) {
  const filters: Filter[] = [];
  const rows = () => (db[table] ??= []);

  const run = (): Row[] => {
    if (op === "insert") {
      rows().push({ ...(payload as Row) });
      return [rows()[rows().length - 1]];
    }
    const hit = rows().filter((r) => matches(r, filters));
    if (op === "update") hit.forEach((r) => Object.assign(r, payload));
    if (op === "delete") db[table] = rows().filter((r) => !matches(r, filters));
    return hit.map((r) => ({ ...r }));
  };

  const builder: Record<string, unknown> = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    eq: (col: string, value: unknown) => (filters.push({ kind: "eq", col, value }), builder),
    neq: (col: string, value: unknown) => (filters.push({ kind: "neq", col, value }), builder),
    gte: (col: string, value: unknown) => (filters.push({ kind: "gte", col, value }), builder),
    lte: (col: string, value: unknown) => (filters.push({ kind: "lte", col, value }), builder),
    gt: (col: string, value: unknown) => (filters.push({ kind: "gt", col, value }), builder),
    lt: (col: string, value: unknown) => (filters.push({ kind: "lt", col, value }), builder),
    or: () => builder,
    not: (col: string, op: string, list: string | null) => {
      if (op === "is" || list === null) {
        filters.push({ kind: "notNull", col, value: null });
        return builder;
      }
      const values = list.replace(/[()"]/g, "").split(",");
      filters.push({ kind: "notIn", col, value: values });
      return builder;
    },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => {
      const r = run();
      return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { message: "no row" } };
    },
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
      Promise.resolve({ data: run(), error: null }).then(resolve),
  };
  return builder;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => query(table, "select"),
      update: (patch: Row) => query(table, "update", patch),
      insert: (row: Row) => query(table, "insert", row),
      delete: () => query(table, "delete"),
    }),
  },
}));

/* ---------------- helpers ---------------- */

type Handler = (arg: { request: Request; params: Record<string, string> }) => Promise<Response>;

async function handlers(path: string): Promise<Record<string, Handler>> {
  const mod = (await import(path)) as {
    Route: { options: { server: { handlers: Record<string, Handler> } } };
  };
  return mod.Route.options.server.handlers;
}

const JOB_ID = "job-1";

function req(body?: unknown, method = "POST"): Request {
  return new Request("https://app.test/api", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

function seedJob(patch: Row = {}, id = JOB_ID) {
  db["service_jobs"] ??= [];
  db["service_jobs"] = db["service_jobs"].filter((r) => r.id !== id);
  db["service_jobs"].push({
    id,
    tenant_code: "T1",
    job_number: "JB26010101",
    status: "Assigned",
    is_deleted: false,
    requires_approval: false,
    created_by_user_id: "u-creator",
    assigned_user_id: "u-pic",
    assigned_user_name_snapshot: "PIC",
    scheduled_start_at: null,
    scheduled_end_at: null,
    schedule_status: "Unscheduled",
    ...patch,
  });
}

const job = () => db["service_jobs"].find((r) => r.id === JOB_ID)!;
const log = (type: string) =>
  (db["service_job_activity_log"] ?? []).filter((r) => r.event_type === type);

const HELPER: FakeUser = {
  tenantCode: "T1",
  isAdministrator: false,
  userId: "u-helper",
  displayName: "Helper",
  email: "helper@t1.test",
};
const PIC: FakeUser = { ...HELPER, userId: "u-pic", displayName: "PIC", email: "pic@t1.test" };

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  session = HELPER;
  seedJob();
});

/* ---------------- E.1 collaborative transitions ---------------- */

describe("E.1 collaborative transitions (teammate, not Primary PIC)", () => {
  const cases: Array<[string, string]> = [
    ["Open", "In Progress"],
    ["Assigned", "In Progress"],
    ["In Progress", "Waiting Customer"],
    ["In Progress", "Waiting Vendor"],
    ["Waiting Customer", "In Progress"],
    ["Waiting Vendor", "In Progress"],
  ];

  it.each(cases)("%s → %s succeeds and does not change the Primary PIC", async (from, to) => {
    seedJob({ status: from });
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.status");
    const res = await h.POST({ request: req({ to }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(200);
    expect(job().status).toBe(to);
    expect(job().assigned_user_id).toBe("u-pic");
    expect(job().assigned_user_name_snapshot).toBe("PIC");
    expect(log("status_changed")).toHaveLength(1);
  });

  it("records the acting teammate, not the Primary PIC, in the timeline", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.status");
    await h.POST({ request: req({ to: "In Progress" }), params: { jobId: JOB_ID } });
    expect(log("status_changed")[0]).toMatchObject({
      performed_by_user_id: "u-helper",
      performed_by_name_snapshot: "Helper",
      old_value: "Assigned",
      new_value: "In Progress",
    });
  });

  it("a deleted Job is still refused", async () => {
    seedJob({ is_deleted: true });
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.status");
    const res = await h.POST({ request: req({ to: "In Progress" }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(400);
    expect(job().status).toBe("Assigned");
  });
});

/* ---------------- E.2 no generic terminal bypass ---------------- */

describe("E.2 generic /status cannot reach a terminal state", () => {
  it("rejects to = Completed", async () => {
    seedJob({ status: "In Progress" });
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.status");
    const res = await h.POST({ request: req({ to: "Completed" }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(400);
    expect(job().status).toBe("In Progress");
    expect(log("status_changed")).toHaveLength(0);
  });

  it("rejects to = Cancelled even for an Administrator with a reason", async () => {
    session = { ...PIC, isAdministrator: true };
    seedJob({ status: "In Progress" });
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.status");
    const res = await h.POST({
      request: req({ to: "Cancelled", reason: "bypass attempt" }),
      params: { jobId: JOB_ID },
    });
    expect(res.status).toBe(400);
    expect(job().status).toBe("In Progress");
    expect(job().cancelled_at).toBeUndefined();
    expect(log("job_cancelled")).toHaveLength(0);
  });

  it("rejects an unknown status", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.status");
    const res = await h.POST({ request: req({ to: "Archived" }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(400);
  });
});

/* ---------------- E.3 Primary PIC takeover ---------------- */

describe("E.3 explicit Primary PIC takeover", () => {
  it("claiming an unassigned Open Job assigns it and advances to Assigned", async () => {
    seedJob({ status: "Open", assigned_user_id: null, assigned_user_name_snapshot: null });
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.claim");
    const res = await h.POST({ request: req({}), params: { jobId: JOB_ID } });
    expect(res.status).toBe(200);
    expect((await res.json()).action).toBe("assigned");
    expect(job()).toMatchObject({ status: "Assigned", assigned_user_id: "u-helper" });
    expect(log("reassigned")).toHaveLength(0);
  });

  it("taking over another person's Job without a reason is refused", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.claim");
    const res = await h.POST({ request: req({ reason: "   " }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(400);
    expect(job().assigned_user_id).toBe("u-pic");
  });

  it("taking over with a reason succeeds and records both parties", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.claim");
    const res = await h.POST({
      request: req({ reason: "PIC on leave" }),
      params: { jobId: JOB_ID },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).action).toBe("reassigned");
    expect(job().assigned_user_id).toBe("u-helper");
    expect(log("reassigned")[0]).toMatchObject({
      old_value: "PIC",
      new_value: "Helper",
      note: "Primary PIC takeover: PIC on leave",
    });
    expect(db["service_job_assignment_history"][0]).toMatchObject({
      action: "reassigned",
      previous_assigned_user_id: "u-pic",
      assigned_user_id: "u-helper",
    });
  });

  it("claiming a Job already assigned to me is a no-op", async () => {
    session = PIC;
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.claim");
    const res = await h.POST({ request: req({}), params: { jobId: JOB_ID } });
    expect(res.status).toBe(200);
    expect((await res.json()).noop).toBe(true);
    expect(db["service_job_assignment_history"] ?? []).toHaveLength(0);
  });

  it("terminal and pre-approval Jobs cannot be claimed", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.claim");
    for (const status of ["Completed", "Cancelled", "Draft", "Pending Approval"]) {
      seedJob({ status });
      const res = await h.POST({ request: req({ reason: "x" }), params: { jobId: JOB_ID } });
      expect(res.status).toBe(400);
      expect(job().assigned_user_id).toBe("u-pic");
    }
  });
});

/* ---------------- E.4 collaborative scheduling ---------------- */

describe("E.4 teammate scheduling", () => {
  const start = "2026-03-02T01:00:00.000Z"; // 09:00 Malaysia
  const end = "2026-03-02T03:00:00.000Z";

  it("a teammate who is not the Primary PIC can schedule, and the PIC is preserved", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.schedule");
    const res = await h.POST({ request: req({ start, end }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(200);
    expect(job()).toMatchObject({
      schedule_status: "Scheduled",
      scheduled_start_at: start,
      scheduled_end_at: end,
      assigned_user_id: "u-pic",
      scheduled_by_user_id: "u-helper",
    });
    expect(db["service_job_schedule_history"]).toHaveLength(1);
  });

  it("an unassigned Job cannot be scheduled", async () => {
    seedJob({ assigned_user_id: null });
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.schedule");
    const res = await h.POST({ request: req({ start, end }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(400);
    expect(job().schedule_status).toBe("Unscheduled");
  });

  it("a Pending Approval Job is locked for a Normal User", async () => {
    seedJob({ status: "Pending Approval" });
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.schedule");
    const res = await h.POST({ request: req({ start, end }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(400);
  });

  it("unscheduling clears the appointment and keeps the Primary PIC", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.schedule");
    await h.POST({ request: req({ start, end }), params: { jobId: JOB_ID } });
    const res = await h.DELETE({ request: req({}, "DELETE"), params: { jobId: JOB_ID } });
    expect(res.status).toBe(200);
    expect(job()).toMatchObject({
      schedule_status: "Unscheduled",
      scheduled_start_at: null,
      assigned_user_id: "u-pic",
    });
  });
});
