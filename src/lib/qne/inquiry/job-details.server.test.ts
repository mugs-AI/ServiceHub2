import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { describe, expect, it } from "vitest";
import { NORMAL_USER_DEFAULT, OWNER_ADMIN_ACCESS } from "./permissions";
import { parseJobDetailsQuery } from "./job-details";
import { queryJobDetails } from "./job-details.server";
const access = { ...NORMAL_USER_DEFAULT, can_view: true },
  actor = { tenantCode: "tenant-A", userId: "user-A" };
const rawJob = {
  id: "job-1",
  job_number: "JB26093001",
  subject: "Test",
  created_at: "2026-09-29T20:00:00Z",
  internal_note: "PRIVATE",
  token: "SECRET",
};
function database(rows: Record<string, unknown>[] = [rawJob], count = rows.length) {
  const requests: URL[] = [];
  const db = createClient<Database>("https://test.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        return new Response(JSON.stringify(rows), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Range": `0-${Math.max(0, rows.length - 1)}/${count}`,
          },
        });
      },
    },
  });
  return { db, requests };
}
describe("Job Details database boundary", () => {
  it("walks export pages with invariant scope and rejects duplicate, changed-count or empty pages", async () => {
    let failure: "none" | "duplicate" | "count" | "empty" = "none";
    const offsets: number[] = [];
    const db = createClient<Database>("https://test.invalid", "key", {
      global: {
        fetch: async (input) => {
          const p = new URL(String(input)).searchParams;
          expect(p.get("tenant_code")).toBe("eq.tenant-A");
          expect(p.get("is_deleted")).toBe("eq.false");
          expect(p.get("assigned_user_id")).toBe("eq.user-A");
          expect(p.get("status")).toBe("eq.Completed");
          expect(p.get("order")).toBeTruthy();
          const offset = Number(p.get("offset"));
          offsets.push(offset);
          const rows =
            offset && failure === "empty"
              ? []
              : [0, 1].map((i) => ({
                  ...rawJob,
                  id: String(offset && failure === "duplicate" ? i : offset + i),
                }));
          return new Response(JSON.stringify(rows), {
            headers: {
              "Content-Type": "application/json",
              "Content-Range": `${offset}-${offset + Math.max(rows.length - 1, 0)}/${offset && failure === "count" ? 5 : 4}`,
            },
          });
        },
      },
    });
    const granted = { ...access, can_export_excel: true };
    const input = parseJobDetailsQuery(
      new URLSearchParams({ page: "3", filters: '{"status":"Completed"}' }),
      granted,
    );
    expect((await queryJobDetails(db, actor, granted, input, true)).rows.map((r) => r.id)).toEqual([
      "0",
      "1",
      "2",
      "3",
    ]);
    expect(offsets).toEqual([0, 2]);
    for (const mode of ["duplicate", "count", "empty"] as const) {
      failure = mode;
      await expect(queryJobDetails(db, actor, granted, input, true)).rejects.toThrow(/changed/);
    }
  });
  it("constrains tenant, soft deletion, immutable current assignee and Malaysia date at the database", async () => {
    const { db, requests } = database([rawJob], 30);
    const result = await queryJobDetails(
      db,
      actor,
      access,
      parseJobDetailsQuery(
        new URLSearchParams("from=2026-09-30&to=2026-09-30&page=2&pageSize=20"),
        access,
      ),
    );
    const p = requests[0].searchParams;
    expect(p.get("tenant_code")).toBe("eq.tenant-A");
    expect(p.get("is_deleted")).toBe("eq.false");
    expect(p.get("assigned_user_id")).toBe("eq.user-A");
    expect(p.get("offset")).toBe("20");
    expect(p.getAll("created_at")).toEqual([
      "gte.2026-09-29T16:00:00.000Z",
      "lt.2026-09-30T16:00:00.000Z",
    ]);
    expect(p.get("select")).not.toContain("internal_note");
    expect(result.rows[0]).not.toHaveProperty("internal_note");
    expect(result.rows[0]).not.toHaveProperty("token");
    expect(result.total).toBe(30);
  });
  it("fails closed before any database query for own scope without matched ID or view", async () => {
    const { db, requests } = database();
    const q = parseJobDetailsQuery(new URLSearchParams(), access);
    await expect(queryJobDetails(db, { ...actor, userId: null }, access, q)).rejects.toThrow();
    await expect(queryJobDetails(db, actor, NORMAL_USER_DEFAULT, q)).rejects.toThrow();
    await expect(
      queryJobDetails(db, { ...actor, tenantCode: "" }, OWNER_ADMIN_ACCESS, q),
    ).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
  it("granted company access retains tenant but omits assignee", async () => {
    const { db, requests } = database();
    await queryJobDetails(
      db,
      actor,
      { ...access, scope: "all" },
      parseJobDetailsQuery(new URLSearchParams(), access),
    );
    expect(requests[0].searchParams.get("assigned_user_id")).toBeNull();
    expect(requests[0].searchParams.get("tenant_code")).toBe("eq.tenant-A");
  });
  it("escapes literal text and quotes disjunction input", async () => {
    const { db, requests } = database();
    const filters = { subject: "a%,tenant_code.eq.OTHER", status: "Completed" };
    await queryJobDetails(
      db,
      actor,
      access,
      parseJobDetailsQuery(
        new URLSearchParams({ filters: JSON.stringify(filters), q: 'a",tenant_code.eq.OTHER' }),
        access,
      ),
    );
    const p = requests[0].searchParams;
    expect(p.get("subject")).toBe("ilike.%a\\%,tenant\\_code.eq.OTHER%");
    expect(p.get("status")).toBe("eq.Completed");
    expect(p.get("or")).toContain('\\"');
  });
  it("reads latest GPS attendance only under grant and the same tenant", async () => {
    const row = {
      ...rawJob,
      service_job_onsite_attendance: [
        {
          clock_in_at: "2026-09-30T01:00:00Z",
          clock_in_latitude: 3.12,
          tenant_code: "never-return",
        },
      ],
    };
    const { db, requests } = database([row]);
    const result = await queryJobDetails(
      db,
      actor,
      OWNER_ADMIN_ACCESS,
      parseJobDetailsQuery(new URLSearchParams(), OWNER_ADMIN_ACCESS),
    );
    const p = requests[0].searchParams;
    expect(p.get("select")).toContain("service_job_onsite_attendance(");
    expect(p.get("service_job_onsite_attendance.tenant_code")).toBe("eq.tenant-A");
    expect(p.get("service_job_onsite_attendance.limit")).toBe("1");
    expect(result.rows[0].clock_in_latitude).toBe(3.12);
    expect(result.rows[0]).not.toHaveProperty("tenant_code");
  });
  it("caps export and rejects missing export grant", async () => {
    const { db, requests } = database([rawJob], 10001),
      q = parseJobDetailsQuery(new URLSearchParams(), access);
    await expect(queryJobDetails(db, actor, access, q, true)).rejects.toThrow();
    expect(requests).toHaveLength(0);
    await expect(
      queryJobDetails(db, actor, { ...access, can_export_excel: true }, q, true),
    ).rejects.toThrow(/10,000/);
  });
  it("propagates backend errors", async () => {
    const db = createClient<Database>("https://test.invalid", "key", {
      global: {
        fetch: async () =>
          new Response(JSON.stringify({ message: "unavailable" }), {
            status: 503,
            headers: { "Retry-After": "0" },
          }),
      },
    });
    await expect(
      queryJobDetails(db, actor, access, parseJobDetailsQuery(new URLSearchParams(), access)),
    ).rejects.toThrow();
  });
});
