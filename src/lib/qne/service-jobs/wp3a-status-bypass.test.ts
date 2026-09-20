// WP3A — the generic /status route must not offer a waiting bypass.
//
// A waiting transition carries a mandatory reference number, stored atomically
// with the status change. Allowing In Progress -> Waiting * through the generic
// route would produce a waiting state with no reference and no evidence.
// Returning from a waiting state to In Progress is unaffected.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { allowedTransitionsClient } from "./workflow";
import { canTransition } from "./workflow.server";

const ROUTE = readFileSync(
  join(process.cwd(), "src", "routes", "api", "workspace", "jobs.$jobId.status.ts"),
  "utf8",
);

describe("generic status route", () => {
  it("rejects both waiting targets with a 400 pointing at the dedicated action", () => {
    expect(ROUTE).toContain('if (to === "Waiting Customer" || to === "Waiting Vendor") {');
    const guard = ROUTE.slice(
      ROUTE.indexOf('if (to === "Waiting Customer"'),
      ROUTE.indexOf("const { data: job, error: jobErr }"),
    );
    expect(guard).toContain("A waiting transition requires a reference number.");
    expect(guard).toContain("{ status: 400 }");
  });

  it("closes the waiting bypass on the server, not only in the UI", () => {
    // The guard runs before the Job is even loaded, so no status write can
    // happen on this path regardless of what the client sends.
    const guardAt = ROUTE.indexOf('if (to === "Waiting Customer"');
    const updateAt = ROUTE.indexOf('.from("service_jobs")\n            .update(');
    expect(guardAt).toBeGreaterThan(0);
    if (updateAt > 0) expect(guardAt).toBeLessThan(updateAt);
  });

  it("still keeps Completed and Cancelled out of the generic route", () => {
    expect(ROUTE).toContain("isGenericCompleteBlocked(to)");
    expect(ROUTE).toContain('if (to === "Cancelled") {');
  });

  it("leaves the return from a waiting state to In Progress working", () => {
    expect(ROUTE).not.toContain('if (to === "In Progress")');
    expect(canTransition("Waiting Customer", "In Progress")).toBe(true);
    expect(canTransition("Waiting Vendor", "In Progress")).toBe(true);
    expect(allowedTransitionsClient("Waiting Customer")).toContain("In Progress");
    expect(allowedTransitionsClient("Waiting Vendor")).toContain("In Progress");
  });

  it("keeps the waiting targets offered by the client so the prompt can open", () => {
    // The UI still lists them; clicking routes to the dedicated endpoint.
    expect(allowedTransitionsClient("In Progress")).toEqual(
      expect.arrayContaining(["Waiting Customer", "Waiting Vendor"]),
    );
    const page = readFileSync(join(process.cwd(), "src", "routes", "jobs.$jobId.tsx"), "utf8");
    expect(page).toContain("waitingPartyForStatus(to)");
    expect(page).toContain("/waiting`");
  });
});
