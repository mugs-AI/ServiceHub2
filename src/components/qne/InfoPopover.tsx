// WP3A — small keyboard-accessible [i] info balloon.
//
// Mirrors the PrimaryPicInfo pattern already used on the Job detail page:
// a 44px-safe trigger, Escape to dismiss, outside-click backdrop and
// aria-expanded state. It carries explanation text only, never an action.

import { useEffect, useRef, useState, type ReactNode } from "react";

export function InfoPopover({
  label,
  testId,
  align = "right",
  children,
}: {
  /** Accessible name of the trigger, e.g. "About cancellation approval". */
  label: string;
  testId?: string;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid={testId}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold text-muted-foreground hover:bg-accent"
      >
        i
      </button>
      {open && (
        <>
          <div
            data-testid={testId ? `${testId}-backdrop` : undefined}
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div
            role="note"
            className={`absolute top-7 z-50 w-56 max-w-[85vw] rounded-lg border bg-popover p-2 text-[11px] leading-snug text-popover-foreground shadow-lg ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}
