import { describe, expect, it } from "vitest";
import { OWNER_ADMIN_ACCESS, NORMAL_USER_DEFAULT } from "./permissions";
import { availableJobColumns, parseJobDetailsQuery, projectJobRow } from "./job-details";
const viewer = { ...NORMAL_USER_DEFAULT, can_view: true },
  now = new Date("2026-09-30T00:00:00Z");
describe("Job Details input and disclosure", () => {
  it("defaults to three Malaysia calendar months and twenty rows", () => {
    expect(parseJobDetailsQuery(new URLSearchParams(), viewer, now)).toMatchObject({
      from: "2026-07-01",
      to: "2026-09-30",
      page: 1,
      pageSize: 20,
      sort: "created_at",
      direction: "desc",
    });
  });
  it("rejects invalid ranges, paging, sorting and unsupported wildcard", () => {
    for (const p of [
      "from=2026-02-30",
      "from=2026-10-01&to=2026-09-01",
      "page=0",
      "page=1.5",
      "pageSize=200",
      "sort=tenant_code",
      "direction=bad",
      "q=*",
    ]) {
      expect(() => parseJobDetailsQuery(new URLSearchParams(p), viewer, now)).toThrow();
    }
  });
  it("keeps deliberate empty dates and trims padded dates", () => {
    expect(parseJobDetailsQuery(new URLSearchParams("from=&to="), viewer, now)).toMatchObject({
      from: "",
      to: "",
    });
    expect(
      parseJobDetailsQuery(
        new URLSearchParams({ from: " 2026-09-30 ", to: " 2026-09-30 " }),
        viewer,
        now,
      ),
    ).toMatchObject({ from: "2026-09-30", to: "2026-09-30" });
  });
  it("rejects private, GPS, tenant and wildcard filter attempts", () => {
    for (const key of [
      "internal_note",
      "approval_remark_private",
      "clock_in_latitude",
      "tenant_code",
    ]) {
      expect(() =>
        parseJobDetailsQuery(
          new URLSearchParams({ filters: JSON.stringify({ [key]: "secret" }) }),
          viewer,
          now,
        ),
      ).toThrow();
    }
    expect(() =>
      parseJobDetailsQuery(new URLSearchParams({ filters: '{"subject":"*"}' }), viewer, now),
    ).toThrow();
    expect(availableJobColumns(viewer).map((c) => c.key)).not.toContain("internal_note");
  });
  it("projects only granted fields from unexpected database contents", () => {
    const raw = {
      id: "job-1",
      job_number: "JB26093001",
      internal_note: "PRIVATE",
      tenant_code: "OTHER",
      token: "SECRET",
      clock_in_latitude: 4.6,
    };
    expect(projectJobRow(raw, viewer)).not.toHaveProperty("internal_note");
    expect(projectJobRow(raw, viewer)).not.toHaveProperty("clock_in_latitude");
    expect(projectJobRow(raw, OWNER_ADMIN_ACCESS)).not.toHaveProperty("token");
    expect(projectJobRow(raw, OWNER_ADMIN_ACCESS)).not.toHaveProperty("tenant_code");
    expect(projectJobRow(raw, OWNER_ADMIN_ACCESS).internal_note).toBe("PRIVATE");
  });
  it("validates date and integer column filters", () => {
    const valid = {
      completed_at__from: "2026-09-01",
      completed_at__to: "2026-09-30",
      total_work_minutes: "60",
      status: "Completed",
    };
    expect(
      parseJobDetailsQuery(new URLSearchParams({ filters: JSON.stringify(valid) }), viewer, now)
        .filters.total_work_minutes,
    ).toBe("60");
    for (const filter of [
      { completed_at__from: "2026-02-30" },
      { total_work_minutes: "-1" },
      { total_work_minutes: "1.5" },
      { total_work_minutes: "2147483648" },
      { status: "invented" },
    ])
      expect(() =>
        parseJobDetailsQuery(new URLSearchParams({ filters: JSON.stringify(filter) }), viewer, now),
      ).toThrow();
  });
});
