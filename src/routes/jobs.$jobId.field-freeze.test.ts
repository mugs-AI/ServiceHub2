// SH22-FIELD-OPERATIONS-UI-FREEZE-20260831-01
// Reversible UI freeze: the Service Job detail page must not import,
// mount, or display Field Operations controls.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROUTE_FILE = join(process.cwd(), "src", "routes", "jobs.$jobId.tsx");
const source = readFileSync(ROUTE_FILE, "utf8");

describe("Field Operations UI freeze on /jobs/$jobId", () => {
  it("does not import FieldOperationsPanel", () => {
    expect(source).not.toMatch(/FieldOperationsPanel/);
  });

  it("does not contain a Field Operations heading or label", () => {
    expect(source).not.toMatch(/Field Operations/i);
  });

  it("does not mount any field-ops JSX", () => {
    expect(source).not.toMatch(/<FieldOperationsPanel/);
    expect(source).not.toMatch(/support_mode/i);
    expect(source).not.toMatch(/Start Travel|Arrived|Start Work|Ready for Completion/i);
  });
});
