// WP0E-R — route/API level coverage for the dedicated cancellation process.
//
// The real route handlers are invoked with real Request objects. Session
// resolution and persistence are replaced by in-memory doubles that reproduce
// the database invariants (one active request per Job; conditional
// finalization) so authorization, lifecycle, bypass prevention and
// concurrency/retry behaviour are exercised end to end.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CancellationSettings } from "./cancellation";

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
class ForbiddenError extends Error {}

function ctx(user: FakeUser) {
  return {
    tenantCode: user.tenantCode,
    isAdministrator: user.isAdministrator,
    displayName: user.displayName,
    email: user.email,
    userCode: null,
    diagnostics: { matchedN3UserId: user.userId },
  };
}

vi.mock("@/lib/qne/session/current-user.server", () => ({
  requireAuthenticatedN3User: async () => {
    if (!session) throw new UnauthorizedError("Authentication required");
    return ctx(session);
  },
  requireAdministrator: async () => {
    if (!session) throw new UnauthorizedError("Authentication required");
    if (!session.isAdministrator) throw new ForbiddenError("Administrator access required");
    return ctx(session);
  },
  guardResponse: (err: unknown) => {
    if (err instanceof UnauthorizedError) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof ForbiddenError) return Response.json({ error: "Forbidden" }, { status: 403 });
    return null;
  },
}));

/* ---------------- tenant settings double ---------------- */

let settings: CancellationSettings = {
  requesterPolicy: "primary_pic_or_creator",
  approvalMode: "admin_approval_required",
};

vi.mock("./tenant-settings.server", () => ({
  loadTenantSettings: async () => ({ cancellation: settings }),
}));
vi.mock("@/lib/qne/service-jobs/tenant-settings.server", () => ({
  loadTenantSettings: async () => ({ cancellation: settings }),
}));

/* ---------------- persistence double ---------------- */

interface JobRow {
  id: string;
  tenant_code: string;
  status: string;
  is_deleted: boolean;
  created_by_user_id: string | null;
  assigned_user_id: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  cancelled_by_name_snapshot: string | null;
}

const jobs = new Map<string, JobRow>();
let requests: Record<string, unknown>[] = [];
let activity: Record<string, unknown>[] = [];
let seq = 0;

const store = {
  fetchJobForCancellation: async (tenant: string, jobId: string) => {
    const job = jobs.get(jobId);
    return job && job.tenant_code === tenant ? { ...job } : null;
  },
  fetchActiveRequest: async (tenant: string, jobId: string) =>
    requests.find(
      (r) => r.tenant_code === tenant && r.service_job_id === jobId && r.status === "pending",
    ) ?? null,
  listRequests: async (tenant: string, jobId: string) =>
    requests.filter((r) => r.tenant_code === tenant && r.service_job_id === jobId),
  insertPendingRequest: async (input: {
    tenantCode: string;
    jobId: string;
    reason: string;
    priorStatus: string;
    requesterPolicy: string;
    approvalMode: string;
    actor: { userId: string | null; name: string | null };
  }) => {
    // Reproduces the partial unique index (tenant, job) WHERE status='pending'.
    const dup = requests.some(
      (r) =>
        r.tenant_code === input.tenantCode &&
        r.service_job_id === input.jobId &&
        r.status === "pending",
    );
    if (dup) return { ok: false as const, duplicate: true as const };
    const row = {
      id: `req-${++seq}`,
      tenant_code: input.tenantCode,
      service_job_id: input.jobId,
      status: "pending",
      reason: input.reason,
      prior_status: input.priorStatus,
      requester_policy_at_request: input.requesterPolicy,
      approval_mode_at_request: input.approvalMode,
      requested_by_user_id: input.actor.userId,
      requested_by_name_snapshot: input.actor.name,
      requested_at: new Date().toISOString(),
      decision: null,
      decided_by_user_id: null,
      decided_by_name_snapshot: null,
      decided_at: null,
      decision_note: null,
    };
    requests.push(row);
    return { ok: true as const, row };
  },
  decidePendingRequest: async (input: {
    tenantCode: string;
    requestId: string;
    decision: "approved" | "rejected";
    note: string | null;
    actor: { userId: string | null; name: string | null };
  }) => {
    // Conditional UPDATE ... WHERE status='pending' — claims at most once.
    const row = requests.find(
      (r) =>
        r.id === input.requestId &&
        r.tenant_code === input.tenantCode &&
        r.status === "pending",
    );
    if (!row) return null;
    row.status = input.decision;
    row.decision = input.decision;
    row.decision_note = input.note;
    row.decided_by_user_id = input.actor.userId;
    row.decided_by_name_snapshot = input.actor.name;
    row.decided_at = new Date().toISOString();
    return { ...row };
  },
  finalizeJobCancellation: async (input: {
    tenantCode: string;
    jobId: string;
    reason: string;
    actor: { userId: string | null; name: string | null };
  }) => {
    const job = jobs.get(input.jobId);
    if (
      !job ||
      job.tenant_code !== input.tenantCode ||
      job.is_deleted ||
      job.status === "Cancelled" ||
      job.status === "Completed"
    ) {
      return { finalized: false, job: null };
    }
    job.status = "Cancelled";
    job.cancelled_at = new Date().toISOString();
    job.cancellation_reason = input.reason;
    job.cancelled_by_name_snapshot = input.actor.name;
    return { finalized: true, job: { ...job } };
  },
  appendCancellationActivity: async (input: Record<string, unknown>) => {
    activity.push(input);
  },
};

vi.mock("./cancellation.server", () => store);
vi.mock("@/lib/qne/service-jobs/cancellation.server", () => store);
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

/* ---------------- helpers ---------------- */

type Handler = (arg: {
  request: Request;
  params: Record<string, string>;
}) => Promise<Response>;

async function handlers(path: string): Promise<Record<string, Handler>> {
  const mod = (await import(path)) as {
    Route: { options: { server: { handlers: Record<string, Handler> } } };
  };
  return mod.Route.options.server.handlers;
}

const JOB_ID = "job-1";

function req(body?: unknown): Request {
  return new Request("https://app.test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer x" },
    body: JSON.stringify(body ?? {}),
  });
}

function seedJob(patch: Partial<JobRow> = {}) {
  jobs.set(JOB_ID, {
    id: JOB_ID,
    tenant_code: "T1",
    status: "In Progress",
    is_deleted: false,
    created_by_user_id: "u-creator",
    assigned_user_id: "u-pic",
    cancelled_at: null,
    cancellation_reason: null,
    cancelled_by_name_snapshot: null,
    ...patch,
  });
}

const ADMIN: FakeUser = {
  tenantCode: "T1",
  isAdministrator: true,
  userId: "u-admin",
  displayName: "Owner",
  email: "owner@t1.test",
};
const PIC: FakeUser = {
  tenantCode: "T1",
  isAdministrator: false,
  userId: "u-pic",
  displayName: "PIC",
  email: "pic@t1.test",
};
const HELPER: FakeUser = {
  tenantCode: "T1",
  isAdministrator: false,
  userId: "u-helper",
  displayName: "Helper",
  email: "helper@t1.test",
};

beforeEach(() => {
  jobs.clear();
  requests = [];
  activity = [];
  seq = 0;
  session = PIC;
  settings = { requesterPolicy: "primary_pic_or_creator", approvalMode: "admin_approval_required" };
  seedJob();
});

/* ---------------- tests ---------------- */

describe("R.5 cancellation route — authentication & tenant scope", () => {
  it("unauthenticated requests are rejected", async () => {
    session = null;
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    const res = await h.POST({ request: req({ reason: "x" }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(401);
  });

  it("a Job from another tenant is not found", async () => {
    session = { ...PIC, tenantCode: "T2" };
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    const res = await h.POST({ request: req({ reason: "x" }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(404);
    expect(jobs.get(JOB_ID)!.status).toBe("In Progress");
  });
});

describe("R.6 requester authorization over the API", () => {
  it("unrelated helper is denied under primary_pic_or_creator", async () => {
    session = HELPER;
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    const res = await h.POST({ request: req({ reason: "tidy up" }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(403);
    expect(requests).toHaveLength(0);
  });

  it("unrelated helper is allowed under any_support_user", async () => {
    session = HELPER;
    settings = { requesterPolicy: "any_support_user", approvalMode: "admin_approval_required" };
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    const res = await h.POST({ request: req({ reason: "duplicate job" }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(200);
    expect(requests).toHaveLength(1);
  });

  it("Primary PIC is denied under admin_only, Admin allowed", async () => {
    settings = { requesterPolicy: "admin_only", approvalMode: "admin_approval_required" };
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    const denied = await h.POST({ request: req({ reason: "no" }), params: { jobId: JOB_ID } });
    expect(denied.status).toBe(403);

    session = ADMIN;
    const ok = await h.POST({ request: req({ reason: "yes" }), params: { jobId: JOB_ID } });
    expect(ok.status).toBe(200);
  });

  it("a blank reason is rejected", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    const res = await h.POST({ request: req({ reason: "   " }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(400);
  });

  it("a deleted or terminal Job is rejected", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    seedJob({ is_deleted: true });
    expect((await h.POST({ request: req({ reason: "x" }), params: { jobId: JOB_ID } })).status).toBe(400);
    seedJob({ status: "Completed" });
    expect((await h.POST({ request: req({ reason: "x" }), params: { jobId: JOB_ID } })).status).toBe(400);
  });
});

describe("R.7 direct mode", () => {
  beforeEach(() => {
    settings = { requesterPolicy: "primary_pic_or_creator", approvalMode: "direct" };
  });

  it("an eligible requester cancels immediately with evidence and audit", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    const res = await h.POST({
      request: req({ reason: "customer withdrew" }),
      params: { jobId: JOB_ID },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cancelled: boolean; mode: string };
    expect(body).toMatchObject({ cancelled: true, mode: "direct" });

    const job = jobs.get(JOB_ID)!;
    expect(job.status).toBe("Cancelled");
    expect(job.cancellation_reason).toBe("customer withdrew");
    expect(job.cancelled_by_name_snapshot).toBe("PIC");
    expect(activity.filter((a) => a.eventType === "job_cancelled")).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });

  it("a retry does not create a second final effect", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    const first = await h.POST({ request: req({ reason: "dupe" }), params: { jobId: JOB_ID } });
    const retry = await h.POST({ request: req({ reason: "dupe" }), params: { jobId: JOB_ID } });
    expect(first.status).toBe(200);
    expect(retry.status).toBe(400); // Job is already terminal
    expect(activity.filter((a) => a.eventType === "job_cancelled")).toHaveLength(1);
  });
});

describe("R.8 approval mode lifecycle", () => {
  it("a request is durable and does not cancel the Job", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    const res = await h.POST({ request: req({ reason: "wrong customer" }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(200);
    expect((await res.json()).cancelled).toBe(false);
    expect(jobs.get(JOB_ID)!.status).toBe("In Progress");
    expect(requests[0]).toMatchObject({
      status: "pending",
      reason: "wrong customer",
      prior_status: "In Progress",
      requested_by_user_id: "u-pic",
      requested_by_name_snapshot: "PIC",
    });
    expect(activity.some((a) => a.eventType === "cancellation_requested")).toBe(true);
  });

  it("duplicate and racing requests are prevented", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    await h.POST({ request: req({ reason: "one" }), params: { jobId: JOB_ID } });
    const dup = await h.POST({ request: req({ reason: "two" }), params: { jobId: JOB_ID } });
    expect(dup.status).toBe(409);

    // Racing: both callers see no active request, both attempt the insert.
    requests = [];
    const [a, b] = await Promise.all([
      h.POST({ request: req({ reason: "race a" }), params: { jobId: JOB_ID } }),
      h.POST({ request: req({ reason: "race b" }), params: { jobId: JOB_ID } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(requests.filter((r) => r.status === "pending")).toHaveLength(1);
  });

  it("a Normal User cannot decide", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    await h.POST({ request: req({ reason: "please cancel" }), params: { jobId: JOB_ID } });
    const d = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation.decision");
    const res = await d.POST({ request: req({ decision: "approve" }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(403);
    expect(jobs.get(JOB_ID)!.status).toBe("In Progress");
  });

  it("Admin approve finalizes exactly once and keeps requester evidence", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    await h.POST({ request: req({ reason: "customer closed account" }), params: { jobId: JOB_ID } });

    session = ADMIN;
    const d = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation.decision");
    const res = await d.POST({
      request: req({ decision: "approve", note: "agreed" }),
      params: { jobId: JOB_ID },
    });
    expect(res.status).toBe(200);
    expect(jobs.get(JOB_ID)!.status).toBe("Cancelled");
    expect(jobs.get(JOB_ID)!.cancellation_reason).toBe("customer closed account");
    expect(requests[0]).toMatchObject({
      status: "approved",
      requested_by_name_snapshot: "PIC",
      decided_by_name_snapshot: "Owner",
      decision_note: "agreed",
    });
    expect(requests[0].decided_at).toBeTruthy();
    expect(activity.filter((a) => a.eventType === "job_cancelled")).toHaveLength(1);

    // Repeated approval cannot double-finalize.
    const again = await d.POST({ request: req({ decision: "approve" }), params: { jobId: JOB_ID } });
    expect(again.status).toBe(409);
    expect(activity.filter((a) => a.eventType === "job_cancelled")).toHaveLength(1);
  });

  it("concurrent approvals finalize once", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    await h.POST({ request: req({ reason: "stop work" }), params: { jobId: JOB_ID } });
    session = ADMIN;
    const d = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation.decision");
    const results = await Promise.all([
      d.POST({ request: req({ decision: "approve" }), params: { jobId: JOB_ID } }),
      d.POST({ request: req({ decision: "approve" }), params: { jobId: JOB_ID } }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(activity.filter((a) => a.eventType === "job_cancelled")).toHaveLength(1);
  });

  it("reject preserves the prior Job state and allows a later request", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    await h.POST({ request: req({ reason: "maybe" }), params: { jobId: JOB_ID } });

    session = ADMIN;
    const d = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation.decision");
    const res = await d.POST({
      request: req({ decision: "reject", note: "keep working" }),
      params: { jobId: JOB_ID },
    });
    expect(res.status).toBe(200);
    expect(jobs.get(JOB_ID)!.status).toBe("In Progress");
    expect(requests[0]).toMatchObject({
      status: "rejected",
      reason: "maybe",
      requested_by_name_snapshot: "PIC",
      decided_by_name_snapshot: "Owner",
      decision_note: "keep working",
    });
    expect(activity.some((a) => a.eventType === "cancellation_rejected")).toBe(true);

    // A later valid request is possible after rejection.
    session = PIC;
    const second = await h.POST({ request: req({ reason: "now really" }), params: { jobId: JOB_ID } });
    expect(second.status).toBe(200);
    expect(requests.filter((r) => r.status === "pending")).toHaveLength(1);
  });

  it("a decision with no active request is rejected", async () => {
    session = ADMIN;
    const d = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation.decision");
    const res = await d.POST({ request: req({ decision: "approve" }), params: { jobId: JOB_ID } });
    expect(res.status).toBe(409);
  });
});

describe("R.9 GET cancellation state", () => {
  it("reports policy, eligibility and pending request", async () => {
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    await h.POST({ request: req({ reason: "pending one" }), params: { jobId: JOB_ID } });
    const res = await h.GET({
      request: new Request("https://app.test/api"),
      params: { jobId: JOB_ID },
    });
    const body = (await res.json()) as {
      settings: CancellationSettings;
      canRequest: boolean;
      isAdmin: boolean;
      activeRequest: { reason: string } | null;
    };
    expect(body.settings.approvalMode).toBe("admin_approval_required");
    expect(body.canRequest).toBe(true);
    expect(body.isAdmin).toBe(false);
    expect(body.activeRequest?.reason).toBe("pending one");
  });

  it("an unrelated helper is reported ineligible", async () => {
    session = HELPER;
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.cancellation");
    const res = await h.GET({
      request: new Request("https://app.test/api"),
      params: { jobId: JOB_ID },
    });
    expect((await res.json()).canRequest).toBe(false);
  });
});
