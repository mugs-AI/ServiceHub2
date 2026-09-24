import { useEffect, useRef } from "react";

import { useTabs } from "@/lib/tabs";

/** Header height (h-14 + 1px border) — the strip sticks right below it. */
export const APP_HEADER_OFFSET_CLASS = "top-[57px]";

/**
 * WP3C-2 — second sticky strip: opened Job tabs only. Pinned sections live in
 * the header navigation. The strip scrolls horizontally and keeps the active
 * Job tab in view automatically.
 */
export function AppTabs() {
  const { tabs, activeKey, activate, close } = useTabs();
  const jobTabs = tabs.filter((t) => t.kind === "job");
  const refs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!activeKey) return;
    const el = refs.current.get(activeKey);
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [activeKey, jobTabs.length]);

  if (jobTabs.length === 0) return null;

  return (
    <div
      data-testid="job-tabs-strip"
      className={`sticky ${APP_HEADER_OFFSET_CLASS} z-30 border-b bg-card/95 backdrop-blur`}
    >
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
                className="min-h-9 px-3 py-1 font-medium"
                title={t.href}
              >
                <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground group-[.text-primary]:bg-primary/10 group-[.text-primary]:text-primary">
                  Job
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
                className="mr-1 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
