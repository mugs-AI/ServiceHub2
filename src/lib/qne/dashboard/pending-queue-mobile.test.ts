import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  MOBILE_PRIMARY_QUEUE_KEYS,
  isPrimaryMobileQueue,
  primaryMobileQueues,
  secondaryMobileQueues,
} from "./pending-queue-mobile";

const read = (p: string) => readFileSync(p, "utf8");

const tabs = [
  { key: "" },
  { key: "draft" },
  { key: "pending_approval" },
  { key: "open_unassigned" },
  { key: "assigned_not_started" },
  { key: "in_progress" },
  { key: "waiting_customer" },
  { key: "waiting_vendor" },
  { key: "cancellation_requests" },
  { key: "reopen_requests" },
  { key: "completed" },
  { key: "legacy_completed" },
];

describe("WP3C UAT — mobile Pending Queue simplification", () => {
  it("shows the agreed compact primary set, in order", () => {
    expect(MOBILE_PRIMARY_QUEUE_KEYS).toEqual([
      "",
      "assigned_not_started",
      "in_progress",
      "waiting_customer",
      "waiting_vendor",
      "reopen_requests",
    ]);
    expect(primaryMobileQueues(tabs).map((t) => t.key)).toEqual([...MOBILE_PRIMARY_QUEUE_KEYS]);
  });

  it("keeps every other scope reachable through More Filters", () => {
    const primary = primaryMobileQueues(tabs).map((t) => t.key);
    const secondary = secondaryMobileQueues(tabs).map((t) => t.key);
    expect(new Set([...primary, ...secondary])).toEqual(new Set(tabs.map((t) => t.key)));
    expect(primary.filter((k) => secondary.includes(k))).toEqual([]);
  });

  it("never invents or renames a scope key", () => {
    for (const key of MOBILE_PRIMARY_QUEUE_KEYS) {
      if (key === "") continue;
      expect(tabs.some((t) => t.key === key)).toBe(true);
      expect(isPrimaryMobileQueue(key)).toBe(true);
    }
    expect(isPrimaryMobileQueue("legacy_completed")).toBe(false);
  });

  it("wires the UI to the shared split and surfaces an active hidden scope", () => {
    const ui = read("src/routes/jobs.pending.tsx");
    expect(ui).toContain("primaryMobileQueues");
    expect(ui).toContain("secondaryMobileQueues");
    expect(ui).toContain("More Filters");
    expect(ui).toContain("activeSecondaryTab");
    // Both layouts select through the one handler, so the fetched list always
    // matches the selected scope.
    expect(ui).toContain("const selectQueue = (key: string)");
    // 44px touch targets on the mobile controls.
    expect(ui).toContain("min-h-11");
  });
});
