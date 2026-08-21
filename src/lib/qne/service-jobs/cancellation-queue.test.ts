// SH2.2 — Cancellation Decision Queue + Admin Notice.
//
// Executable coverage for the shared pending-cancellation read model, the
// Owner/Admin decision queue API, the Dashboard KPI separation and the
// Admin-only "Cancellation Requested" flag in the ordinary Pending Queue.
// The database is replaced by an in-memory double that reproduces the query
// shapes actually used (tenant scope, pending-only, non-deleted Job join).

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  [k: string]: unknown;
}

const tables: Record<string, Row[]> = {
  service_job_cancellation_requests: [],
  service_jobs: [],
};

/** Minimal thenable PostgREST double: eq / in / order / limit / select-count. */
function builder(table: string) {
  const rows = () => tables[table] ?? [];
  const filters: ((r: Row) => boolean)[] = [];
  let headCount = false;
  let orderKey: string | null = null;
  let ascending = true;

  const api: Record<string, unknown> = {
    select: (_cols: string, opts?: { head?: boolean; count?: string }) => {
      if (opts?.head) headCount = true;
      return api;
    },
    eq: (col: string, val: unknown) => {
      filters.push((r) => r[col] === val);
      return api;
    },
    in: (col: string, vals: unknown[]) => {
      filters.push((r) => vals.includes(r[col]));
      return api;
    },
    is: () => api,
    not: () => api,
    gte: () => api,
    lt: () => api,
    order: (col: string, opts?: { ascending?: boolean }) => {
      orderKey = col;
      ascending = opts?.ascending !== false;
      return api;
    },
    limit: () => api,
    maybeSingle: async () => {
      const list = resolve();
      return { data: list[0] ?? null, error: null };
    },
    then: (resolveFn: (v: unknown) => unknown) => {
      const list = resolve();
      return Promise.resolve(
        headCount
          ? { data: null, count: list.length, error: null }
          : { data: list, count: list.length, error: null },
      ).then(resolveFn);
    },
  };

  function resolve(): Row[] {
    let list = rows().filter((r) => filters.every((f) => f(r)));
    if (orderKey) {
      const key = orderKey;
      list = [...list].sort((a, b) =>
        String(a[key]).localeCompare(String(b[key])) * (ascending ? 1 : -1),
      );
    }
    return list;
  }

  return api;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));

/* ---------------- session double ---------------- */

interface FakeUser {
  tenantCode: string;
  isAdministrator: boolean;
}
let session: FakeUser | null = null;

class UnauthorizedError extends Error {}
class ForbiddenError extends Error {}

vi.mock("@/lib/qne/session/current-user.server", () => ({
  requireAuthenticatedN3User: async () => {
    if (!session) throw new UnauthorizedError();
    return { ...session, userCode: null, diagnostics: { matchedN3UserId: "u1" } };
  },
  requireAdministrator: async () => {
    if (!session) throw new UnauthorizedError();
    if (!session.isAdministrator) throw new ForbiddenError();
    return { ...session, userCode: null, diagnostics: { matchedN3UserId: "u1" } };
  },
  guardResponse: (err: unknown) => {
    if (err instanceof UnauthorizedError) return new Response("Unauthorized", { status: 401 });
    if (err instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    return null;
  },
}));

vi.mock("@/lib/qne/entitlements/query.server", () => ({
  entitlementClock: async () => ({}),
  loadCandidateRecords: async () => [],
  deriveRows: () => [],
  totalsFromRecords: () => ({ customers: 0 }),
}));

/* ---------------- fixtures ---------------- */

function seedJob(patch: Row = {}): string {
  const id = String(patch.id ?? `job-${tables.service_jobs.length + 1}`);
  tables.service_jobs.push({
    tenant_code: "T1",
    job_number: "JB26082101",
    subject: "PRODUCTION ACCEPTANCE TEST - OVERDUE ENTITLEMENT",
    customer_code_snapshot: "C001",
    customer_name_snapshot: "Acme",
    status: "Open",
    priority: "High",
    is_deleted: false,
    assigned_user_id: null,
    assigned_user_name_snapshot: null,
    created_at: "2026-08-21T01:00:00.000Z",
    ...patch,
    id,
  });
  return id;
}

function seedRequest(jobId: string, patch: Row = {}) {
  tables.service_job_cancellation_requests.push({
    id: `req-${tables.service_job_cancellation_requests.length + 1}`,
    tenant_code: "T1",
    service_job_id: jobId,
    status: "pending",
    reason: "PRODUCTION ACCEPTANCE TEST - CANCELLATION REQUEST",
    prior_status: "Open",
    requested_at: "2026-08-21T02:00:00.000Z",
    requested_by_name_snapshot: "MUGS",
    ...patch,
  });
}

type Handler = (arg: { request: Request }) => Promise<Response>;
async function handlers(path: string): Promise<Record<string, Handler>> {
  const mod = (await import(path)) as {
    Route: { options: { server: { handlers: Record<string, Handler> } } };
  };
  return mod.Route.options.server.handlers;
}

function get(url: string): Request {
  return new Request(url, { headers: { Authorization: "Bearer x" } });
}

beforeEach(() => {
  tables.service_jobs = [];
  tables.service_job_cancellation_requests = [];
  session = { tenantCode: "T1", isAdministrator: true };
});

/* ---------------- read model ---------------- */

describe("shared pending-cancellation read model", () => {
  it("counts an active pending request for its own tenant only", async () => {
    const { countPendingCancellationRequests } = await import("./cancellation.server");
    const job = seedJob();
    seedRequest(job);
    expect(await countPendingCancellationRequests("T1")).toBe(1);
    expect(await countPendingCancellationRequests("T2")).toBe(0);
  });

  it("ignores decided requests", async () => {
    const { countPendingCancellationRequests } = await import("./cancellation.server");
    const job = seedJob();
    seedRequest(job, { status: "rejected", decision: "rejected" });
    expect(await countPendingCancellationRequests("T1")).toBe(0);
  });

  it("excludes deleted and missing Jobs from the actionable queue", async () => {
    const { loadPendingCancellationQueue } = await import("./cancellation.server");
    const deleted = seedJob({ id: "job-del", is_deleted: true });
    seedRequest(deleted);
    seedRequest("job-missing");
    expect(await loadPendingCancellationQueue("T1")).toHaveLength(0);
  });

  it("returns request context alongside the current Job status", async () => {
    const { loadPendingCancellationQueue } = await import("./cancellation.server");
    const job = seedJob();
    seedRequest(job);
    const [row] = await loadPendingCancellationQueue("T1");
    expect(row.job_status).toBe("Open");
    expect(row.prior_status).toBe("Open");
    expect(row.requested_by_name).toBe("MUGS");
    expect(row.reason).toContain("CANCELLATION REQUEST");
    expect(row.job_number).toBe("JB26082101");
  });

  it("flags only Jobs with an active request", async () => {
    const { pendingCancellationJobIds } = await import("./cancellation.server");
    const a = seedJob({ id: "job-a" });
    const b = seedJob({ id: "job-b" });
    seedRequest(a);
    const flagged = await pendingCancellationJobIds("T1", [a, b]);
    expect(flagged.has("job-a")).toBe(true);
    expect(flagged.has("job-b")).toBe(false);
  });
});

/* ---------------- admin queue API ---------------- */

describe("GET /api/admin/cancellation-requests", () => {
  const PATH = "@/routes/api/admin/cancellation-requests";

  it("returns pending requests to an Owner/Admin", async () => {
    const job = seedJob();
    seedRequest(job);
    const h = await handlers(PATH);
    const res = await h.GET({ request: get("https://app.test/api/admin/cancellation-requests") });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; requests: Row[] };
    expect(body.total).toBe(1);
    expect(body.requests[0].job_status).toBe("Open");
  });

  it("denies a Normal User", async () => {
    session = { tenantCode: "T1", isAdministrator: false };
    const h = await handlers(PATH);
    const res = await h.GET({ request: get("https://app.test/api/admin/cancellation-requests") });
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated callers", async () => {
    session = null;
    const h = await handlers(PATH);
    const res = await h.GET({ request: get("https://app.test/api/admin/cancellation-requests") });
    expect(res.status).toBe(401);
  });

  it("hides other tenants and honours bounded search and pagination", async () => {
    const mine = seedJob();
    seedRequest(mine);
    const theirs = seedJob({ id: "job-x", tenant_code: "T2", job_number: "JB9" });
    seedRequest(theirs, { tenant_code: "T2" });
    const h = await handlers(PATH);
    const all = await h.GET({ request: get("https://app.test/api?pageSize=1&page=1") });
    const body = (await all.json()) as { total: number; requests: Row[]; pageSize: number };
    expect(body.total).toBe(1);
    expect(body.pageSize).toBe(1);

    const miss = await h.GET({ request: get("https://app.test/api?q=nothing-here") });
    expect(((await miss.json()) as { total: number }).total).toBe(0);
  });

  it("exposes no mutating handler", async () => {
    const h = await handlers(PATH);
    expect(Object.keys(h)).toEqual(["GET"]);
  });
});

/* ---------------- dashboard KPI separation ---------------- */

describe("GET /api/admin/dashboard cancellation KPI", () => {
  it("keeps Job Approvals and Cancellation Requests independent", async () => {
    const open = seedJob({ id: "job-open", status: "Open" });
    seedRequest(open);
    seedJob({ id: "job-appr", status: "Pending Approval" });
    const h = await handlers("@/routes/api/admin/dashboard");
    const res = await h.GET({ request: get("https://app.test/api/admin/dashboard") });
    const body = (await res.json()) as {
      summary: { pendingApproval: number; cancellationRequests: number };
    };
    expect(body.summary.pendingApproval).toBe(1);
    expect(body.summary.cancellationRequests).toBe(1);
  });

  it("is Administrator-only", async () => {
    session = { tenantCode: "T1", isAdministrator: false };
    const h = await handlers("@/routes/api/admin/dashboard");
    const res = await h.GET({ request: get("https://app.test/api/admin/dashboard") });
    expect(res.status).toBe(403);
  });
});

/* ---------------- pending queue flag ---------------- */

describe("GET /api/workspace/jobs/pending cancellation flag", () => {
  const PATH = "@/routes/api/workspace/jobs.pending";

  it("flags the Job once for an Admin without changing its status", async () => {
    const job = seedJob();
    seedRequest(job);
    const h = await handlers(PATH);
    const res = await h.GET({ request: get("https://app.test/api/workspace/jobs/pending") });
    const body = (await res.json()) as { jobs: Row[] };
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].status).toBe("Open");
    expect(body.jobs[0].has_active_cancellation_request).toBe(true);
  });

  it("sends no tenant-wide cancellation metadata to a Normal User", async () => {
    const job = seedJob();
    seedRequest(job);
    session = { tenantCode: "T1", isAdministrator: false };
    const h = await handlers(PATH);
    const res = await h.GET({ request: get("https://app.test/api/workspace/jobs/pending") });
    const body = (await res.json()) as { jobs: Row[] };
    expect(body.jobs[0].has_active_cancellation_request).toBeUndefined();
  });

  it("drops the flag once the request is decided", async () => {
    const job = seedJob();
    seedRequest(job, { status: "rejected" });
    const h = await handlers(PATH);
    const res = await h.GET({ request: get("https://app.test/api/workspace/jobs/pending") });
    const body = (await res.json()) as { jobs: Row[] };
    expect(body.jobs[0].has_active_cancellation_request).toBe(false);
  });
});
