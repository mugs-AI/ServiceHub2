// SH2.2-JOB-UI-01 — Service Job detail UI contract.
//
// Source-text contracts for the compact layout correction: Primary PIC label
// and info balloon, the default-closed Timeline drawer, and the Cancellation
// panel embedded next to Priority inside Job details.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROUTE = readFileSync(
  join(process.cwd(), "src", "routes", "jobs.$jobId.tsx"),
  "utf8",
);
const PANEL = readFileSync(
  join(process.cwd(), "src", "components", "qne", "CancellationPanel.tsx"),
  "utf8",
);

describe("Primary PIC card", () => {
  it("uses the compact 'Take as Primary' label", () => {
    expect(ROUTE).toContain('"Take as Primary"');
    expect(ROUTE).not.toContain("Take Over as Primary PIC\"\n          </button>");
    expect(ROUTE).not.toContain('{assigned ? "Take Over as Primary PIC"');
  });

  it("keeps the takeover modal wording and mandatory reason", () => {
    expect(ROUTE).toContain('<ModalShell title="Take Over as Primary PIC"');
    expect(ROUTE).toContain("Takeover reason *");
    expect(ROUTE).toContain("disabled={!takeoverReason.trim() || busy}");
  });

  it("moves the responsibility sentence into an accessible [i] balloon", () => {
    expect(ROUTE).toContain("function PrimaryPicInfo()");
    expect(ROUTE).toContain('aria-label="About Primary PIC"');
    expect(ROUTE).toContain(
      "Primary PIC keeps responsibility; teammates may help without taking over.",
    );
    // Not rendered as an always-visible paragraph any more.
    expect(ROUTE).not.toMatch(
      /<p className="mt-1 text-\[11px\] leading-snug text-muted-foreground">\s*Primary PIC keeps responsibility/,
    );
  });

  it("dismisses the balloon on Escape and outside click", () => {
    expect(ROUTE).toContain('if (e.key === "Escape") setOpen(false);');
    expect(ROUTE).toContain('data-testid="primary-pic-info-backdrop"');
  });
});

describe("Timeline drawer", () => {
  it("is a right-hand overlay drawer, not an inline card", () => {
    expect(ROUTE).toContain("function TimelineDrawer(");
    expect(ROUTE).not.toContain("function TimelineSection(");
    expect(ROUTE).not.toContain("<TimelineSection items={timeline} />");
  });

  it("defaults to closed on every load", () => {
    expect(ROUTE).toContain("const [showTimeline, setShowTimeline] = useState(false);");
  });

  it("exposes dialog semantics, a close button and backdrop dismissal", () => {
    expect(ROUTE).toContain('data-testid="timeline-drawer"');
    expect(ROUTE).toContain('aria-modal="true"');
    expect(ROUTE).toContain('aria-label="Job timeline"');
    expect(ROUTE).toContain('aria-label="Close timeline"');
    expect(ROUTE).toContain('data-testid="timeline-drawer-backdrop"');
    expect(ROUTE).toContain('document.body.style.overflow = "hidden";');
  });

  it("keeps the existing timeline fetch and entry rendering", () => {
    expect(ROUTE).toContain("/timeline`, { headers: authHeaders() }");
    expect(ROUTE).toContain("<TimelineBody item={it} />");
    expect(ROUTE).toContain("{formatEvent(it)}");
  });
});

describe("Cancellation embedded in Job details", () => {
  it("renders inside the Job details card in the Priority row", () => {
    const details = ROUTE.slice(
      ROUTE.indexOf('<Section title="Job details">'),
      ROUTE.indexOf("<InternalNoteSection"),
    );
    expect(details).toContain("<PriorityEditor");
    expect(details).toContain("<CancellationPanel");
    expect(details).toContain("embedded");
  });

  it("has no standalone Cancellation card left in page flow", () => {
    expect(ROUTE.match(/<CancellationPanel/g)?.length).toBe(1);
  });

  it("preserves the cancellation API endpoints and authorization surface", () => {
    expect(PANEL).toContain("/api/workspace/jobs/${jobId}/cancellation`");
    expect(PANEL).toContain("/api/workspace/jobs/${jobId}/cancellation/decision`");
    expect(PANEL).toContain("state.isAdmin &&");
    expect(PANEL).toContain("!state.canRequest");
    expect(PANEL).toContain("disabled={!reason.trim() || !!busy}");
  });
});

describe("compact top summary row", () => {
  it("no longer forces equal-height cards", () => {
    expect(ROUTE).toContain('className="grid grid-cols-1 items-start gap-3 md:grid-cols-3"');
    expect(ROUTE).not.toContain("flex h-full flex-col rounded-xl border bg-card");
  });
});

describe("frozen scope", () => {
  it("keeps FieldOperationsPanel unmounted", () => {
    expect(ROUTE).not.toContain("FieldOperationsPanel");
  });
});
