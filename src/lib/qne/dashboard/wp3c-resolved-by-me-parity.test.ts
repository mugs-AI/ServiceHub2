// WP3C narrow acceptance correction — "Resolved by Me Today" count/list parity.
//
// The card credits the ACTUAL resolver. The list it opens must therefore not be
// constrained by the CURRENT assignee, or a Job resolved by me and reassigned
// afterwards is counted but never shown.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  MY_WORK_SCOPES,
  isLifecycleMyWorkScope,
  myWorkScopeRequiresCurrentAssignee,
} from "./my-work-scope";
import { countScopes, matchesWp3bCard, type ScopeRow } from "./followup-scope";

const ME = "user-me";
const OTHER = "user-other";
const TODAY = { todayFromIso: "2026-01-10T16:00:00.000Z", todayToIso: "2026-01-11T16:00:00.000Z" };
const OPTS = { meUserId: ME, ...TODAY };

describe("myWorkScopeRequiresCurrentAssignee", () => {
  it("does not require current assignee for resolved_by_me_today", () => {
    expect(myWorkScopeRequiresCurrentAssignee("resolved_by_me_today")).toBe(false);
  });

  it("requires current assignee for my_followups and my_reopen_pending", () => {
    expect(myWorkScopeRequiresCurrentAssignee("my_followups")).toBe(true);
    expect(myWorkScopeRequiresCurrentAssignee("my_reopen_pending")).toBe(true);
  });

  it("requires current assignee for every status scope and for no scope", () => {
    for (const scope of MY_WORK_SCOPES) {
      if (isLifecycleMyWorkScope(scope)) continue;
      expect(myWorkScopeRequiresCurrentAssignee(scope)).toBe(true);
    }
    expect(myWorkScopeRequiresCurrentAssignee(null)).toBe(true);
  });
});

describe("resolved-by-me membership survives reassignment", () => {
  const reassignedAfterResolution: ScopeRow = {
    outcome: "resolved_at_completion",
    assigned_user_id: OTHER, // reassigned to somebody else after completion
    completed_at: "2026-01-11T02:00:00.000Z",
    followup_resolved_at: null,
    resolved_by_user_id: ME,
  };

  it("counts and keeps a Job resolved by me but now assigned to another user", () => {
    expect(matchesWp3bCard(reassignedAfterResolution, "resolvedByMeToday", OPTS)).toBe(true);
    expect(countScopes([reassignedAfterResolution], OPTS).resolvedByMeToday).toBe(1);
  });

  it("still excludes a Job resolved by somebody else even when assigned to me", () => {
    const row: ScopeRow = {
      outcome: "resolved_after_follow_up",
      assigned_user_id: ME,
      completed_at: "2026-01-11T01:00:00.000Z",
      followup_resolved_at: "2026-01-11T03:00:00.000Z",
      resolved_by_user_id: OTHER,
    };
    expect(matchesWp3bCard(row, "resolvedByMeToday", OPTS)).toBe(false);
    expect(countScopes([row], OPTS).resolvedByMeToday).toBe(0);
  });

  it("workload scopes stay tied to the current assignee", () => {
    const followUp: ScopeRow = {
      outcome: "follow_up_open",
      assigned_user_id: OTHER,
      completed_at: "2026-01-11T01:00:00.000Z",
      followup_resolved_at: null,
      resolved_by_user_id: null,
    };
    expect(matchesWp3bCard(followUp, "myFollowUps", OPTS)).toBe(false);
    expect(
      matchesWp3bCard({ ...followUp, assigned_user_id: ME }, "myFollowUps", OPTS),
    ).toBe(true);
  });
});

describe("/api/dashboard/my-work applies the shared predicate", () => {
  const src = readFileSync("src/routes/api/dashboard/my-work.ts", "utf8");

  it("gates the assignee filter on the shared helper, not an inline exception", () => {
    expect(src).toContain("myWorkScopeRequiresCurrentAssignee");
    expect(src).toContain(
      'if (myWorkScopeRequiresCurrentAssignee(scope)) {\n            query = query.eq("assigned_user_id", myUserId);',
    );
  });

  it("keeps tenant and soft-delete filters mandatory on the item read", () => {
    expect(src).toContain('.eq("tenant_code", user.tenantCode)');
    expect(src).toContain('.eq("is_deleted", false)');
  });

  it("never takes tenant or actor identity from the query string", () => {
    expect(src).toContain("user.diagnostics.matchedN3UserId");
    expect(src).not.toMatch(/sp\.get\("(tenant|tenantCode|userId|actor)"\)/);
  });
});
