// SH2.2 — source-contract checks (NOT executable UI rendering) for the
// Cancellation Decision Queue surfaces. These assert the shipped source of the
// Admin Dashboard and the Pending Queue keeps the required labels, links,
// Admin-only gating and refresh behaviour.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync("src/routes/admin.dashboard.tsx", "utf8");
const pending = readFileSync("src/routes/jobs.pending.tsx", "utf8");

// WP3C moved the card catalogue into a shared pure module; the Admin route
// renders it. Card labels, counted fields and destinations are asserted there.
const adminCards = readFileSync("src/lib/qne/dashboard/admin-cards.ts", "utf8");

describe("Admin Dashboard source contract", () => {
  it("shows Job Approvals and a separate Cancellation Requests card", () => {
    expect(adminCards).toContain('label: "Job Approvals"');
    expect(adminCards).toContain('label: "Cancellation Requests"');
    expect(adminCards).toContain('key: "cancellationRequests"');
    expect(dashboard).toContain("cancellationRequests: number");
  });

  it("links each card to its own queue and preserves the other KPIs", () => {
    expect(adminCards).toContain('queueType: "pending_approval"');
    expect(adminCards).toContain('queueType: "cancellation_requests"');
    for (const label of [
      "Jobs Today",
      "Waiting Customer",
      "Waiting Vendor",
      "Due Soon Customers",
      "Overdue Customers",
    ]) {
      expect(adminCards).toContain(`label: "${label}"`);
    }
  });

  it("keeps auto-refresh and manual Refresh", () => {
    expect(dashboard).toContain("AUTO_REFRESH_MS = 30_000");
    expect(dashboard).toMatch(/Refresh/);
  });
});

const groups = readFileSync("src/lib/qne/dashboard/pending-queue-groups.ts", "utf8");

describe("Pending Queue source contract", () => {
  it("shows one Cancellation Requested tab to every authenticated user", () => {
    // WP3C-2: Cancellation is an Approvals type visible to every user.
    expect(pending + groups).toContain('label: "Cancellation"');
    expect(pending).not.toContain("adminOnly: true");
    expect(pending).toContain("currentUser?.isAdministrator");
  });

  it("keeps the rich decision queue Admin-only and routes Normal Users to the safe Workspace filter", () => {
    expect(pending).toContain("if (isAdmin) {");
    expect(pending).toContain('CANCELLATION_WORKSPACE_QUEUE = "cancellation_requested"');
    expect(pending).toContain('js.set("queueType", CANCELLATION_WORKSPACE_QUEUE);');
  });

  it("highlights the whole card for a Job with an active cancellation request", () => {
    expect(pending).toContain("r.has_active_cancellation_request");
    expect(pending).toContain("border-l-red-500");
    expect(pending).toContain("bg-red-50");
  });

  it("renders request context and the awaiting-decision badge", () => {
    expect(pending).toContain("Awaiting Owner/Admin Decision");
    expect(pending).toContain("Prior status");
    expect(pending).toContain("r.requested_by_name");
    expect(pending).toContain("/api/admin/cancellation-requests");
  });

  it("opens Job Detail from a request row and offers no decision buttons", () => {
    expect(pending).toContain("openJob(r.service_job_id, r.job_number)");
    expect(pending).not.toMatch(/>\s*(Approve|Reject)\s*</);
  });

  it("flags All Pending rows without duplicating or mutating status", () => {
    expect(pending).toContain("has_active_cancellation_request");
    expect(pending).toContain("Cancellation Requested");
  });
});
