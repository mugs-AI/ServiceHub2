// SH22-FIELD-OPERATIONS-UI-FREEZE-20260831-01
// Reversible UI freeze: the Service Job detail page must not import,
// mount, or display Field Operations controls.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROUTE_FILE = join(process.cwd(), "src", "routes", "jobs.\$jobId.tsx");
const source = readFileSync(ROUTE_FILE, "utf8");

describe("Field Operations UI freeze on /jobs/$jobId", () => {
  it("does not import FieldOperationsPanel", () => {
    expect(source).not.toMatch(/FieldOperationsPanel/);
  });

  it("does not contain a Field Operations heading or label", () => {
    expect(source).not.toMatch(/Field Operations/i);
  });

  it("does not mount the FieldOperationsPanel component", () => {
    expect(source).not.toMatch(/<FieldOperationsPanel/);
  });

  it("does not render field-ops action button labels", () => {
    // These labels previously appeared inside FieldOperationsPanel JSX.
    // Field property names such as arrived_on_site_at may remain in interfaces.
    const actionLabels = [
      "Start Travel",
      "Arrived On Site",
      "Start Work",
      "Pause Work",
      "Resume Work",
      "Stop Work",
      "Ready for Completion",
      "Waiting for Customer",
      "Waiting for Vendor",
      "Support Mode",
    ];
    for (const label of actionLabels) {
      expect(source).not.toContain(label);
    }
  });
});
