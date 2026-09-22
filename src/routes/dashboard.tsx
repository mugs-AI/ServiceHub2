import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Flag,
  LayoutList,
  ListTodo,
  PlayCircle,
  Plus,
  RotateCcw,
  Truck,
  UserCheck,
  type LucideIcon,
} from "lucide-react";

import { useSession } from "@/lib/qne/session-context";
import { getStoredToken } from "@/lib/qne/tokens";
import { useTabs } from "@/lib/tabs";
import { formatMY, formatMYDateTime } from "@/lib/format-date";
import { StatusBadge, PriorityBadge, Skeleton } from "@/components/qne/badges";
import { MyDayPanel } from "@/components/qne/DaySchedule";
import { MY_WORK_CARDS, type MyWorkScope } from "@/lib/qne/dashboard/my-work-scope";
import {
  DashboardAction,
  DashboardHero,
  DashboardSection,
  DashboardSkeletonGrid,
  DashboardStatCard,
  type DashboardTone,
} from "@/components/qne/dashboard/DashboardPrimitives";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "My Dashboard — ServiceHub" },
      {
        name: "description",
        content: "Your personal service job workload, follow-ups and daily resolutions.",
      },
      { property: "og:title", content: "My Dashboard — ServiceHub" },
      {
        property: "og:description",
        content: "Your personal service job workload, follow-ups and daily resolutions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UserDashboard,
});

/* ---------------- types ---------------- */

interface MyWorkSummary {
  assignedToMe: number;
  myPendingTasks: number;
  myInProgress: number;
  myWaitingCustomer: number;
  myWaitingVendor: number;
  myWaitingApproval: number;
  myFollowUps: number;
  myReopenPending: number;
  resolvedByMeToday: number;
  /** Response compatibility only — never used as a success KPI. */
  completedByMeToday: number;
}

/** Card presentation, declared next to the shared scope definitions. */
const CARD_VISUALS: Record<MyWorkScope, { icon: LucideIcon; tone: DashboardTone }> = {
  my_pending_tasks: { icon: ListTodo, tone: "blue" },
  assigned_to_me: { icon: UserCheck, tone: "navy" },
  my_in_progress: { icon: PlayCircle, tone: "cyan" },
  waiting_approval: { icon: ClipboardCheck, tone: "amber" },
  waiting_customer: { icon: Clock, tone: "orange" },
  waiting_vendor: { icon: Truck, tone: "violet" },
  my_followups: { icon: Flag, tone: "rose" },
  my_reopen_pending: { icon: RotateCcw, tone: "amber" },
  resolved_by_me_today: { icon: CheckCircle2, tone: "emerald" },
};

function greeting(d: Date): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

interface MyWorkItem {
  id: string;
  job_number: string;
  customer_code_snapshot: string;
  customer_name_snapshot: string | null;
  subject: string;
  status: string;
  priority: string;
  source: string;
  requires_approval?: boolean;
  approval_reason?: string | null;
  assigned_at: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
}

interface MyWorkResponse {
  summary: MyWorkSummary;
  items: MyWorkItem[];
  total: number;
  page: number;
  pageSize: number;
  me: { userId: string | null; displayName: string; reason: string };
}

/* ---------------- helpers ---------------- */

function authHeaders(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const FILTERS_KEY = "sh2:myWorkFilters:v1";
const STATUS_OPTS = [
  "Draft",
  "Pending Approval",
  "Assigned",
  "In Progress",
  "Waiting Customer",
  "Waiting Vendor",
] as const;
const PRIORITY_OPTS = ["High", "Medium", "Low"] as const;
const AUTO_REFRESH_MS = 30_000;

interface MyFilters {
  q: string;
  statuses: string[];
  priorities: string[];
  from: string;
  to: string;
  includeCompleted: boolean;
}
const DEFAULT_FILTERS: MyFilters = {
  q: "",
  statuses: [],
  priorities: [],
  from: "",
  to: "",
  includeCompleted: false,
};

function loadFilters(): MyFilters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = window.sessionStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const p = JSON.parse(raw);
    return {
      q: typeof p.q === "string" ? p.q : "",
      statuses: Array.isArray(p.statuses)
        ? p.statuses.filter((x: unknown) => typeof x === "string")
        : [],
      priorities: Array.isArray(p.priorities)
        ? p.priorities.filter((x: unknown) => typeof x === "string")
        : [],
      from: typeof p.from === "string" ? p.from : "",
      to: typeof p.to === "string" ? p.to : "",
      includeCompleted: !!p.includeCompleted,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(f: MyFilters) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
}

function waitingAge(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const ms = Date.now() - then;
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h`;
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `${mins}m`;
}

/* ---------------- component ---------------- */

function UserDashboard() {
  const { session, currentUser } = useSession();
  const navigate = useNavigate();
  const { openJobTab } = useTabs();

  const name = currentUser?.displayName || session?.email || "there";
  const myUserId = currentUser?.diagnostics?.matchedN3UserId ?? currentUser?.userCode ?? null;

  const [filters, setFilters] = useState<MyFilters>(() => loadFilters());
  // The active card scope. The SERVER resolves it into the exact Job set the
  // card counted, so a count and the list it opens can never disagree.
  const [scope, setScope] = useState<MyWorkScope | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [data, setData] = useState<MyWorkResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  useEffect(() => saveFilters(filters), [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const sp = new URLSearchParams();
      sp.set("page", String(page));
      sp.set("pageSize", String(pageSize));
      if (scope) sp.set("scope", scope);
      if (filters.q.trim()) sp.set("q", filters.q.trim());
      if (!scope && filters.statuses.length) sp.set("statuses", filters.statuses.join(","));
      if (filters.priorities.length) sp.set("priorities", filters.priorities.join(","));
      if (filters.from) sp.set("from", filters.from);
      if (filters.to) sp.set("to", filters.to);
      if (!scope && filters.includeCompleted) sp.set("includeCompleted", "1");
      const res = await fetch(`/api/dashboard/my-work?${sp.toString()}`, {
        headers: authHeaders(),
      });
      const body = (await res.json().catch(() => ({}))) as MyWorkResponse & { error?: string };
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setData(body);
      setLastRefreshed(new Date());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load My Work");
    } finally {
      setLoading(false);
    }
  }, [filters, page, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh every 30s and when the tab regains focus.
  useEffect(() => {
    const onFocus = () => void load();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const iv = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, AUTO_REFRESH_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(iv);
    };
  }, [load]);

  const summary: MyWorkSummary = data?.summary ?? {
    assignedToMe: 0,
    myPendingTasks: 0,
    myInProgress: 0,
    myWaitingCustomer: 0,
    myWaitingVendor: 0,
    myWaitingApproval: 0,
    myFollowUps: 0,
    myReopenPending: 0,
    resolvedByMeToday: 0,
    completedByMeToday: 0,
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activeCard = MY_WORK_CARDS.find((c) => c.scope === scope) ?? null;

  const openJob = (r: MyWorkItem) => {
    openJobTab(r.id, r.job_number);
    navigate({ to: "/jobs/$jobId", params: { jobId: r.id } });
  };

  /**
   * Clicking a card opens exactly the scope it counted. Stale persisted
   * filters are discarded and paging restarts at page 1.
   */
  const applyCardScope = (next: MyWorkScope) => {
    setPage(1);
    setFilters(DEFAULT_FILTERS);
    setScope((cur) => (cur === next ? null : next));
  };

  const clearScope = () => {
    setPage(1);
    setScope(null);
  };

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  return (
    <div className="min-w-0 space-y-6">
      <DashboardHero
        eyebrow="My operational workspace"
        title={`${greeting(new Date())}, ${name}`}
        subtitle={`${session?.companyName || "—"} · everything assigned to you, in one place.`}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{formatMY(new Date().toISOString())}</span>
            <span>
              {lastRefreshed
                ? `Updated ${lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : "Loading…"}
            </span>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="min-h-11 rounded-md border bg-card/90 px-3 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-50 sm:min-h-9"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </span>
        }
        actions={
          <>
            <DashboardAction to="/jobs/new" label="New Service Job" icon={Plus} primary />
            <DashboardAction to="/support" label="Workspace" icon={LayoutList} />
            <DashboardAction to="/jobs/pending" label="Pending Queue" icon={ClipboardCheck} />
            <DashboardAction to="/calendar" label="Calendar" icon={CalendarDays} />
          </>
        }
      />

      {!myUserId && (
        <div className="rounded-lg border border-dashboard-amber/40 bg-dashboard-amber-soft px-4 py-3 text-sm text-dashboard-ink">
          Your account isn't linked to an N3 user, so personal counts are empty. Ask an
          administrator to grant you access.
        </div>
      )}

      <MyDayPanel />

      <DashboardSection
        title="My work"
        description="Every card opens exactly the jobs it counted, including when that is none."
      >
        {loading && !data ? (
          <DashboardSkeletonGrid count={9} />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {MY_WORK_CARDS.map((card) => (
              <DashboardStatCard
                key={card.scope}
                label={card.label}
                value={summary[card.summaryKey]}
                meaning={card.meaning}
                icon={CARD_VISUALS[card.scope].icon}
                tone={CARD_VISUALS[card.scope].tone}
                active={scope === card.scope}
                onClick={() => applyCardScope(card.scope)}
              />
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {activeCard ? (
            <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-dashboard-blue/30 bg-dashboard-blue-soft px-3 font-semibold text-dashboard-ink">
              Showing: {activeCard.label}
              <button
                type="button"
                onClick={clearScope}
                className="rounded-full px-2 py-0.5 font-semibold text-dashboard-navy underline-offset-2 hover:underline"
              >
                Clear scope
              </button>
            </span>
          ) : (
            <span className="inline-flex min-h-11 items-center rounded-full border bg-card px-3 font-semibold text-muted-foreground">
              Showing: All My Work
            </span>
          )}
          <Link
            to="/jobs/pending"
            search={{
              scope: undefined,
              queueType: undefined,
              technician: undefined,
              technicianName: undefined,
            }}
            className="font-medium text-dashboard-navy hover:underline"
          >
            View Office-Wide Assigned Queue →
          </Link>
          <Link
            to="/jobs/pending"
            search={{
              scope: "team" as const,
              queueType: undefined,
              technician: undefined,
              technicianName: undefined,
            }}
            className="font-medium text-dashboard-navy hover:underline"
          >
            Pending from My Team →
          </Link>
        </div>
      </DashboardSection>

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>My Work list</SectionTitle>
          <div className="text-xs text-muted-foreground">{total} job(s)</div>
        </div>

        {/* Filters */}
        <div className="mt-3 space-y-3 rounded-xl border bg-card p-3 shadow-sm sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={filters.q}
              onChange={(e) => {
                setPage(1);
                setFilters({ ...filters, q: e.target.value });
              }}
              placeholder="Search job number, customer or subject"
              className="min-h-[44px] flex-1 min-w-[220px] rounded-md border bg-background px-3 text-sm"
            />
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={filters.includeCompleted}
                onChange={(e) => {
                  setPage(1);
                  setFilters({ ...filters, includeCompleted: e.target.checked });
                }}
                className="h-4 w-4"
              />
              Include Completed
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterGroup label="Status">
              {STATUS_OPTS.map((s) => (
                <Pill
                  key={s}
                  active={filters.statuses.includes(s)}
                  onClick={() => {
                    setPage(1);
                    setFilters({ ...filters, statuses: toggle(filters.statuses, s) });
                  }}
                >
                  {s}
                </Pill>
              ))}
            </FilterGroup>
            <FilterGroup label="Priority">
              {PRIORITY_OPTS.map((p) => (
                <Pill
                  key={p}
                  active={filters.priorities.includes(p)}
                  onClick={() => {
                    setPage(1);
                    setFilters({ ...filters, priorities: toggle(filters.priorities, p) });
                  }}
                >
                  {p}
                </Pill>
              ))}
            </FilterGroup>
            <FilterGroup label="From">
              <DateBox
                value={filters.from}
                onChange={(v) => {
                  setPage(1);
                  setFilters({ ...filters, from: v });
                }}
              />
            </FilterGroup>
            <FilterGroup label="To">
              <DateBox
                value={filters.to}
                onChange={(v) => {
                  setPage(1);
                  setFilters({ ...filters, to: v });
                }}
              />
            </FilterGroup>
            {filters.q ||
            filters.statuses.length ||
            filters.priorities.length ||
            filters.from ||
            filters.to ||
            filters.includeCompleted ? (
              <button
                type="button"
                className="min-h-[44px] rounded-md border px-3 text-sm text-muted-foreground hover:bg-accent"
                onClick={() => {
                  setPage(1);
                  setFilters(DEFAULT_FILTERS);
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        {/* Results */}
        {err && (
          <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </div>
        )}
        {loading && (
          <div className="mt-3 rounded-md border bg-card px-3 py-4 text-sm text-muted-foreground">
            Loading…
          </div>
        )}
        {!loading && !err && items.length === 0 && (
          <div className="mt-3 rounded-md border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
            No jobs assigned to you.
          </div>
        )}

        {/* Mobile cards */}
        {items.length > 0 && (
          <ul className="mt-3 space-y-2 md:hidden">
            {items.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => openJob(r)}
                  className="flex w-full flex-col gap-1 rounded-lg border bg-card p-3 text-left shadow-sm hover:bg-accent/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {r.job_number}
                    </span>
                    <PriorityBadge priority={r.priority} />
                  </div>
                  <div className="truncate text-sm font-medium text-foreground">{r.subject}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.customer_name_snapshot ?? r.customer_code_snapshot}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <StatusBadge status={r.status} />
                    <span>Waiting {waitingAge(r.assigned_at ?? r.created_at)}</span>
                    <span>Created {formatMY(r.created_at)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Desktop table */}
        {items.length > 0 && (
          <div className="mt-3 hidden overflow-hidden rounded-xl border bg-card shadow-sm md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Job #</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Subject</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Priority</th>
                  <th className="px-3 py-2">Waiting</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Last Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => openJob(r)}
                    className="cursor-pointer hover:bg-accent/40"
                  >
                    <td className="px-3 py-2 font-mono font-semibold text-foreground">
                      {r.job_number}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {r.customer_name_snapshot ?? r.customer_code_snapshot}
                    </td>
                    <td className="px-3 py-2 text-foreground">{r.subject}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2">
                      <PriorityBadge priority={r.priority} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {waitingAge(r.assigned_at ?? r.created_at)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{formatMY(r.created_at)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatMYDateTime(r.updated_at ?? r.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <div>
              Page {page} of {totalPages}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="min-h-9 rounded-md border px-3 disabled:opacity-40"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="min-h-9 rounded-md border px-3 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------------- pieces ---------------- */

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-9 rounded-full border px-3 text-xs font-medium transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-card text-muted-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

function DateBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-[44px] rounded-md border bg-background px-2 text-sm"
    />
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

/* ---------------- kpi card ---------------- */

type Tone = "blue" | "green" | "amber" | "red" | "purple" | "grey";

const toneClasses: Record<Tone, { ring: string; icon: string; badge: string }> = {
  blue: {
    ring: "before:bg-blue-500",
    icon: "bg-blue-100 text-blue-700",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
  },
  green: {
    ring: "before:bg-emerald-500",
    icon: "bg-emerald-100 text-emerald-700",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  amber: {
    ring: "before:bg-amber-500",
    icon: "bg-amber-100 text-amber-800",
    badge: "bg-amber-50 text-amber-800 ring-amber-200",
  },
  red: {
    ring: "before:bg-red-500",
    icon: "bg-red-100 text-red-700",
    badge: "bg-red-50 text-red-700 ring-red-200",
  },
  purple: {
    ring: "before:bg-purple-500",
    icon: "bg-purple-100 text-purple-700",
    badge: "bg-purple-50 text-purple-700 ring-purple-200",
  },
  grey: {
    ring: "before:bg-slate-400",
    icon: "bg-slate-100 text-slate-700",
    badge: "bg-slate-100 text-slate-600 ring-slate-200",
  },
};

// Kept for /admin/dashboard which imports StatCard from this file.
export function StatCard({
  label,
  value,
  tone = "blue",
  comingSoon,
  hint,
}: {
  label: string;
  value?: string | number;
  tone?: Tone;
  comingSoon?: boolean;
  hint?: string;
}) {
  const t = toneClasses[tone];
  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm transition-colors before:absolute before:left-0 before:top-0 before:h-full before:w-1 ${t.ring}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {comingSoon && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${t.badge}`}
          >
            Coming soon
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">
        {comingSoon ? "—" : (value ?? "—")}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
