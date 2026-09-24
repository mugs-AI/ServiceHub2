import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";

import { DaySchedule, useDaySchedule } from "@/components/qne/DaySchedule";
import { InfoPopover } from "@/components/qne/InfoPopover";
import { MalaysiaDatePopover } from "@/components/qne/MalaysiaDayPicker";
import { MonthSchedule, WeekSchedule, useRangeSchedule } from "@/components/qne/CalendarRangeViews";
import {
  type CalendarView,
  displayDay,
  monthLabel,
  rangeForView,
  shiftForView,
  weekLabel,
} from "@/lib/qne/service-jobs/calendar-range";
import { myDayKey } from "@/lib/qne/service-jobs/scheduling";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Service Calendar — ServiceHub" },
      {
        name: "description",
        content: "Day, week and month views of scheduled service appointments in Malaysia time.",
      },
      { property: "og:title", content: "Service Calendar — ServiceHub" },
      {
        property: "og:description",
        content: "Day, week and month views of scheduled service appointments in Malaysia time.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CalendarPage,
});

const DATE_KEY = "sh2:calendarDate:v1";
const VIEW_KEY = "sh2:calendarView:v1";

function initialDate(): string {
  if (typeof window === "undefined") return myDayKey();
  const saved = window.sessionStorage.getItem(DATE_KEY);
  return saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : myDayKey();
}

function initialView(): CalendarView {
  if (typeof window === "undefined") return "day";
  const saved = window.sessionStorage.getItem(VIEW_KEY);
  return saved === "week" || saved === "month" ? saved : "day";
}

const VIEW_LABEL: Record<CalendarView, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

function CalendarPage() {
  // A single anchor date is shared by all three views, so switching Day →
  // Week → Month always keeps the user on the same point in time.
  const [date, setDate] = useState(initialDate);
  const [view, setView] = useState<CalendarView>(initialView);
  const [scope, setScope] = useState<"me" | "team">("me");

  const range = rangeForView(view, date);

  const day = useDaySchedule(date, scope);
  const rangeFeed = useRangeSchedule(range.from, range.to, scope);
  const active = view === "day" ? day : rangeFeed;

  useEffect(() => {
    window.sessionStorage.setItem(DATE_KEY, date);
  }, [date]);
  useEffect(() => {
    window.sessionStorage.setItem(VIEW_KEY, view);
  }, [view]);

  const rangeLabel =
    view === "day" ? displayDay(date) : view === "week" ? weekLabel(date) : monthLabel(date);

  return (
    <div className="space-y-4">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Scheduling</p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground sm:text-2xl">Service Calendar</h1>
            <InfoPopover label="About calendar time zone" testId="calendar-tz-info" align="left">
              Appointments shown in Malaysia time (Asia/Kuala_Lumpur).
            </InfoPopover>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void active.reload()}
          className="min-h-11 shrink-0 rounded-md border px-3 text-xs font-semibold hover:bg-accent"
        >
          {active.loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <div className="space-y-3 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-md border p-1">
            {(["day", "week", "month"] as CalendarView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`min-h-9 rounded px-3 text-xs font-semibold ${
                  view === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>

          <div className="ml-auto flex gap-1 rounded-md border p-1">
            {(["me", "team"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`min-h-9 rounded px-3 text-xs font-semibold ${
                  scope === s
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {s === "me" ? "My Schedule" : "Team Schedule"}
              </button>
            ))}
          </div>
        </div>

        {/* WP3C-2 — Prev · period (date picker) · Next · Today on one row. */}
        <div data-testid="calendar-nav-row" className="flex flex-nowrap items-center gap-1.5">
          <button
            type="button"
            aria-label="Previous"
            onClick={() => setDate((d) => shiftForView(view, d, -1))}
            className="min-h-11 min-w-11 shrink-0 rounded-md border px-2 text-sm font-semibold hover:bg-accent"
          >
            ←
          </button>
          <MalaysiaDatePopover
            value={date}
            onSelect={(iso) => setDate(iso || myDayKey())}
            trigger={
              <button
                type="button"
                aria-label={`Choose date — ${rangeLabel}`}
                className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border px-2 text-sm font-semibold text-foreground hover:bg-accent"
              >
                <CalendarDays className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate">{rangeLabel}</span>
              </button>
            }
          />
          <button
            type="button"
            aria-label="Next"
            onClick={() => setDate((d) => shiftForView(view, d, 1))}
            className="min-h-11 min-w-11 shrink-0 rounded-md border px-2 text-sm font-semibold hover:bg-accent"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => setDate(myDayKey())}
            className="min-h-11 shrink-0 rounded-md border px-3 text-sm font-semibold hover:bg-accent"
          >
            Today
          </button>
        </div>
      </div>

      {view === "day" && (
        <DaySchedule
          items={day.items}
          loading={day.loading}
          error={day.error}
          showTechnician={scope === "team"}
          emptyLabel="No appointments scheduled for this day."
        />
      )}
      {view === "week" && (
        <WeekSchedule
          from={range.from}
          to={range.to}
          items={rangeFeed.items}
          loading={rangeFeed.loading}
          error={rangeFeed.error}
          showTechnician={scope === "team"}
        />
      )}
      {view === "month" && (
        <MonthSchedule
          anchor={date}
          onSelectDay={setDate}
          items={rangeFeed.items}
          loading={rangeFeed.loading}
          error={rangeFeed.error}
          showTechnician={scope === "team"}
        />
      )}
    </div>
  );
}
