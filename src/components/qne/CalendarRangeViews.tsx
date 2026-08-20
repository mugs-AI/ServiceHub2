// Week and Month calendar presentations.
//
// Both reuse the SAME scheduling backend as the Day view
// (`/api/workspace/calendar` in range mode: ?from=&to=&scope=). There is no
// second scheduling authority: grouping is a pure client-side projection of
// the rows the API returns, keyed by Malaysia calendar day.

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Appointment } from "@/components/qne/DaySchedule";
import { PriorityBadge, Skeleton, StatusBadge } from "@/components/qne/badges";
import { getStoredToken } from "@/lib/qne/tokens";
import {
  WEEKDAY_SHORT,
  dayHeading,
  enumerateDays,
  isSameMonth,
  monthGridDays,
} from "@/lib/qne/service-jobs/calendar-range";
import { utcIsoToMyLocal } from "@/lib/qne/service-jobs/scheduling";
import { useTabs } from "@/lib/tabs";

function authHeaders(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Malaysia calendar day key an appointment belongs to. */
export function appointmentDayKey(a: Appointment): string {
  return utcIsoToMyLocal(a.scheduled_start_at).slice(0, 10);
}

export function groupByDay(items: Appointment[]): Map<string, Appointment[]> {
  const map = new Map<string, Appointment[]>();
  for (const a of items) {
    const key = appointmentDayKey(a);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(a);
    else map.set(key, [a]);
  }
  return map;
}

function timeMY(iso: string | null | undefined): string {
  const local = utcIsoToMyLocal(iso);
  return local ? local.slice(11, 16) : "—";
}

/** Range feed for Week / Month views. Same endpoint as the Day view. */
export function useRangeSchedule(from: string, to: string, scope: "me" | "team") {
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/calendar?from=${from}&to=${to}&scope=${scope}`, {
        headers: authHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setItems((body.appointments ?? []) as Appointment[]);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : "Failed to load schedule");
    } finally {
      setLoading(false);
    }
  }, [from, to, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, loading, error, reload: load };
}

function AppointmentRow({ a, showTechnician }: { a: Appointment; showTechnician: boolean }) {
  const { openJobTab } = useTabs();
  return (
    <button
      type="button"
      onClick={() => openJobTab(a.id, a.job_number)}
      className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-lg border bg-card p-2.5 text-left shadow-sm transition-colors hover:bg-accent"
    >
      <div className="rounded-md bg-primary/10 px-2 py-1 text-center text-sm font-bold text-primary">
        {timeMY(a.scheduled_start_at)}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">{a.job_number}</span>
          <StatusBadge status={a.status} />
          <PriorityBadge priority={a.priority} />
        </div>
        <div className="mt-1 break-words text-sm font-semibold text-foreground">{a.subject}</div>
        <div className="mt-0.5 break-words text-xs text-muted-foreground">
          {a.customer_name_snapshot ?? a.customer_code_snapshot ?? "—"}
        </div>
        {showTechnician && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            Primary PIC: {a.assigned_user_name_snapshot ?? "Unassigned"}
          </div>
        )}
      </div>
    </button>
  );
}

function LoadingBlock() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function ErrorBlock({ error }: { error: string }) {
  return (
    <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
  );
}

/* -------------------------------- Week -------------------------------- */

export function WeekSchedule({
  from,
  to,
  items,
  loading,
  error,
  showTechnician = false,
}: {
  from: string;
  to: string;
  items: Appointment[];
  loading: boolean;
  error: string | null;
  showTechnician?: boolean;
}) {
  const grouped = useMemo(() => groupByDay(items), [items]);
  const days = useMemo(() => enumerateDays(from, to), [from, to]);

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} />;

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-background/60 p-6 text-center text-sm text-muted-foreground">
        No appointments scheduled for this week.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {days.map((d) => {
        const list = grouped.get(d) ?? [];
        return (
          <section key={d} className="rounded-lg border bg-background/40 p-3">
            <h3 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>{dayHeading(d)}</span>
              <span>{list.length === 0 ? "—" : `${list.length}`}</span>
            </h3>
            {list.length === 0 ? (
              <p className="text-xs text-muted-foreground">No appointments scheduled.</p>
            ) : (
              <ul className="space-y-2">
                {list.map((a) => (
                  <li key={a.id}>
                    <AppointmentRow a={a} showTechnician={showTechnician} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* -------------------------------- Month ------------------------------- */

export function MonthSchedule({
  anchor,
  items,
  loading,
  error,
  showTechnician = false,
}: {
  anchor: string;
  items: Appointment[];
  loading: boolean;
  error: string | null;
  showTechnician?: boolean;
}) {
  const grouped = useMemo(() => groupByDay(items), [items]);
  const grid = useMemo(() => monthGridDays(anchor), [anchor]);
  const { openJobTab } = useTabs();

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} />;

  const inMonthCount = grid
    .filter((d) => isSameMonth(d, anchor))
    .reduce((n, d) => n + (grouped.get(d)?.length ?? 0), 0);

  return (
    <div className="space-y-3">
      {/* Desktop: Monday-first month grid */}
      <div className="hidden overflow-hidden rounded-xl border bg-card shadow-sm md:block">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {WEEKDAY_SHORT.map((w) => (
            <div key={w} className="px-2 py-1.5 text-center">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {grid.map((d) => {
            const list = grouped.get(d) ?? [];
            const outside = !isSameMonth(d, anchor);
            return (
              <div
                key={d}
                className={`min-h-24 border-b border-r p-1.5 align-top ${
                  outside ? "bg-muted/30 text-muted-foreground/70" : "bg-card"
                }`}
              >
                <div className="mb-1 text-[11px] font-semibold">{Number(d.slice(8, 10))}</div>
                <ul className="space-y-1">
                  {list.slice(0, 3).map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => openJobTab(a.id, a.job_number)}
                        title={`${a.job_number} · ${a.subject}`}
                        className="block w-full truncate rounded bg-primary/10 px-1.5 py-0.5 text-left text-[11px] font-medium text-primary hover:bg-primary/20"
                      >
                        {timeMY(a.scheduled_start_at)} {a.job_number}
                      </button>
                    </li>
                  ))}
                  {list.length > 3 && (
                    <li className="px-1.5 text-[10px] text-muted-foreground">
                      +{list.length - 3} more
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: agenda by day — same data, compact presentation */}
      <div className="space-y-3 md:hidden">
        {grid
          .filter((d) => isSameMonth(d, anchor) && (grouped.get(d)?.length ?? 0) > 0)
          .map((d) => (
            <section key={d} className="rounded-lg border bg-background/40 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {dayHeading(d)} · {grouped.get(d)!.length}
              </h3>
              <ul className="space-y-2">
                {grouped.get(d)!.map((a) => (
                  <li key={a.id}>
                    <AppointmentRow a={a} showTechnician={showTechnician} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        {inMonthCount === 0 && (
          <div className="rounded-lg border border-dashed bg-background/60 p-6 text-center text-sm text-muted-foreground">
            No appointments scheduled for this month.
          </div>
        )}
      </div>

      {inMonthCount === 0 && (
        <p className="hidden rounded-lg border border-dashed bg-background/60 p-4 text-center text-sm text-muted-foreground md:block">
          No appointments scheduled for this month.
        </p>
      )}
    </div>
  );
}
