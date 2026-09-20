// WP3 — POST /api/workspace/jobs/$jobId/complete regression: the route must
// not reject a Completed Job before the RPC. An in-memory transactional double
// reproduces the RPC's invariants (idempotent identical retry, 409 non-identical
// retry, 403 unauthorised, 409 open GPS attendance) so the lost-response retry
// path is exercised end to end.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Bind the mocked module registry before any route handler dynamically imports it.
import * as sessionModule from "@/lib/qne/session/current-user.server";

/* ---------------- session double ---------------- */

interface FakeUser {
  tenantCode: string;
  isAdministrator: boolean;
  userId: string;
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
      userCode: session.userId,
      diagnostics: { matchedN3UserId: session.userId },
    };
  },
  guardResponse: (err: unknown) => {
    if (err instanceof UnauthorizedError)
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    return null;
  },
}));

/* ---------------- RPC transactional double ---------------- */

interface JobRow {
  id: string;
  tenant_code: string;
  status: string;
  is_deleted: boolean;
  assigned_user_id: string | null;
}

interface CompletionRow {
  tenant_code: string;
  service_job_id: string;
  resolution_summary: string;
  follow_up_required: boolean;
  completed_by_user_id: string;
  completed_at: string;
}

const jobs = new Map<string, JobRow>();
const completions = new Map<string, CompletionRow>();
let openAttendance = 0;
let rpcCalls = 0;

vi.mock("@/lib/qne/service-jobs/wp3-completion.server", () => ({
  completeJobAtomic: async (
    actor: { tenantCode: string; userId: string; isAdmin: boolean },
    jobId: string,
    input: { resolutionSummary: string; followUpRequired: boolean },
  ) => {
    rpcCalls += 1;
    const job = jobs.get(jobId);
    if (!job || job.tenant_code !== actor.tenantCode)
      return { outcome: "error", error: "Job not found.", status: 404 };
    const assigned = job.assigned_user_id === actor.userId;
    if (!assigned && !actor.isAdmin)
      return { outcome: "error", error: "Not allowed.", status: 403 };
    const key = `${actor.tenantCode}:${jobId}`;
    const existing = completions.get(key);
    if (job.status === "Completed") {
      if (
        existing &&
        existing.completed_by_user_id === actor.userId &&
        existing.resolution_summary === input.resolutionSummary &&
        existing.follow_up_required === input.followUpRequired
      ) {
        // Idempotent branch of the RPC: identical retry after a lost response.
        return {
          outcome: "ok",
          idempotent: true,
          completion_id: key,
          completed_at: existing.completed_at,
        };
      }
      return { outcome: "error", error: "Job is already completed.", status: 409 };
    }
    if (job.is_deleted || job.status === "Cancelled" || job.status === "Pending Approval")
      return { outcome: "error", error: "Job cannot be completed.", status: 409 };
    if (openAttendance > 0)
      return { outcome: "error", error: "Open on-site attendance.", status: 409 };
    const row: CompletionRow = {
      tenant_code: actor.tenantCode,
      service_job_id: jobId,
      resolution_summary: input.resolutionSummary,
      follow_up_required: input.followUpRequired,
      completed_by_user_id: actor.userId,
      completed_at: new Date().toISOString(),
    };
    completions.set(key, row);
    job.status = "Completed";
    return { outcome: "ok", idempotent: false, completion_id: key, completed_at: row.completed_at };
  },
}));

/* ---------------- invocation ---------------- */

type Handler = (arg: {
  request: Request;
  params: Record<string, string>;
}) => Promise<Response>;

async function post(): Promise<Handler> {
  const mod = (await import("@/routes/api/workspace/jobs.$jobId.complete")) as {
    Route: { options: { server: { handlers: Record<string, Handler> } } };
  };
  return mod.Route.options.server.handlers.POST;
}

const JOB_ID = "job-1";
const TECH: FakeUser = {
  tenantCode: "T1",
  isAdministrator: false,
  userId: "tech-1",
  displayName: "Tech",
  email: "tech@t1.test",
};

function req(body: unknown): Request {
  return new Request("https://app.test/api/workspace/jobs/job-1/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer x" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jobs.clear();
  completions.clear();
  openAttendance = 0;
  rpcCalls = 0;
  session = TECH;
  jobs.set(JOB_ID, {
    id: JOB_ID,
    tenant_code: "T1",
    status: "In Progress",
    is_deleted: false,
    assigned_user_id: "tech-1",
  });
});

describe("POST retry idempotency", () => {
  it("does not reject a Completed Job before the RPC: an identical lost-response retry succeeds idempotently", async () => {
    const handler = await post();
    const body = { resolutionSummary: "Fixed the unit.", followUpRequired: false };

    const first = await handler({ request: req(body), params: { jobId: JOB_ID } });
    expect(first.status).toBe(200);
    expect(jobs.get(JOB_ID)!.status).toBe("Completed");
    expect(completions.size).toBe(1);

    // The Job is now Completed. A route-side completionBlockedReason precheck
    // would return 409 here without ever calling the RPC; the retry must
    // instead reach the RPC's idempotent branch.
    const retry = await handler({ request: req(body), params: { jobId: JOB_ID } });
    expect(rpcCalls).toBe(2);
    expect(retry.status).toBe(200);
    const payload = (await retry.json()) as { ok: boolean; idempotent: boolean };
    expect(payload.ok).toBe(true);
    expect(payload.idempotent).toBe(true);
    expect(completions.size).toBe(1);
  });

  it("keeps a non-identical retry as a 409 conflict from the RPC", async () => {
    const handler = await post();
    await handler({
      request: req({ resolutionSummary: "Fixed the unit.", followUpRequired: false }),
      params: { jobId: JOB_ID },
    });

    const changed = await handler({
      request: req({ resolutionSummary: "Different summary.", followUpRequired: true }),
      params: { jobId: JOB_ID },
    });
    expect(changed.status).toBe(409);
    expect(completions.size).toBe(1);
  });

  it("still surfaces the RPC's 403 for an unassigned teammate", async () => {
    session = { ...TECH, userId: "helper-9" };
    const handler = await post();
    const res = await handler({
      request: req({ resolutionSummary: "Fixed.", followUpRequired: false }),
      params: { jobId: JOB_ID },
    });
    expect(res.status).toBe(403);
    expect(jobs.get(JOB_ID)!.status).toBe("In Progress");
  });

  it("still surfaces the RPC's 409 while open GPS attendance exists", async () => {
    openAttendance = 1;
    const handler = await post();
    const res = await handler({
      request: req({ resolutionSummary: "Fixed.", followUpRequired: false }),
      params: { jobId: JOB_ID },
    });
    expect(res.status).toBe(409);
    expect(completions.size).toBe(0);
  });
});

void sessionModule;
