import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ALL_JOB_STATUSES,
  ALL_PENDING_STATUSES,
  APPROVAL_TYPES,
  COMPLETED_PAGE_SIZES,
  COMPLETED_SUBFILTERS,
  QUEUE_GROUPS,
  WAITING_SUBFILTERS,
  defaultCompletedRange,
  defaultScopeForGroup,
  malaysiaDayRangeToUtc,
  serverQueueTypeFor,
  usesDefaultCompletedRange,
  viewForQueueKey,
} from "./pending-queue-groups";
import { matchesWp3bCard } from "./followup-scope";
import {
  isSameMonth,
  monthGridDays,
  rangeForView,
} from "@/lib/qne/service-jobs/calendar-range";

const read = (p: string) => readFileSync(p, "utf8");

describe("WP3C-2 — consolidated queue definitions", () => {
  it("has exactly six primary groups in order", () => {
    expect(QUEUE_GROUPS.map((g) => g.label)).toEqual([
      "All Pending",
      "Waiting",
      "Approvals",
      "Completed",
      "Cancelled",
      "All Jobs",
    ]);
  });

  it("All Pending includes In Progress and every non-terminal status", () => {
    expect([...ALL_PENDING_STATUSES]).toEqual([
      "Draft",
      "Pending Approval",
      "Open",
      "Assigned",
      "In Progress",
      "Waiting Customer",
      "Waiting Vendor",
    ]);
    expect(ALL_PENDING_STATUSES).not.toContain("Completed");
    expect(ALL_PENDING_STATUSES).not.toContain("Cancelled");
    const api = read("src/routes/api/workspace/jobs.pending.ts");
    expect(api).toContain('query = query.in("status", [...ALL_PENDING_STATUSES]);');
  });

  it("All Jobs covers every lifecycle status; Cancelled is its own list", () => {
    expect(ALL_JOB_STATUSES).toContain("Completed");
    expect(ALL_JOB_STATUSES).toContain("Cancelled");
    expect(serverQueueTypeFor(viewForQueueKey("cancelled"))).toBe("cancelled");
    expect(serverQueueTypeFor(viewForQueueKey("all_jobs"))).toBe("all_jobs");
  });

  it("Waiting, Approvals and Completed expose the agreed sub-filters", () => {
    expect(WAITING_SUBFILTERS.map((f) => f.label)).toEqual(["All Waiting", "Customer", "Vendor"]);
    expect(APPROVAL_TYPES.map((f) => f.key)).toEqual([
      "",
      "pending_approval",
      "cancellation_requests",
      "reopen_requests",
    ]);
    expect(COMPLETED_SUBFILTERS.map((f) => f.label)).toEqual([
      "All",
      "Resolved",
      "Follow-up Open",
      "Reopen Pending",
      "Legacy/Data Alert",
    ]);
    expect(serverQueueTypeFor(viewForQueueKey("waiting"))).toBe("waiting");
    expect(defaultScopeForGroup("completed")).toBe("completed");
  });

  it("Reopen is reachable as Approvals > Reopen and a Completed outcome", () => {
    expect(viewForQueueKey("reopen_requests")).toEqual({
      group: "approvals",
      scope: "reopen_requests",
      chip: null,
    });
    expect(viewForQueueKey("reopen_pending").group).toBe("completed");
  });
});

describe("WP3C-2 — old dashboard deep-link mapping", () => {
  const cases: [string, string, string, string | null][] = [
    ["jobs_today", "pending", "jobs_today", "Jobs Today"],
    ["active", "pending", "active", "Active Jobs"],
    ["in_progress", "pending", "in_progress", "In Progress"],
    ["resolved_today", "completed", "resolved_today", "Resolved Today"],
    ["completed_current_cycle", "completed", "completed_current_cycle", "Current Cycle"],
    ["legacy_completed", "completed", "legacy_completed", null],
    ["pending_approval", "approvals", "pending_approval", null],
    ["cancellation_requests", "approvals", "cancellation_requests", null],
    ["waiting_customer", "waiting", "waiting_customer", null],
    ["follow_up_open", "completed", "follow_up_open", null],
  ];
  it.each(cases)("%s → %s/%s with chip %s", (key, group, scope, chip) => {
    const v = viewForQueueKey(key);
    expect(v).toEqual({ group, scope, chip });
    expect(serverQueueTypeFor(v) ?? scope).toBe(scope);
  });

  it("completed_followup no longer implies still-needs-follow-up", () => {
    expect(viewForQueueKey("completed_followup").scope).toBe("follow_up_open");
    const api = read("src/routes/api/workspace/jobs.pending.ts");
    expect(api).not.toContain("followUpJobIds");
  });

  it("the page shows an obvious active filter chip", () => {
    const ui = read("src/routes/jobs.pending.tsx");
    expect(ui).toContain('data-testid="active-filter-chip"');
    expect(ui).toContain("viewForQueueKey(qtInit)");
  });
});

describe("WP3C-2 — outcome membership", () => {
  const range = { todayFromIso: "2026-09-23T16:00:00.000Z", todayToIso: "2026-09-24T16:00:00.000Z" };
  const cleared = {
    outcome: "resolved_after_follow_up" as const,
    assigned_user_id: "u1",
    completed_at: "2026-09-01T02:00:00.000Z",
    followup_resolved_at: "2026-09-24T01:00:00.000Z",
    resolved_by_user_id: "u1",
  };
  it("a cleared follow-up is Resolved, never Follow-up Open", () => {
    expect(matchesWp3bCard(cleared, "followUpOpen")).toBe(false);
    expect(matchesWp3bCard(cleared, "resolvedToday", range)).toBe(true);
  });
  it("Resolved Today respects the Malaysia day boundary", () => {
    // 23:59 MYT on the 23rd is yesterday; 00:00 MYT on the 24th is today.
    expect(
      matchesWp3bCard({ ...cleared, followup_resolved_at: "2026-09-23T15:59:59.000Z" }, "resolvedToday", range),
    ).toBe(false);
    expect(
      matchesWp3bCard({ ...cleared, followup_resolved_at: "2026-09-23T16:00:00.000Z" }, "resolvedToday", range),
    ).toBe(true);
    expect(
      matchesWp3bCard({ ...cleared, followup_resolved_at: "2026-09-24T16:00:00.000Z" }, "resolvedToday", range),
    ).toBe(false);
  });
  it("legacy vs current cycle stays available as a filter and indicator", () => {
    const api = read("src/routes/api/workspace/jobs.pending.ts");
    expect(api).toContain('if (queueType === "legacy_completed") return r.outcome === "legacy_unknown";');
    expect(api).toContain('return r.outcome !== "legacy_unknown";');
    expect(api).toContain("outcome: outcomeById.get(r.id) ?? null");
    expect(read("src/routes/jobs.pending.tsx")).toContain("Legacy · Data Alert");
  });
});

describe("WP3C-2 — Completed pagination and date range", () => {
  it("defaults to the latest three Malaysia calendar months", () => {
    // 20:00 UTC 31 Dec = 1 Jan MYT.
    expect(defaultCompletedRange(new Date("2026-12-31T20:00:00Z"))).toEqual({
      from: "2026-11-01",
      to: "2027-01-01",
    });
    expect(defaultCompletedRange(new Date("2026-09-24T03:00:00Z"))).toEqual({
      from: "2026-07-01",
      to: "2026-09-24",
    });
  });
  it("only direct entry uses the default window (deep links keep count parity)", () => {
    expect(usesDefaultCompletedRange(undefined)).toBe(true);
    expect(usesDefaultCompletedRange("completed")).toBe(true);
    expect(usesDefaultCompletedRange("legacy_completed")).toBe(false);
    expect(usesDefaultCompletedRange("resolved_today")).toBe(false);
  });
  it("converts Malaysia days to a half-open UTC range", () => {
    expect(malaysiaDayRangeToUtc("2026-07-01", "2026-09-24")).toEqual({
      fromIso: "2026-06-30T16:00:00.000Z",
      toIso: "2026-09-24T16:00:00.000Z",
    });
    expect(malaysiaDayRangeToUtc(null, null)).toEqual({ fromIso: null, toIso: null });
  });
  it("offers 20/50/100 page sizes and sends server-side range params", () => {
    expect([...COMPLETED_PAGE_SIZES]).toEqual([20, 50, 100]);
    const ui = read("src/routes/jobs.pending.tsx");
    expect(ui).toContain('sp.set("completedFrom", completedRange.from)');
    expect(ui).toContain('sp.set("completedTo", completedRange.to)');
    const api = read("src/routes/api/workspace/jobs.pending.ts");
    expect(api).toContain("Invalid completed date range.");
    expect(api).toContain(".range((page - 1) * pageSize, page * pageSize - 1)");
  });
});

describe("WP3C-2 — calendar", () => {
  it("month grid is a full Monday-first seven-column month", () => {
    const grid = monthGridDays("2026-07-15");
    expect(grid.length % 7).toBe(0);
    expect(grid[0]).toBe("2026-06-29"); // Monday
    expect(grid.filter((d) => isSameMonth(d, "2026-07-15"))).toHaveLength(31);
    expect(rangeForView("month", "2026-07-15")).toEqual({ from: grid[0], to: grid.at(-1) });
  });
  it("mobile renders the grid (no hidden-on-mobile month) with day selection + agenda", () => {
    const src = read("src/components/qne/CalendarRangeViews.tsx");
    expect(src).toContain('data-testid="month-grid"');
    expect(src).not.toContain("hidden overflow-hidden rounded-xl border bg-card shadow-sm md:block");
    expect(src).toContain("onSelectDay?.(d)");
    expect(src).toContain('data-testid="day-count"');
    expect(src).toContain('data-testid="month-day-agenda"');
    expect(read("src/routes/calendar.tsx")).toContain("onSelectDay={setDate}");
  });
  it("date popover replaces the hidden native proxy", () => {
    const input = read("src/components/qne/MalaysiaDateInput.tsx");
    expect(input).not.toContain('type="date"');
    expect(input).not.toContain("showPicker");
    expect(input).toContain("MalaysiaDatePopover");
    const picker = read("src/components/qne/MalaysiaDayPicker.tsx");
    expect(picker).toContain("PopoverTrigger asChild");
    expect(picker).toContain("formatMalaysiaDate(d)");
  });
  it("Prev / period / Next / Today share one row; timezone lives in [i]", () => {
    const src = read("src/routes/calendar.tsx");
    expect(src).toContain('data-testid="calendar-nav-row" className="flex flex-nowrap');
    expect(src).toContain("<InfoPopover");
    expect(src).toContain("Appointments shown in Malaysia time (Asia/Kuala_Lumpur).");
    expect(src).not.toContain('<p className="mt-1 text-sm text-muted-foreground">\n            Appointments');
  });
});

describe("WP3C-2 — navigation separation", () => {
  const gate = read("src/components/qne/AuthGate.tsx");
  const tabs = read("src/components/qne/AppTabs.tsx");
  it("header carries Dashboard | Workspace | Pending | Calendar on every width", () => {
    expect(gate).toContain('export const PRIMARY_NAV_LABELS = ["Dashboard", "Workspace", "Pending", "Calendar"]');
    expect(gate).toContain('data-testid="primary-nav"');
    expect(gate).not.toContain('"Pending Queue"');
    expect(gate).toContain("Tools");
    expect(gate).toContain("<MobileProfile");
  });
  it("the second strip shows Job tabs only and auto-scrolls the active one", () => {
    expect(tabs).toContain('tabs.filter((t) => t.kind === "job")');
    expect(tabs).toContain("scrollIntoView");
    expect(tabs).toContain("overflow-x-auto");
    expect(tabs).toContain('APP_HEADER_OFFSET_CLASS = "top-[57px]"');
    expect(gate).toContain("h-14");
  });
});
