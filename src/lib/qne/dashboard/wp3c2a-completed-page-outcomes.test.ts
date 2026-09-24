import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveOutcome } from "@/lib/qne/service-jobs/wp3b";

const route = readFileSync("src/routes/api/workspace/jobs.pending.ts", "utf8");
const loader = readFileSync("src/lib/qne/service-jobs/wp3b.server.ts", "utf8");

describe("WP3C-2A Completed page outcomes", () => {
  const dbBlock = route.slice(route.indexOf("if (dbPaged)"), route.indexOf("return Response.json", route.indexOf("if (dbPaged)")) + 600);

  it("db-paged Completed path attaches outcome from page-bounded IDs", () => {
    expect(dbBlock).toContain('queueType === "completed" && list.length > 0');
    expect(dbBlock).toContain("const pageIds = list.map((r) => r.id)");
    expect(dbBlock).toContain("loadPageOutcomes(user.tenantCode, pageIds)");
    expect(dbBlock).toMatch(/outcome: pageOutcomes\.get\(r\.id\) \?\? null/);
  });

  it("Cancelled / All Jobs rows are not decorated", () => {
    expect(dbBlock).toContain('...(queueType === "completed" ? { outcome:');
  });

  it("loader accepts an optional bounded ID set and keeps default behaviour", () => {
    expect(loader).toMatch(/loadCompletionOutcomes\(\s*tenantCode: string,\s*jobIds\?: readonly string\[\]/);
    expect(loader).toContain('if (jobIds) jobsQuery = jobsQuery.in("id", [...jobIds])');
    expect(loader).toContain("if (jobIds && jobIds.length === 0) return [];");
    expect(loader).toContain('.eq("tenant_code", tenantCode)');
  });

  it("cleared follow-up derives Resolved after Follow-up, never Follow-up Open", () => {
    const o = deriveOutcome({
      jobStatus: "Completed",
      isDeleted: false,
      completion: { follow_up_required: true, completed_by_user_id: "u1" },
      followup: { status: "resolved", resolved_by_user_id: "u2", resolved_at: new Date().toISOString() } as never,
      hasPendingReopen: false,
    });
    expect(o).toBe("resolved_after_follow_up");
    expect(o).not.toBe("follow_up_open");
  });
});
