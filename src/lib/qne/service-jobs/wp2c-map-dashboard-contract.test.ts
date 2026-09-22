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
    // WP3A: the same validation gate, now able to render a disabled chip.
    expect(CARD).toContain("if (!hasMapAction(point)) {");
    expect(CARD).toContain("if (!placeholder) return null;");
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
    expect(CARD).toContain("inline-flex min-h-11 shrink-0 items-center justify-center");
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
  // WP3C replaced the hand-rolled header with the shared DashboardHero, which
  // owns the stacking rules. The intent is unchanged: nothing overflows a
  // 320px screen and the identity block wraps instead of clipping.
  it("stacks a full-width identity block above a full-width action grid", () => {
    const HERO = readFileSync("src/components/qne/dashboard/DashboardPrimitives.tsx", "utf8");
    expect(DASHBOARD).toContain("<DashboardHero");
    expect(DASHBOARD).toContain('className="min-w-0 space-y-6"');
    expect(HERO).toContain("grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_auto]");
    expect(HERO).toContain('className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end"');
  });

  it("keeps company and identity text readable on narrow screens", () => {
    const HERO = readFileSync("src/components/qne/dashboard/DashboardPrimitives.tsx", "utf8");
    expect(HERO).toContain("mt-2 break-words text-2xl");
    expect(HERO).toContain("sm:text-3xl");
    expect(DASHBOARD).toContain("flex flex-wrap items-center gap-x-3 gap-y-1");
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

  it("shows workload as stacked cards on mobile and a table only on desktop", () => {
    expect(DASHBOARD).toContain('className="space-y-2 md:hidden"');
    expect(DASHBOARD).toContain("hidden max-w-full overflow-hidden rounded-lg border bg-card shadow-sm md:block");
    expect(DASHBOARD).not.toContain("min-w-[36rem]");
  });
});
