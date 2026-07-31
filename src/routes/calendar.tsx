import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { DaySchedule, useDaySchedule } from "@/components/qne/DaySchedule";
import { myDayKey, shiftDayKey } from "@/lib/qne/service-jobs/scheduling";
import { useSession } from "@/lib/qne/session-context";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Technician Day Calendar — ServiceHub" },
      {
        name: "description",
        content: "Day view of scheduled service appointments in Malaysia time.",
      },
      { property: "og:title", content: "Technician Day Calendar — ServiceHub" },
      {
        property: "og:description",
        content: "Day view of scheduled service appointments in Malaysia time.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CalendarPage,
});

function CalendarPage() {
  const session = useSession();
  const isAdmin = !!session.currentUser?.isAdministrator;
  const [date, setDate] = useState(myDayKey());
  const [scope, setScope] = useState<"me" | "team">("me");
  const { items, loading, error, reload } = useDaySchedule(date, scope);

  return (
    <div className="space-y-4">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Scheduling</p>
          <h1 className="mt-1 text-xl font-semibold text-foreground sm:text-2xl">Day Calendar</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Appointments shown in Malaysia time (Asia/Kuala_Lumpur).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="min-h-11 shrink-0 rounded-md border px-3 text-xs font-semibold hover:bg-accent"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <button
          type="button"
          onClick={() => setDate((d) => shiftDayKey(d, -1))}
          className="min-h-11 rounded-md border px-3 text-sm font-semibold hover:bg-accent"
        >
          ← Prev
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value || myDayKey())}
          className="min-h-11 rounded-md border bg-background px-3 text-sm text-foreground"
        />
        <button
          type="button"
          onClick={() => setDate((d) => shiftDayKey(d, 1))}
          className="min-h-11 rounded-md border px-3 text-sm font-semibold hover:bg-accent"
        >
          Next →
        </button>
        <button
          type="button"
          onClick={() => setDate(myDayKey())}
          className="min-h-11 rounded-md border px-3 text-sm font-semibold hover:bg-accent"
        >
          Today
        </button>

        {isAdmin && (
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
                {s === "me" ? "My schedule" : "All technicians"}
              </button>
            ))}
          </div>
        )}
      </div>

      <DaySchedule
        items={items}
        loading={loading}
        error={error}
        showTechnician={scope === "team"}
        emptyLabel="No appointments scheduled for this day."
      />
    </div>
  );
}
