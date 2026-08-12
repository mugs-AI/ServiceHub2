// Shared Malaysia-time day schedule feed used by:
//   - the Technician Day Calendar (/calendar)
//   - the "My Day" panel on the Support Dashboard
//
// Reads /api/workspace/calendar, which returns UTC instants; all display is
// converted to Asia/Kuala_Lumpur.

import { useCallback, useEffect, useMemo, useState } from "react";

import { PriorityBadge, Skeleton, StatusBadge } from "@/components/qne/badges";
import { getStoredToken } from "@/lib/qne/tokens";
import {
  DAY_PART_LABEL,
  dayPartOf,
  formatDuration,
  myDayKey,
  utcIsoToMyLocal,
  type DayPart,
} from "@/lib/qne/service-jobs/scheduling";
import { useTabs } from "@/lib/tabs";

export interface Appointment {
  id: string;
  job_number: string;
  subject: string;
  status: string;
  priority: string;
  customer_code_snapshot: string | null;
  customer_name_snapshot: string | null;
  service_address: string | null;
  assigned_user_id: string | null;
  assigned_user_name_snapshot: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
}

function authHeaders(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function timeMY(iso: string | null | undefined): string {
  const local = utcIsoToMyLocal(iso);
  return local ? local.slice(11, 16) : "—";
}

const ORDER: DayPart[] = ["morning", "afternoon", "evening"];

export function useDaySchedule(date: string, scope: "me" | "team") {
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/calendar?date=${date}&scope=${scope}`, {
        headers: authHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setItems((body.appointments ?? []) as Appointment[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load schedule");
    } finally {
      setLoading(false);
    }
  }, [date, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, loading, error, reload: load };
}

export function DaySchedule({
  items,
  loading,
  error,
  emptyLabel = "No appointments scheduled for this day.",
  showTechnician = false,
}: {
  items: Appointment[];
  loading: boolean;
  error: string | null;
  emptyLabel?: string;
  showTechnician?: boolean;
}) {
  const { openJobTab } = useTabs();

  const buckets = useMemo(() => {
    const map: Record<DayPart, Appointment[]> = {
      morning: [],
      afternoon: [],
      evening: [],
      unscheduled: [],
    };
    for (const a of items) map[dayPartOf(a.scheduled_start_at)].push(a);
    return map;
  }, [items]);

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-background/60 p-6 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {ORDER.filter((p) => buckets[p].length > 0).map((part) => (
        <section key={part}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {DAY_PART_LABEL[part]} · {buckets[part].length}
          </h3>
          <ul className="space-y-2">
            {buckets[part].map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => openJobTab(a.id, a.job_number)}
                  className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:bg-accent"
                >
                  <div className="rounded-md bg-primary/10 px-2 py-1 text-center">
                    <div className="text-sm font-bold text-primary">
                      {timeMY(a.scheduled_start_at)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {formatDuration(a.scheduled_start_at, a.scheduled_end_at)}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">
                        {a.job_number}
                      </span>
                      <StatusBadge status={a.status} />
                      <PriorityBadge priority={a.priority} />
                    </div>
                    <div className="mt-1 break-words text-sm font-semibold text-foreground">
                      {a.subject}
                    </div>
                    <div className="mt-0.5 break-words text-xs text-muted-foreground">
                      {a.customer_name_snapshot ?? a.customer_code_snapshot ?? "—"}
                      {a.service_address ? ` · ${a.service_address}` : ""}
                    </div>
                    {showTechnician && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Technician: {a.assigned_user_name_snapshot ?? "Unassigned"}
                      </div>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function MyDayPanel() {
  const today = myDayKey();
  const { items, loading, error } = useDaySchedule(today, "me");
  return (
    <section className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          My Day · {today.split("-").reverse().join("/")}
        </h2>
        <a
          href="/calendar"
          className="min-h-9 rounded-md border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
        >
          Open Calendar
        </a>
      </div>
      <DaySchedule
        items={items}
        loading={loading}
        error={error}
        emptyLabel="Nothing scheduled for you today."
      />
    </section>
  );
}
