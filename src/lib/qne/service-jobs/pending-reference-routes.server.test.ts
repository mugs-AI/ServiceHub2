import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const fixture = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  user: { tenantCode: "A", isAdministrator: true } as {
    tenantCode: string;
    isAdministrator: boolean;
  } | null,
}));
function query(table: string) {
  const predicates: Array<(row: Row) => boolean> = [];
  let columns = "*",
    from = 0,
    to = Infinity;
  const api = {
    select(value: string) {
      columns = value;
      return api;
    },
    eq(key: string, value: unknown) {
      predicates.push((row) => row[key] === value);
      return api;
    },
    in(key: string, values: unknown[]) {
      predicates.push((row) => values.includes(row[key]));
      return api;
    },
    is(key: string, value: unknown) {
      return api.eq(key, value);
    },
    gte() {
      return api;
    },
    lte() {
      return api;
    },
    lt() {
      return api;
    },
    order() {
      return api;
    },
    limit(n: number) {
      to = n - 1;
      return api;
    },
    range(a: number, b: number) {
      from = a;
      to = b;
      return api;
    },
    or(value: string) {
      // Decode PostgREST quoted values, then apply PostgreSQL LIKE wildcard/escape semantics.
      const token = /([a-z_]+)\.(ilike|imatch)\.("(?:\\.|[^"\\])*"|[^,]+)/gy;
      const terms: Array<(row: Row) => boolean> = [];
      let position = 0;
      while (position < value.length) {
        token.lastIndex = position;
        const term = token.exec(value);
        if (!term) throw new Error("Invalid OR predicate");
        const decoded: string = term[3].startsWith('"') ? JSON.parse(term[3]) : term[3];
        const pattern = term[2] === "ilike" ? decoded.replace(/\*/g, "%") : decoded;
        let expression = term[2] === "imatch" ? pattern : "^";
        for (let index = 0; term[2] === "ilike" && index < pattern.length; index++) {
          const char = pattern[index];
          if (char === "\\") expression += escapeRegex(pattern[++index]);
          else expression += char === "%" ? ".*" : char === "_" ? "." : escapeRegex(char);
        }
        const match = new RegExp(expression + (term[2] === "ilike" ? "$" : ""), "i");
        terms.push((row) => match.test(String(row[term[1]] ?? "")));
        position = token.lastIndex;
        if (position < value.length && value[position++] !== ",")
          throw new Error("Invalid OR separator");
      }
      predicates.push((row) => terms.some((term) => term(row)));
      return api;
    },
    then(resolve: (value: unknown) => unknown) {
      const rows = (fixture.tables[table] ?? []).filter((row) => predicates.every((p) => p(row)));
      const data = rows.slice(from, to + 1).map((row) =>
        columns === "*"
          ? row
          : Object.fromEntries(
              columns
                .split(",")
                .map((key) => key.trim())
                .map((key) => [key, row[key] ?? null]),
            ),
      );
      return Promise.resolve({ data, count: rows.length, error: null }).then(resolve);
    },
  };
  return api;
}
function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: query } }));
vi.mock("@/lib/qne/session/current-user.server", () => ({
  requireAuthenticatedN3User: async () => {
    if (!fixture.user) throw new Error("unauthorized");
    return { ...fixture.user, diagnostics: { matchedN3UserId: "user-A" } };
  },
  requireAdministrator: async () => {
    if (!fixture.user) throw new Error("unauthorized");
    if (!fixture.user.isAdministrator) throw new Error("forbidden");
    return fixture.user;
  },
  guardResponse: (error: Error) =>
    error.message === "unauthorized"
      ? new Response(null, { status: 401 })
      : error.message === "forbidden"
        ? new Response(null, { status: 403 })
        : null,
}));
beforeEach(() => {
  fixture.user = { tenantCode: "A", isAdministrator: true };
  fixture.tables = {
    service_jobs: [
      {
        id: "job-A",
        tenant_code: "A",
        job_number: "JB001",
        subject: "Example repair",
        customer_name_snapshot: "Example customer",
        customer_code_snapshot: "C001",
        latest_customer_ref_no: "CUST-42",
        latest_vendor_ref_no: "VEND-42",
        status: "Waiting Vendor",
        is_deleted: false,
        priority: "High",
        created_at: "2026-10-01T00:00:00Z",
      },
      {
        id: "job-B",
        tenant_code: "B",
        job_number: "JB002",
        subject: "Other company",
        latest_customer_ref_no: "CUST-42",
        latest_vendor_ref_no: "VEND-42",
        status: "Waiting Vendor",
        is_deleted: false,
        priority: "High",
        created_at: "2026-10-01T00:00:00Z",
      },
    ],
    service_job_cancellation_requests: [],
    service_job_reopen_requests: [],
  };
  for (const table of ["service_job_cancellation_requests", "service_job_reopen_requests"]) {
    fixture.tables[table] = ["A", "B"].map((tenant) => ({
      id: "request-" + tenant,
      tenant_code: tenant,
      service_job_id: "job-" + tenant,
      status: "pending",
      reason: "Example request",
      prior_status: "Assigned",
      requested_at: "2026-10-01T01:00:00Z",
      requested_by_name_snapshot: "Example staff",
    }));
  }
});
const endpoints = [
  [
    "@/routes/api/workspace/jobs.pending",
    "/api/workspace/jobs/pending?queueType=waiting_vendor",
    "jobs",
  ],
  ["@/routes/api/admin/cancellation-requests", "/api/admin/cancellation-requests?", "requests"],
  ["@/routes/api/workspace/reopen-requests", "/api/workspace/reopen-requests?", "requests"],
] as const;
async function read(path: string, url: string) {
  const { Route } = await import(path);
  return Route.options.server.handlers.GET({ request: new Request("https://test.invalid" + url) });
}
describe("Pending reference search across authorized queues", () => {
  for (const [path, url, collection] of endpoints) {
    for (const reference of [
      "VEND_42",
      "VEND*42",
      "VEND.*[42](A)+?^$|",
      "CUST(42)",
      'A,%_\\"(42)',
      "X),tenant_code.eq.B,subject.ilike.(Y",
    ]) {
      it(path + " preserves literal reference punctuation " + reference, async () => {
        fixture.tables.service_jobs[0].latest_vendor_ref_no = reference;
        fixture.tables.service_jobs[1].latest_vendor_ref_no = reference;
        fixture.tables.service_jobs.push({
          ...fixture.tables.service_jobs[0],
          id: "decoy",
          latest_vendor_ref_no: reference.includes("*") ? reference.replace(/\*/g, "X") : "VENDX42",
        });
        const response = await read(path, url + "&q=" + encodeURIComponent(reference));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.total).toBe(1);
        expect(body[collection][0].latest_vendor_ref_no).toBe(reference);
      });
    }
    for (const ref of ["VEND-42", "CUST-42"]) {
      it(path + " finds " + ref + " and excludes the other tenant", async () => {
        const response = await read(path, url + "&q=" + ref);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.total).toBe(1);
        expect(body[collection][0]).toMatchObject({
          job_number: "JB001",
          latest_customer_ref_no: "CUST-42",
          latest_vendor_ref_no: "VEND-42",
        });
      });
    }
    it(path + " keeps a no-match search empty", async () => {
      expect((await (await read(path, url + "&q=missing")).json()).total).toBe(0);
    });
    it(path + " rejects unauthenticated requests", async () => {
      fixture.user = null;
      expect((await read(path, url)).status).toBe(401);
    });
  }
  it("keeps cancellation decisions admin-only", async () => {
    fixture.user!.isAdministrator = false;
    expect((await read(endpoints[1][0], endpoints[1][1])).status).toBe(403);
  });
  it("reference search cannot remove the waiting-status filter", async () => {
    fixture.tables.service_jobs[0].status = "Completed";
    expect((await (await read(endpoints[0][0], endpoints[0][1] + "&q=VEND-42")).json()).total).toBe(
      0,
    );
  });
});
