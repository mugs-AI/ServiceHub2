import { useTabs } from "@/lib/tabs";

export function AppTabs() {
  const { tabs, activeKey, activate, close } = useTabs();
  if (tabs.length <= 2 && tabs.every((t) => !t.closable)) {
    // Only pinned; render bar anyway for consistency.
  }
  return (
    <div className="sticky top-[57px] z-30 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-2 py-1.5">
        {tabs.map((t) => {
          const active = t.key === activeKey;
          return (
            <div
              key={t.key}
              className={`group inline-flex shrink-0 items-center gap-1 rounded-md border text-xs transition-colors ${
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <button
                type="button"
                onClick={() => activate(t.key)}
                className="min-h-9 px-3 py-1 font-medium"
                title={t.href}
              >
                {t.kind === "job" && (
                  <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground group-[.text-primary]:bg-primary/10 group-[.text-primary]:text-primary">
                    Job
                  </span>
                )}
                {t.label}
              </button>
              {t.closable && (
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
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
