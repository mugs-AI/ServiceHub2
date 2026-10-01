import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function DashboardInfo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-dashboard-blue hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs font-semibold"
          >
            i
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={label}
        className="max-w-[calc(100vw-2rem)] space-y-2 text-sm"
      >
        <p className="font-semibold">{label}</p>
        {children}
      </PopoverContent>
    </Popover>
  );
}
