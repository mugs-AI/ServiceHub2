import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const CARD = read("src", "components", "qne", "OnSiteAttendanceCard.tsx");
const DASHBOARD = read("src", "routes", "admin.dashboard.tsx");

describe("attendance map action contract", () => {
  it("offers Map In for the open visit and both actions for returned visit rows", () => {
    const openVisit = CARD.indexOf("gpsResult: open.clock_in_gps_result");
    const visitIn = CARD.indexOf("gpsResult: v.clock_in_gps_result");
    const visitOut = CARD.indexOf("gpsResult: v.clock_out_gps_result");
    expect(openVisit).toBeGreaterThan(-1);
    expect(visitIn).toBeGreaterThan(openVisit);
    expect(visitOut).toBeGreaterThan(visitIn);
    expect(CARD.match(/label="Map In"/g)).toHaveLength(2);
    expect(CARD.match(/label="Map Out"/g)).toHaveLength(1);
    // Same chooser contract for every map action, including the open visit.
    expect(CARD.match(/onOpen=\{setChooser\}/g)).toHaveLength(3);
  });

  it("uses validated points and opens the ServiceHub chooser instead of one map app", () => {
    expect(CARD).toContain("if (!hasMapAction(point)) return null;");
    expect(CARD).toContain('aria-haspopup="dialog"');
    expect(CARD).toContain("aria-label={`${label} — choose a maps app`}");
    expect(CARD).toContain("mapChoicesForPoint(target.point, currentMapDevice())");
    expect(CARD).not.toMatch(/Latitude:|Longitude:|clock_in_latitude\}/);
  });

  it("keeps a single chooser instance with accessible close semantics", () => {
    expect(CARD).toContain("const [chooser, setChooser] = useState<ChooserTarget | null>(null);");
    expect(CARD.match(/<MapChooserDialog /g)).toHaveLength(1);
    expect(CARD).toContain(
      "<MapChooserDialog target={chooser} onClose={() => setChooser(null)} />",
    );
    // Radix Dialog supplies Escape, outside click and focus management.
    expect(CARD).toContain('from "@/components/ui/dialog"');
    expect(CARD).toContain("onOpenChange={(open) => {");
    expect(CARD).toContain(">\n            Cancel\n          </button>");
  });

  it("keeps external links safe and choices touch-friendly at 320px and 390px", () => {
    expect(CARD).toContain('target="_blank"');
    expect(CARD).toContain('rel="noopener noreferrer"');
    expect(CARD).toContain('className="mt-2 flex flex-wrap gap-2"');
    expect(CARD).toContain("inline-flex min-h-11 items-center justify-center");
    expect(CARD).toContain("inline-flex min-h-11 w-full items-center justify-center");
    expect(CARD).toContain("w-full max-w-full");
    expect(CARD).toContain("bottom-0 top-auto max-h-[85vh] w-full max-w-full translate-y-0");
  });

  it("falls back to copying the link when sharing is unavailable or cancelled", () => {
    expect(CARD).toContain('typeof navigator.share === "function"');
    expect(CARD).toContain("await navigator.clipboard.writeText(url)");
    expect(CARD).toContain("await copyLink(payload.url);");
  });
});

describe("administrator dashboard mobile header contract", () => {
  it("stacks a full-width identity block above a full-width two-column action grid", () => {
    expect(DASHBOARD).toContain(
      'className="flex w-full min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"',
    );
    expect(DASHBOARD).toContain('className="w-full min-w-0 sm:flex-1"');
    expect(DASHBOARD).toContain(
      'className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center"',
    );
  });

  it("keeps company and identity text readable on narrow screens", () => {
    expect(DASHBOARD).toContain("break-words text-2xl");
    expect(DASHBOARD).toContain("sm:truncate sm:text-3xl");
    expect(DASHBOARD).toContain("break-words text-sm text-muted-foreground");
  });

  it("keeps exactly the four existing actions and their destinations", () => {
    expect(DASHBOARD).toContain('label="Workspace"');
    expect(DASHBOARD).toContain('to="/support"');
    expect(DASHBOARD).toContain('label="Snapshot Console"');
    expect(DASHBOARD).toContain('to="/admin/snapshots"');
    expect(DASHBOARD).toContain('label="Settings"');
    expect(DASHBOARD).toContain('to="/settings"');
    expect(DASHBOARD).toContain('{opsLoading ? "Refreshing…" : "Refresh"}');
  });

  it("contains the workload table locally instead of widening the page", () => {
    expect(DASHBOARD).toContain("max-w-full overflow-x-auto");
    expect(DASHBOARD).toContain('className="min-w-[36rem] w-full text-left text-sm"');
  });
});
