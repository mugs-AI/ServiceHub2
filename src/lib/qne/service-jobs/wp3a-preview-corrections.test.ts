// WP3A preview corrections — focused rules + source contracts.
//
// Covers: My Work card/list parity, the three new Pending Queue categories,
// the tenant/status scoping of the reopen-request queue, the Admin Dashboard
// pending-reopen card and deep link, exactly one Comments form on Job detail,
// and the coloured Request Reopen button.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ASSIGNED_TO_ME_STATUSES,
  MY_PENDING_STATUSES,
  TERMINAL_STATUSES,
  cardStatusScope,
} from "@/lib/qne/dashboard/my-work-scope";
import {
  QUEUE_COMPLETED,
  QUEUE_COMPLETED_FOLLOWUP,
  QUEUE_REOPEN_REQUESTS,
  currentCycle,
  followUpJobIds,
} from "@/lib/qne/service-jobs/wp3a-queues";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const dashboardUi = read("src/routes/dashboard.tsx");
const myWorkRoute = read("src/routes/api/dashboard/my-work.ts");
const pendingRoute = read("src/routes/api/workspace/jobs.pending.ts");
const pendingUi = read("src/routes/jobs.pending.tsx");
const reopenQueueRoute = read("src/routes/api/workspace/reopen-requests.ts");
const adminRoute = read("src/routes/api/admin/dashboard.ts");
const adminUi = read("src/routes/admin.dashboard.tsx");
const jobDetail = read("src/routes/jobs.$jobId.tsx");
const reopenSection = read("src/components/qne/JobReopenSection.tsx");

describe("My Work card/list parity", () => {
  it("opens the same scope the Assigned to Me card counted", () => {
    const scope = cardStatusScope("assignedToMe");
    expect(scope).toEqual([...ASSIGNED_TO_ME_STATUSES]);
    // The reported bug: an In Progress assigned Job counted 1 but listed 0.
    expect(scope).toContain("In Progress");
    expect(scope).toContain("Assigned");
    expect(scope).toContain("Waiting Customer");
    expect(scope).toContain("Waiting Vendor");
  });

  it("keeps My Pending Tasks aligned with its own count", () => {
    expect(cardStatusScope("myPendingTasks")).toEqual([...MY_PENDING_STATUSES]);
    expect(cardStatusScope("myPendingTasks")).not.toContain("Pending Approval");
  });

  it("never includes terminal statuses in a card scope", () => {
    for (const terminal of TERMINAL_STATUSES) {
      expect(cardStatusScope("assignedToMe")).not.toContain(terminal);
      expect(cardStatusScope("myPendingTasks")).not.toContain(terminal);
    }
  });

  it("returns a fresh copy so callers cannot mutate the shared scope", () => {
    const first = cardStatusScope("assignedToMe");
    first.push("Cancelled");
    expect(cardStatusScope("assignedToMe")).not.toContain("Cancelled");
  });

  it("dashboard cards use the shared scope and reset paging", () => {
    // WP3C: every card now sends its server-validated scope key, and the
    // server derives the status list from the same shared module.
    expect(dashboardUi).toContain("MY_WORK_CARDS");
    expect(dashboardUi).toContain('sp.set("scope", scope)');
    expect(dashboardUi).not.toContain('statuses: ["Assigned"] }');
    expect(dashboardUi).toMatch(/const applyCardScope[\s\S]*setPage\(1\)/);
    const myWork = readFileSync("src/routes/api/dashboard/my-work.ts", "utf8");
    expect(myWork).toContain("statusesForMyWorkScope");
  });

  it("server and UI import the same scope module", () => {
    expect(myWorkRoute).toContain("@/lib/qne/dashboard/my-work-scope");
    expect(dashboardUi).toContain("@/lib/qne/dashboard/my-work-scope");
    // Tenant and assignee stay server-derived.
    expect(myWorkRoute).toContain('.eq("tenant_code", user.tenantCode)');
    expect(myWorkRoute).toContain("user.diagnostics.matchedN3UserId");
  });
});

describe("Completed follow-up uses the current completion cycle only", () => {
  const jobs = [
    { id: "job-a", completion_cycle: 2 },
    { id: "job-b", completion_cycle: 1 },
    { id: "job-c", completion_cycle: null },
  ];

  it("ignores an earlier cycle's follow-up flag", () => {
    const ids = followUpJobIds(jobs, [
      { service_job_id: "job-a", completion_cycle: 1, follow_up_required: true },
      { service_job_id: "job-a", completion_cycle: 2, follow_up_required: false },
    ]);
    expect(ids.has("job-a")).toBe(false);
  });

  it("matches evidence on the job's current cycle", () => {
    const ids = followUpJobIds(jobs, [
      { service_job_id: "job-a", completion_cycle: 2, follow_up_required: true },
      { service_job_id: "job-b", completion_cycle: 1, follow_up_required: true },
    ]);
    expect([...ids].sort()).toEqual(["job-a", "job-b"]);
  });

  it("treats a missing cycle as cycle 1", () => {
    expect(currentCycle({ id: "x" })).toBe(1);
    expect(currentCycle({ id: "x", completion_cycle: 0 })).toBe(1);
    expect(currentCycle({ id: "x", completion_cycle: 3 })).toBe(3);
    const ids = followUpJobIds(jobs, [
      { service_job_id: "job-c", completion_cycle: 1, follow_up_required: true },
    ]);
    expect(ids.has("job-c")).toBe(true);
  });

  it("ignores evidence without a follow-up flag", () => {
    const ids = followUpJobIds(jobs, [
      { service_job_id: "job-b", completion_cycle: 1, follow_up_required: false },
      { service_job_id: "job-b", completion_cycle: 1, follow_up_required: null },
    ]);
    expect(ids.size).toBe(0);
  });
});

describe("Pending Queue categories", () => {
  it("uses stable URL keys", () => {
    expect(QUEUE_REOPEN_REQUESTS).toBe("reopen_requests");
    expect(QUEUE_COMPLETED_FOLLOWUP).toBe("completed_followup");
    expect(QUEUE_COMPLETED).toBe("completed");
  });

  it("both completed queues list only Completed, non-deleted tenant jobs", () => {
    expect(pendingRoute).toContain('"completed_followup"');
    expect(pendingRoute).toContain('queueType === "completed"');
    expect(pendingRoute).toContain('.eq("status", "Completed")');
    expect(pendingRoute).toContain('.eq("is_deleted", false)');
    expect(pendingRoute).toContain('.eq("tenant_code", user.tenantCode)');
  });

  it("follow-up filtering runs through the current-cycle rule", () => {
    expect(pendingRoute).toContain("followUpJobIds");
    expect(pendingRoute).toContain("completion_cycle");
  });

  it("renders the three new tabs and resets paging on tab change", () => {
    expect(pendingUi).toContain("QUEUE_REOPEN_REQUESTS");
    expect(pendingUi).toContain("QUEUE_COMPLETED_FOLLOWUP");
    expect(pendingUi).toContain("QUEUE_COMPLETED");
    expect(pendingUi).toContain('label: "Reopen Requests"');
    expect(pendingUi).toContain('label: "Completed Follow-up"');
    // Both the desktop tab bar and the mobile compact set select through the
    // one handler, which resets paging.
    expect(pendingUi).toMatch(/setQueueType\(key\);\s*\n\s*setPage\(1\)/);
    expect(pendingUi).toContain("selectQueue(t.key)");
  });

  it("keeps the existing queue tabs", () => {
    for (const key of [
      "pending_approval",
      "open_unassigned",
      "assigned_not_started",
      "waiting_customer",
      "waiting_vendor",
    ]) {
      expect(pendingUi).toContain(key);
    }
  });

  it("renders reopen rows without horizontal overflow", () => {
    expect(pendingUi).toContain('data-testid="reopen-queue"');
    expect(pendingUi).toContain("break-words");
    expect(pendingUi).not.toMatch(/overflow-x-scroll/);
  });
});

describe("Reopen Requests queue data rules", () => {
  it("is tenant-scoped, pending-only and excludes deleted jobs", () => {
    expect(reopenQueueRoute).toContain("requireAuthenticatedN3User");
    expect(reopenQueueRoute).toContain('.eq("tenant_code", user.tenantCode)');
    expect(reopenQueueRoute).toContain('.eq("status", "pending")');
    expect(reopenQueueRoute).toContain("is_deleted");
    // The browser may never supply a tenant.
    expect(reopenQueueRoute).not.toMatch(/sp\.get\("tenant/);
  });

  it("is read-only — decisions stay at the Owner/Admin Job endpoint", () => {
    expect(reopenQueueRoute).not.toMatch(/\.update\(|\.insert\(|\.delete\(/);
    expect(read("src/routes/api/workspace/jobs.$jobId.reopen.decision.ts")).toContain(
      "requireAdministrator",
    );
  });

  it("carries the context needed to act", () => {
    for (const field of [
      "job_number",
      "subject",
      "priority",
      "requested_by_name_snapshot",
      "requested_at",
      "reason",
    ]) {
      expect(reopenQueueRoute).toContain(field);
    }
    expect(pendingUi).toContain("formatMYDateTime(r.requested_at)");
  });
});

describe("Admin Dashboard reopen card", () => {
  it("counts only pending requests for the caller's tenant", () => {
    expect(adminRoute).toContain("service_job_reopen_requests");
    expect(adminRoute).toMatch(/service_job_reopen_requests[\s\S]{0,300}"pending"/);
    expect(adminRoute).toMatch(/service_job_reopen_requests[\s\S]{0,300}tenantCode/);
  });

  it("deep links to the Pending Queue reopen tab", () => {
    const cards = readFileSync("src/lib/qne/dashboard/admin-cards.ts", "utf8");
    expect(cards).toContain('queueType: "reopen_requests"');
    expect(cards).toContain('label: "Reopen Requests"');
    expect(cards).toContain('key: "reopenRequests"');
    expect(adminUi).toContain('to: "/jobs/pending"');
  });
});

describe("Job detail UI corrections", () => {
  it("mounts the Comments input exactly once", () => {
    const mounts = jobDetail.match(/<CommentsSection\b/g) ?? [];
    expect(mounts).toHaveLength(1);
    const definitions = jobDetail.match(/function CommentsSection\b/g) ?? [];
    expect(definitions).toHaveLength(1);
    // History, visibility choice and posting all stay.
    expect(jobDetail).toContain("comments");
  });

  it("shows a coloured, accessible Request Reopen button", () => {
    expect(reopenSection).toContain('data-testid="reopen-request-button"');
    const button = reopenSection.slice(
      reopenSection.indexOf('data-testid="reopen-request-button"'),
      reopenSection.indexOf("Request Reopen"),
    );
    expect(button).toContain("bg-amber-100");
    expect(button).toContain("border-amber-400");
    expect(button).toContain("text-amber-900");
    expect(button).toContain("hover:bg-amber-200");
    expect(button).toContain("focus-visible:ring-2");
    expect(button).toContain("min-h-[44px]");
    expect(button).toContain("w-full");
  });
});
