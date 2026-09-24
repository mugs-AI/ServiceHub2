// WP3C-2 — lightweight in-app day picker (replaces the hidden zero-size
// native date input proxy, which iPhone Safari would not reliably open).
//
// Pure Malaysia calendar-day keys (yyyy-mm-dd) throughout — no Date/timezone
// conversion — rendered as a Monday-first month grid. Opening is driven by a
// real button inside a Radix Popover, so a direct tap always opens it.

import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  WEEKDAY_SHORT,
  isSameMonth,
  monthGridDays,
  monthLabel,
  shiftMonth,
} from "@/lib/qne/service-jobs/calendar-range";
import { formatMalaysiaDate, malaysiaTodayIso } from "@/lib/qne/malaysia-date";

export interface MalaysiaDayPickerProps {
  /** Selected ISO day, or "" when none. */
  value: string;
  /** Month the grid opens on when nothing is selected (ISO day in that month). */
  anchor?: string;
  onSelect: (iso: string) => void;
}

/** The inline month grid. Exported for tests and embedding. */
export function MalaysiaDayPicker({ value, anchor, onSelect }: MalaysiaDayPickerProps) {
  const today = malaysiaTodayIso();
  const [month, setMonth] = useState(() => value || anchor || today);
  useEffect(() => {
    if (value) setMonth(value);
  }, [value]);
  const grid = monthGridDays(month);

  return (
    <div className="w-[17rem] max-w-full select-none" data-testid="malaysia-day-picker">
      <div className="mb-2 flex items-center justify-between gap-1">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          className="grid h-11 w-11 place-items-center rounded-md hover:bg-accent"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="text-sm font-semibold text-foreground" aria-live="polite">
          {monthLabel(month)}
        </div>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          className="grid h-11 w-11 place-items-center rounded-md hover:bg-accent"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase text-muted-foreground">
        {WEEKDAY_SHORT.map((w) => (
          <div key={w} className="py-1">
            {w.slice(0, 2)}
          </div>
        ))}
      </div>
      <div role="grid" className="grid grid-cols-7 gap-0.5">
        {grid.map((d) => {
          const outside = !isSameMonth(d, month);
          const selected = d === value;
          const isToday = d === today;
          return (
            <button
              key={d}
              type="button"
              aria-label={formatMalaysiaDate(d)}
              aria-pressed={selected}
              onClick={() => onSelect(d)}
              className={`h-9 rounded-md text-xs font-medium transition-colors ${
                selected
                  ? "bg-primary text-primary-foreground"
                  : isToday
                    ? "border border-primary/50 text-primary hover:bg-accent"
                    : outside
                      ? "text-muted-foreground/60 hover:bg-accent"
                      : "text-foreground hover:bg-accent"
              }`}
            >
              {Number(d.slice(8, 10))}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => onSelect(today)}
          className="min-h-9 rounded-md border px-3 text-xs font-semibold hover:bg-accent"
        >
          Today
        </button>
      </div>
    </div>
  );
}

/** Popover wrapper: any trigger element opens the picker on direct tap. */
export function MalaysiaDatePopover({
  value,
  anchor,
  onSelect,
  trigger,
}: MalaysiaDayPickerProps & { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <MalaysiaDayPicker
          value={value}
          anchor={anchor}
          onSelect={(iso) => {
            onSelect(iso);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
