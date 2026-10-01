import { useEffect, useRef } from "react";

import { useTabs } from "@/lib/tabs";

/**
 * WP3C-2 — second strip inside the shared sticky navigation: opened Job tabs only. Pinned sections live in
 * the header navigation. The strip scrolls horizontally and keeps the active
 * Job tab in view automatically.
 */
export function AppTabs() {
  const { tabs, activeKey, activate, close } = useTabs();
  const jobTabs = tabs.filter((t) => t.kind !== "pinned");
  const refs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!activeKey) return;
    const el = refs.current.get(activeKey);
    const strip = el?.parentElement;
    if (!el || !strip) return;
    const tabRect = el.getBoundingClientRect(),
      stripRect = strip.getBoundingClientRect();
    const delta =
      tabRect.left < stripRect.left
        ? tabRect.left - stripRect.left
        : tabRect.right > stripRect.right
          ? tabRect.right - stripRect.right
          : 0;
    if (delta) strip.scrollTo({ left: strip.scrollLeft + delta, behavior: "smooth" });
  }, [activeKey, jobTabs.length]);

  if (jobTabs.length === 0) return null;

  return (
    <div data-testid="job-tabs-strip" className="relative z-30 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-2 py-1.5">
        {jobTabs.map((t) => {
          const active = t.key === activeKey;
          return (
            <div
              key={t.key}
              ref={(el) => {
                if (el) refs.current.set(t.key, el);
                else refs.current.delete(t.key);
              }}
              className={`group inline-flex shrink-0 items-center gap-1 rounded-md border text-xs transition-colors ${
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <button
                type="button"
                onClick={() => activate(t.key)}
                aria-current={active ? "page" : undefined}
                aria-label={`${t.kind === "inquiry" ? "Inquiry" : "Job"} ${t.label}`}
                className="min-h-11 px-3 py-1 font-medium"
                title={t.href}
              >
                <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground group-[.text-primary]:bg-primary/10 group-[.text-primary]:text-primary">
                  {t.kind === "inquiry" ? "Inquiry" : "Job"}
                </span>
                {t.label}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  close(t.key);
                }}
                aria-label={`Close ${t.label}`}
                className="mr-1 grid min-h-11 min-w-11 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
