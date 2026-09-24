// WP3C — Dashboard card / list parity contracts.
//
// These are pure, dependency-free checks: a card count predicate and the
// destination list predicate must be the SAME shared definition, scope input
// from the browser must be validated, and the presentation contracts
// (mobile sizing, reduced motion, no dependency drift) must hold.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  MY_WORK_CARDS,
  ASSIGNED_TO_ME_STATUSES,
  MY_PENDING_STATUSES,
  isMyWorkScope,
  isLifecycleMyWorkScope,
  statusesForMyWorkScope,
} from "./my-work-scope";
import {
  ADMIN_ACTIVE_STATUSES,
  ADMIN_DASHBOARD_QUEUE_KEYS,
  isAdminDashboardQueueKey,
  statusesForAdminQueue,
} from "./admin-scope";
import {
  ADMIN_CARD_GROUPS,
  ALL_ADMIN_CARDS,
  ADMIN_ACTION_CENTRE,
  ADMIN_LIVE_OPERATIONS,
  ADMIN_COVERAGE,
  ADMIN_COMPLETION_INTEGRITY,
  ADMIN_COMPLETION_DATA_ALERT,
} from "./admin-cards";
import { countScopes, matchesWp3bCard, type ScopeRow } from "./followup-scope";

const read = (p: string) => readFileSync(p, "utf8");

const DAY = 24 * 60 * 60 * 1000;
const todayFromIso = new Date(Date.UTC(2026, 0, 10)).toISOString();
const todayToIso = new Date(Date.UTC(2026, 0, 10) + DAY).toISOString();
const inToday = new Date(Date.UTC(2026, 0, 10, 6)).toISOString();
const yesterday = new Date(Date.UTC(2026, 0, 9, 6)).toISOString();

describe("WP3C — User Dashboard cards", () => {
  it("renders exactly the nine required cards, in order", () => {
    expect(MY_WORK_CARDS.map((c) => c.label)).toEqual([
      "My Pending Tasks",
      "Assigned to Me",
      "My In Progress",
      "Waiting Approval",
      "Waiting Customer",
      "Waiting Vendor",
      "My Follow-ups",
      "My Reopen Pending",
      "Resolved by Me Today",
    ]);
  });

  it("never presents 'Completed by Me Today' as a success KPI", () => {
    const src = read("src/routes/dashboard.tsx");
    expect(MY_WORK_CARDS.some((c) => c.label.includes("Completed by Me"))).toBe(false);
    expect(src).not.toMatch(/label="Completed by Me Today"/);
  });

  it("gives every card a validated destination scope", () => {
    for (const card of MY_WORK_CARDS) {
      expect(isMyWorkScope(card.scope)).toBe(true);
    }
    expect(isMyWorkScope("../admin")).toBe(false);
    expect(isMyWorkScope("")).toBe(false);
    expect(isMyWorkScope(undefined)).toBe(false);
  });

  it("keeps Assigned to Me parity across every non-terminal status", () => {
    const statuses = statusesForMyWorkScope("assigned_to_me");
    expect(statuses).toEqual(ASSIGNED_TO_ME_STATUSES);
    for (const s of [
      "Draft",
      "Pending Approval",
      "Open",
      "Assigned",
      "In Progress",
      "Waiting Customer",
      "Waiting Vendor",
    ]) {
      expect(statuses).toContain(s);
    }
    // A count of 1 for an In Progress job can never open an empty list.
    expect(statuses).toContain("In Progress");
    expect(MY_PENDING_STATUSES).not.toContain("Pending Approval");
  });

  it("routes only the three WP3B scopes through the outcome read model", () => {
    const lifecycle = MY_WORK_CARDS.filter((c) => isLifecycleMyWorkScope(c.scope)).map(
      (c) => c.scope,
    );
    expect(lifecycle).toEqual(["my_followups", "my_reopen_pending", "resolved_by_me_today"]);
  });

  it("sends the card scope to the server instead of guessing client-side", () => {
    const src = read("src/routes/dashboard.tsx");
    expect(src).toContain('sp.set("scope", scope)');
    expect(src).toContain("MY_WORK_CARDS.map");
    expect(src).toContain("Clear scope");
    expect(src).toContain("Showing: All My Work");
  });

  it("keeps filters, mobile cards, desktop table, paging and MyDayPanel", () => {
    const src = read("src/routes/dashboard.tsx");
    expect(src).toContain("<MyDayPanel />");
    expect(src).toContain("Include Completed");
    expect(src).toContain("PRIORITY_OPTS");
    expect(src).toContain("md:hidden");
    expect(src).toContain("hidden overflow-hidden rounded-xl border bg-card shadow-sm md:block");
    expect(src).toContain("totalPages");
  });
});

describe("WP3C — My Work lifecycle membership", () => {
  const base: ScopeRow = {
    outcome: "resolved_at_completion",
    assigned_user_id: "tech-1",
    completed_at: inToday,
    followup_resolved_at: null,
    resolved_by_user_id: "tech-1",
  };
  const opts = { meUserId: "tech-1", todayFromIso, todayToIso };

  it("counts My Follow-ups and My Reopen Pending by assigned technician", () => {
    const followup: ScopeRow = { ...base, outcome: "follow_up_open" };
    expect(matchesWp3bCard(followup, "myFollowUps", opts)).toBe(true);
    expect(matchesWp3bCard({ ...followup, assigned_user_id: "other" }, "myFollowUps", opts)).toBe(
      false,
    );

    const reopen: ScopeRow = { ...base, outcome: "reopen_pending" };
    expect(matchesWp3bCard(reopen, "myReopenPending", opts)).toBe(true);
    expect(matchesWp3bCard(reopen, "myFollowUps", opts)).toBe(false);
  });

  it("credits Resolved by Me Today to the actual resolver after reassignment", () => {
    const reassigned: ScopeRow = { ...base, assigned_user_id: "someone-else" };
    expect(matchesWp3bCard(reassigned, "resolvedByMeToday", opts)).toBe(true);

    const resolvedByOther: ScopeRow = { ...base, resolved_by_user_id: "other" };
    expect(matchesWp3bCard(resolvedByOther, "resolvedByMeToday", opts)).toBe(false);
  });

  it("credits a follow-up clear to the clearing actor and to the clear day", () => {
    const cleared: ScopeRow = {
      outcome: "resolved_after_follow_up",
      assigned_user_id: "other",
      completed_at: yesterday,
      followup_resolved_at: inToday,
      resolved_by_user_id: "tech-1",
    };
    expect(matchesWp3bCard(cleared, "resolvedByMeToday", opts)).toBe(true);
    expect(
      matchesWp3bCard({ ...cleared, followup_resolved_at: yesterday }, "resolvedByMeToday", opts),
    ).toBe(false);
  });

  it("keeps the accounting formula for modern current cycles", () => {
    const rows: ScopeRow[] = [
      { ...base },
      { ...base, outcome: "follow_up_open" },
      { ...base, outcome: "reopen_pending" },
      { ...base, outcome: "legacy_unknown" },
    ];
    const c = countScopes(rows, opts);
    expect(c.completed).toBe(c.resolved + c.followUpOpen + c.reopenPending);
    expect(c.legacyUnknown).toBe(1);
    expect(c.resolved).toBe(1);
  });

  it("never reports a legacy completion as Resolved", () => {
    const legacy: ScopeRow = { ...base, outcome: "legacy_unknown" };
    expect(matchesWp3bCard(legacy, "resolvedToday", opts)).toBe(false);
    expect(matchesWp3bCard(legacy, "resolvedByMeToday", opts)).toBe(false);
  });
});

describe("WP3C — Admin Dashboard cards", () => {
  it("groups the required cards into the four required sections", () => {
    expect(ADMIN_CARD_GROUPS.map((g) => g.title)).toEqual([
      "Action Centre",
      "Live Operations",
      "Customer Coverage",
      "Completion Integrity",
    ]);
    expect(ADMIN_ACTION_CENTRE.map((c) => c.label)).toEqual([
      "Job Approvals",
      "Cancellation Requests",
      "Reopen Requests",
      "Follow-up Open",
    ]);
    expect(ADMIN_LIVE_OPERATIONS.map((c) => c.label)).toEqual([
      "Jobs Today",
      "Active Jobs",
      "In Progress",
      "Waiting Customer",
      "Waiting Vendor",
      "Resolved Today",
    ]);
    expect(ADMIN_COVERAGE.map((c) => c.label)).toEqual(["Due Soon Customers", "Overdue Customers"]);
    expect(ADMIN_COMPLETION_INTEGRITY.map((c) => c.label)).toEqual(["Completed Current Cycle"]);
  });

  it("keeps the audit alert out of the business groups but fully actionable", () => {
    // Renamed for clarity, moved to the System / Integration health area, and
    // still counting and opening the exact same server-authoritative scope.
    expect(ADMIN_COMPLETION_DATA_ALERT.label).toBe("Completion Data Alert");
    expect(ADMIN_COMPLETION_DATA_ALERT.key).toBe("legacyCompleted");
    expect(ADMIN_COMPLETION_DATA_ALERT.queueType).toBe("legacy_completed");
    for (const group of ADMIN_CARD_GROUPS) {
      expect(group.cards.some((c) => c.key === "legacyCompleted")).toBe(false);
    }
    expect(ALL_ADMIN_CARDS).toContain(ADMIN_COMPLETION_DATA_ALERT);

    const ui = read("src/routes/admin.dashboard.tsx");
    expect(ui).toContain("ADMIN_COMPLETION_DATA_ALERT");
    expect(ui).toContain("Integration health");
    // Never hidden when non-zero: rendered unconditionally with a click-through.
    expect(ui).toContain("openCard(ADMIN_COMPLETION_DATA_ALERT)");
  });

  it("gives every card exactly one destination", () => {
    for (const card of ALL_ADMIN_CARDS) {
      const hasQueue = typeof card.queueType === "string";
      const hasPage = typeof card.to === "string";
      expect(hasQueue !== hasPage).toBe(true);
    }
  });

  it("points every queue destination at a scope the server accepts", () => {
    const api = read("src/routes/api/workspace/jobs.pending.ts");
    const known = new Set([
      "draft",
      "pending_approval",
      "open_unassigned",
      "assigned_not_started",
      "waiting_customer",
      "waiting_vendor",
      "cancellation_requested",
      "cancellation_requests",
      "reopen_requests",
      "completed_followup",
      "completed",
      "follow_up_open",
      "reopen_pending",
      "resolved",
      ...ADMIN_DASHBOARD_QUEUE_KEYS,
    ]);
    for (const card of ALL_ADMIN_CARDS) {
      if (!card.queueType) continue;
      expect(known.has(card.queueType)).toBe(true);
    }
    // The server validates the incoming key and rejects anything else.
    expect(api).toContain("Invalid queue scope.");
    expect(api).toContain("ADMIN_DASHBOARD_QUEUE_KEYS");
  });

  it("offers a Pending Queue tab for every queue destination", () => {
    // WP3C-2: deep-link keys resolve through the consolidated taxonomy.
    const ui =
      read("src/routes/jobs.pending.tsx") + read("src/lib/qne/dashboard/pending-queue-groups.ts");
    // `reopen_requests` is referenced through the shared WP3A constant.
    const viaConstant = new Set<string>(["reopen_requests"]);
    for (const card of ALL_ADMIN_CARDS) {
      if (!card.queueType) continue;
      if (viaConstant.has(card.queueType)) {
        expect(ui).toContain("QUEUE_REOPEN_REQUESTS");
        continue;
      }
      expect(ui).toContain(`"${card.queueType}"`);
    }
    for (const label of [
      "Jobs Today",
      "Active Jobs",
      "In Progress",
      "Resolved Today",
      "Legacy/Data Alert",
    ]) {
      expect(ui).toContain(label);
    }
  });

  it("uses the same tenant-wide status predicate for Active and In Progress", () => {
    expect(statusesForAdminQueue("active")).toEqual(ADMIN_ACTIVE_STATUSES);
    expect(statusesForAdminQueue("in_progress")).toEqual(["In Progress"]);
    expect(statusesForAdminQueue("jobs_today")).toBeNull();
    expect(statusesForAdminQueue("legacy_completed")).toEqual(["Completed"]);
    expect(statusesForAdminQueue("resolved_today")).toEqual(["Completed"]);
    const api = read("src/routes/api/admin/dashboard.ts");
    expect(api).toContain("ADMIN_ACTIVE_STATUSES");
    expect(api).toContain('jobs().eq("status", "In Progress")');
  });

  it("validates admin queue keys and rejects anything else", () => {
    expect(isAdminDashboardQueueKey("resolved_today")).toBe(true);
    expect(isAdminDashboardQueueKey("legacy_completed")).toBe(true);
    expect(isAdminDashboardQueueKey("resolved_today; drop")).toBe(false);
    expect(isAdminDashboardQueueKey(42)).toBe(false);
  });

  it("derives outcome lists from the shared read model, never status alone", () => {
    const api = read("src/routes/api/workspace/jobs.pending.ts");
    expect(api).toContain("loadCompletionOutcomes");
    expect(api).toContain("matchesWp3bCard");
    expect(api).toContain('queueType === "legacy_completed"');
    expect(api).toContain('r.outcome !== "legacy_unknown"');
  });

  it("keeps tenant and role authority on the server", () => {
    const adminApi = read("src/routes/api/admin/dashboard.ts");
    const myWorkApi = read("src/routes/api/dashboard/my-work.ts");
    const queueApi = read("src/routes/api/workspace/jobs.pending.ts");
    expect(adminApi).toContain("requireAdministrator(request)");
    expect(myWorkApi).toContain("requireAuthenticatedN3User(request)");
    expect(queueApi).toContain("requireAuthenticatedN3User(request)");
    for (const src of [adminApi, myWorkApi, queueApi]) {
      expect(src).toContain("user.tenantCode");
      expect(src).not.toMatch(/sp\.get\("tenant/);
      expect(src).not.toMatch(/sp\.get\("userId"\)/);
    }
    expect(myWorkApi).toContain("Invalid My Work scope.");
  });

  it("keeps workload deep links and Integration Health, and drops stale copy", () => {
    const src = read("src/routes/admin.dashboard.tsx");
    expect(src).toContain("technicianName: w.name");
    expect(src).toContain("Integration health");
    expect(src).toContain("Snapshot Console");
    expect(src).not.toContain("arrive with Phase 1");
    expect(src).toContain("DashboardProgress");
  });
});

describe("WP3C — presentation contracts", () => {
  it("keeps dashboard primitives fluid with 44px touch targets", () => {
    const src = read("src/components/qne/dashboard/DashboardPrimitives.tsx");
    expect(src).toContain("min-h-11");
    expect(src).toContain("min-w-0");
    // No fixed desktop widths in the shared primitives.
    expect(src).not.toMatch(/\bw-\[\d/);
    expect(src).not.toMatch(/\bmin-w-\[\d/);
  });

  it("uses subtle CSS motion and honours prefers-reduced-motion", () => {
    const css = read("src/styles.css");
    expect(css).toContain("@keyframes dashboard-enter");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".dashboard-enter { animation: none; }");
    expect(css).toContain(".dashboard-card:hover { transform: none; }");
  });

  it("adds no dependency for the redesign", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies["lucide-react"]).toBeDefined();
    // The platform manages @lovable.dev/vite-tanstack-config; WP3C never
    // touches it, so only assert it is still a single pinned devDependency.
    expect(pkg.devDependencies["@lovable.dev/vite-tanstack-config"]).toMatch(/^\d+\.\d+\.\d+$/);
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const forbidden of ["framer-motion", "gsap", "three", "chart.js", "animejs"]) {
      expect(all[forbidden]).toBeUndefined();
    }
  });

  it("degrades safely while the WP3B candidate migration is unapplied", () => {
    const db = read("src/lib/qne/service-jobs/wp3b-db.server.ts");
    expect(db).toContain("service_job_followups");
    const server = read("src/lib/qne/service-jobs/wp3b.server.ts");
    // A missing candidate table must degrade to "no follow-up rows", never throw.
    expect(server).toContain("FOLLOWUPS_TABLE");
    expect(server).toMatch(/if \(error\)/);
  });
});
