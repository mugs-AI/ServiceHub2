// Contract tests for the WP0E-R UI restoration.
//
// The project has no DOM testing dependency (package.json is frozen), so the
// UI wiring is verified structurally: the source of each screen must contain
// the exact mount points, API calls and ordering the run requires.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const calendarRoute = read("src/routes/calendar.tsx");
const rangeViews = read("src/components/qne/CalendarRangeViews.tsx");
const daySchedule = read("src/components/qne/DaySchedule.tsx");
const support = read("src/routes/support.tsx");
const entitlementPanel = read("src/components/qne/CustomerSubscriptionsPanel.tsx");
const adminDashboard = read("src/routes/admin.dashboard.tsx");
const settings = read("src/routes/settings.tsx");
const diagnostics = read("src/components/qne/RoleDiagnostics.tsx");

describe("Calendar — Day / Week / Month", () => {
  it("mounts all three view buttons", () => {
    expect(calendarRoute).toContain('["day", "week", "month"]');
    expect(calendarRoute).toContain('day: "Day"');
    expect(calendarRoute).toContain('week: "Week"');
    expect(calendarRoute).toContain('month: "Month"');
  });

  it("keeps My Schedule / Team Schedule independent of the view", () => {
    expect(calendarRoute).toContain('["me", "team"]');
    expect(calendarRoute).toContain("My Schedule");
    expect(calendarRoute).toContain("Team Schedule");
    expect(calendarRoute).toContain("setScope");
  });

  it("retains the Day view behaviour and its single-day feed", () => {
    expect(calendarRoute).toContain("useDaySchedule(date, scope)");
    expect(daySchedule).toContain("/api/workspace/calendar?date=");
  });

  it("reuses the same scheduling backend in range mode — no second backend", () => {
    expect(rangeViews).toContain("/api/workspace/calendar?from=");
    expect(rangeViews).toContain("&to=");
    expect(rangeViews).toContain("&scope=");
    const endpoints = [...rangeViews.matchAll(/\/api\/[a-z0-9/\-$.]+/gi)].map((m) => m[0]);
    expect(new Set(endpoints)).toEqual(new Set(["/api/workspace/calendar"]));
  });

  it("passes the scope through to the range feed", () => {
    expect(calendarRoute).toContain("useRangeSchedule(range.from, range.to, scope)");
  });

  it("preserves job number, subject, status, priority and Primary PIC", () => {
    for (const token of ["job_number", "subject", "StatusBadge", "PriorityBadge", "Primary PIC"]) {
      expect(rangeViews).toContain(token);
    }
  });

  it("renders truthful loading, error and empty states", () => {
    expect(rangeViews).toContain("No appointments scheduled for this week.");
    expect(rangeViews).toContain("No appointments scheduled for this month.");
    expect(rangeViews).toContain("Skeleton");
    expect(rangeViews).toContain("ErrorBlock");
  });

  it("keeps a single shared anchor date across views", () => {
    expect(calendarRoute).toContain("rangeForView(view, date)");
    expect(calendarRoute).toContain("shiftForView(view, d, -1)");
    expect(calendarRoute).toContain("shiftForView(view, d, 1)");
    expect(calendarRoute).toContain("setDate(myDayKey())");
  });
});

describe("Workspace — Subscriptions & Entitlements", () => {
  it("is mounted on the selected customer, after the summary and before Service jobs", () => {
    expect(support).toContain("<CustomerSubscriptionsPanel");
    const summaryAt = support.indexOf("<CustomerSummaryPanel");
    const entAt = support.indexOf("<CustomerSubscriptionsPanel");
    const jobsAt = support.indexOf('id="workspace-jobs"');
    expect(summaryAt).toBeGreaterThan(-1);
    expect(entAt).toBeGreaterThan(summaryAt);
    expect(jobsAt).toBeGreaterThan(entAt);
  });

  it("calls only the existing tenant-scoped entitlement endpoint with the customer code", () => {
    expect(entitlementPanel).toContain(
      "/api/workspace/customer-subscriptions?customerCode=${encodeURIComponent(customerCode)}",
    );
    const endpoints = [...entitlementPanel.matchAll(/\/api\/[a-z0-9/\-$.]+/gi)].map((m) => m[0]);
    expect(new Set(endpoints).size).toBe(1);
  });

  it("renders every field the read model returns", () => {
    for (const field of [
      "subscription_category",
      "stock_code",
      "stock_name",
      "subscription_status",
      "expiry_date",
      "remaining_days",
      "renewal_cycle_value",
      "renewal_cycle_unit",
      "latest_document_no",
      "latest_source_type",
      "latest_document_date",
    ]) {
      expect(entitlementPanel).toContain(field);
    }
  });

  it("has loading, populated, empty and error states with truthful empty wording", () => {
    expect(entitlementPanel).toContain('kind: "loading"');
    expect(entitlementPanel).toContain('kind: "error"');
    expect(entitlementPanel).toContain(
      "This customer has no Active, Due Soon or Overdue entitlement recorded.",
    );
    expect(entitlementPanel).not.toContain("Customer not found");
  });

  it("drops stale rows when the customer changes or is cleared", () => {
    // Remount on customer change + in-flight cancellation + idle on null.
    expect(support).toContain("key={customer.customer_code}");
    expect(entitlementPanel).toContain("let cancelled = false;");
    expect(entitlementPanel).toContain("if (cancelled) return;");
    expect(entitlementPanel).toContain('setState({ kind: "idle" })');
    expect(entitlementPanel).toContain("}, [customerCode]);");
  });

  it("supports the deep-linked customer and leaves Service Jobs intact", () => {
    expect(support).toContain("customer-resolve?customerCode=");
    expect(support).toContain("<JobList");
  });

  it("does not re-implement entitlement calculation", () => {
    expect(entitlementPanel).not.toContain("supabase");
    expect(entitlementPanel).not.toMatch(/remaining_days\s*=[^=]/);
  });
});

describe("Role Diagnostics relocation", () => {
  it("is gone from the Admin Dashboard", () => {
    expect(adminDashboard).not.toContain("RoleDiagnostics");
    expect(adminDashboard).not.toContain("Role diagnostics");
    expect(adminDashboard).not.toContain("adminGate");
  });

  it("keeps Operations, User workload, System health and quick links on the Dashboard", () => {
    for (const token of [
      'title="Operations"',
      'title="User workload"',
      'title="System health"',
      "<QuickLink",
      "<AdminOnly>",
    ]) {
      expect(adminDashboard).toContain(token);
    }
  });

  it("Settings exposes exactly three mapping tabs with Role Diagnostics third", () => {
    expect(settings).toContain('["renewal", "adhoc", "diagnostics"] as TabKey[]');
    expect(settings).toContain('type TabKey = "renewal" | "adhoc" | "diagnostics";');
    expect(settings).toContain('renewal: "Renewal Stock Mapping"');
    expect(settings).toContain('adhoc: "Ad Hoc Stock Mapping"');
    expect(settings).toContain('diagnostics: "Role Diagnostics"');
  });

  it("renders the diagnostics fields from the authenticated session only", () => {
    for (const field of [
      "Identity source",
      "Identity identifier",
      "Matched N3 user id",
      "Matched display name",
      "isOwner",
      "Role names",
      "isAdministrator",
      "Admin gate",
      "Reason",
      "/api/Users",
    ]) {
      expect(diagnostics).toContain(field);
    }
    expect(diagnostics).toContain("useSession()");
    expect(diagnostics).not.toContain("fetch(");
  });

  it("keeps Settings admin-only and preserves the other Settings panels", () => {
    expect(settings).toContain("<AdminOnly>");
    expect(settings).toContain("<CancellationSettingsCard");
    expect(settings).toContain("<SubscriptionCategoriesPanel");
    expect(settings).toContain("<MappingTab");
    expect(settings).toContain("<ConfiguredMappings");
  });
});
