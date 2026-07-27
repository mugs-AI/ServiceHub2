import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { useSession } from "@/lib/qne/session-context";
import { getStoredToken } from "@/lib/qne/tokens";
import { useTabs } from "@/lib/tabs";
import { formatMY, formatMYDateTime } from "@/lib/format-date";

export const Route = createFileRoute("/dashboard")({
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
  completedByMeToday: number;
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
      statuses: Array.isArray(p.statuses) ? p.statuses.filter((x: unknown) => typeof x === "string") : [],
      priorities: Array.isArray(p.priorities) ? p.priorities.filter((x: unknown) => typeof x === "string") : [],
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
  const myUserId =
    currentUser?.diagnostics?.matchedN3UserId ?? currentUser?.userCode ?? null;

  const [filters, setFilters] = useState<MyFilters>(() => loadFilters());
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
      if (filters.q.trim()) sp.set("q", filters.q.trim());
      if (filters.statuses.length) sp.set("statuses", filters.statuses.join(","));
      if (filters.priorities.length) sp.set("priorities", filters.priorities.join(","));
      if (filters.from) sp.set("from", filters.from);
      if (filters.to) sp.set("to", filters.to);
      if (filters.includeCompleted) sp.set("includeCompleted", "1");
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
  }, [filters, page]);

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

  const summary = data?.summary ?? {
    assignedToMe: 0,
    myPendingTasks: 0,
    myInProgress: 0,
    myWaitingCustomer: 0,
    myWaitingVendor: 0,
    myWaitingApproval: 0,
    completedByMeToday: 0,
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const openJob = (r: MyWorkItem) => {
    openJobTab(r.id, r.job_number);
    navigate({ to: "/jobs/$jobId", params: { jobId: r.id } });
  };

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  return (
    <div className="space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            My workspace
          </p>
          <h1 className="mt-1 truncate text-2xl font-semibold text-foreground sm:text-3xl">
            Hello, {name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {session?.companyName || "—"} · What needs your attention today
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 text-[11px] text-muted-foreground">
            {lastRefreshed ? `Updated ${lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "—"}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="min-h-9 rounded-md border bg-card px-3 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <QuickLink to="/support" label="Workspace" />
          <QuickLink to="/jobs/pending" label="Pending Queue" />
          <QuickLink to="/jobs/new" label="New Service Job" primary />
        </div>
      </header>

      {!myUserId && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Your account isn't linked to an N3 user, so personal counts are empty.
          Ask an administrator to grant you access.
        </div>
      )}

      <section>
        <SectionTitle>My work</SectionTitle>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <StatLink onClick={() => setFilters({ ...DEFAULT_FILTERS })}><MiniStat label="My Pending Tasks" value={summary.myPendingTasks} tone="blue" emphasise /></StatLink>
          <StatLink onClick={() => setFilters({ ...DEFAULT_FILTERS, statuses: ["Assigned"] })}><MiniStat label="Assigned to Me" value={summary.assignedToMe} tone="blue" /></StatLink>
          <StatLink onClick={() => setFilters({ ...DEFAULT_FILTERS, statuses: ["Pending Approval"] })}><MiniStat label="Waiting Approval" value={summary.myWaitingApproval} tone="amber" /></StatLink>
          <StatLink onClick={() => setFilters({ ...DEFAULT_FILTERS, statuses: ["In Progress"] })}><MiniStat label="My In Progress" value={summary.myInProgress} tone="amber" /></StatLink>
          <StatLink onClick={() => setFilters({ ...DEFAULT_FILTERS, statuses: ["Waiting Customer"] })}><MiniStat label="My Waiting Customer" value={summary.myWaitingCustomer} tone="amber" /></StatLink>
          <StatLink onClick={() => setFilters({ ...DEFAULT_FILTERS, statuses: ["Waiting Vendor"] })}><MiniStat label="My Waiting Vendor" value={summary.myWaitingVendor} tone="purple" /></StatLink>
          <MiniStat label="Completed by Me Today" value={summary.completedByMeToday} tone="green" />
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <Link to="/jobs/pending" className="font-medium text-primary hover:underline">
            View Office-Wide Assigned Queue →
          </Link>
          <Link
            to="/jobs/pending"
            search={{ scope: "team" as const }}
            className="font-medium text-primary hover:underline"
          >
            Pending from My Team →
          </Link>
        </p>
      </section>

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
              onChange={(e) => { setPage(1); setFilters({ ...filters, q: e.target.value }); }}
              placeholder="Search job number, customer or subject"
              className="min-h-[44px] flex-1 min-w-[220px] rounded-md border bg-background px-3 text-sm"
            />
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={filters.includeCompleted}
                onChange={(e) => { setPage(1); setFilters({ ...filters, includeCompleted: e.target.checked }); }}
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
                  onClick={() => { setPage(1); setFilters({ ...filters, statuses: toggle(filters.statuses, s) }); }}
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
                  onClick={() => { setPage(1); setFilters({ ...filters, priorities: toggle(filters.priorities, p) }); }}
                >
                  {p}
                </Pill>
              ))}
            </FilterGroup>
            <FilterGroup label="From">
              <DateBox value={filters.from} onChange={(v) => { setPage(1); setFilters({ ...filters, from: v }); }} />
            </FilterGroup>
            <FilterGroup label="To">
              <DateBox value={filters.to} onChange={(v) => { setPage(1); setFilters({ ...filters, to: v }); }} />
            </FilterGroup>
            {(filters.q || filters.statuses.length || filters.priorities.length || filters.from || filters.to || filters.includeCompleted) ? (
              <button
                type="button"
                className="min-h-[44px] rounded-md border px-3 text-sm text-muted-foreground hover:bg-accent"
                onClick={() => { setPage(1); setFilters(DEFAULT_FILTERS); }}
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
                    <span className="font-mono text-sm font-semibold text-foreground">{r.job_number}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${priorityTone(r.priority)}`}>
                      {r.priority}
                    </span>
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
                    <td className="px-3 py-2 font-mono font-semibold text-foreground">{r.job_number}</td>
                    <td className="px-3 py-2 text-foreground">{r.customer_name_snapshot ?? r.customer_code_snapshot}</td>
                    <td className="px-3 py-2 text-foreground">{r.subject}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${priorityTone(r.priority)}`}>
                        {r.priority}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{waitingAge(r.assigned_at ?? r.created_at)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatMY(r.created_at)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatMYDateTime(r.updated_at ?? r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <div>Page {page} of {totalPages}</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="min-h-9 rounded-md border px-3 disabled:opacity-40"
              >Prev</button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="min-h-9 rounded-md border px-3 disabled:opacity-40"
              >Next</button>
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
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
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

function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    "Assigned": "bg-blue-50 text-blue-700 ring-blue-200",
    "In Progress": "bg-amber-50 text-amber-800 ring-amber-200",
    "Waiting Customer": "bg-amber-50 text-amber-800 ring-amber-200",
    "Waiting Vendor": "bg-purple-50 text-purple-700 ring-purple-200",
    "Completed": "bg-emerald-50 text-emerald-700 ring-emerald-200",
  };
  const cls = tone[status] ?? "bg-slate-100 text-slate-600 ring-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${cls}`}>
      {status}
    </span>
  );
}

function priorityTone(p: string): string {
  if (p === "High") return "border-red-300 bg-red-50 text-red-700";
  if (p === "Medium") return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-slate-300 bg-slate-50 text-slate-600";
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
  blue: { ring: "before:bg-blue-500", icon: "bg-blue-100 text-blue-700", badge: "bg-blue-50 text-blue-700 ring-blue-200" },
  green: { ring: "before:bg-emerald-500", icon: "bg-emerald-100 text-emerald-700", badge: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  amber: { ring: "before:bg-amber-500", icon: "bg-amber-100 text-amber-800", badge: "bg-amber-50 text-amber-800 ring-amber-200" },
  red: { ring: "before:bg-red-500", icon: "bg-red-100 text-red-700", badge: "bg-red-50 text-red-700 ring-red-200" },
  purple: { ring: "before:bg-purple-500", icon: "bg-purple-100 text-purple-700", badge: "bg-purple-50 text-purple-700 ring-purple-200" },
  grey: { ring: "before:bg-slate-400", icon: "bg-slate-100 text-slate-700", badge: "bg-slate-100 text-slate-600 ring-slate-200" },
};

function MiniStat({
  label,
  value,
  tone,
  emphasise,
}: {
  label: string;
  value: number;
  tone: Tone;
  emphasise?: boolean;
}) {
  const t = toneClasses[tone];
  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-card p-3 shadow-sm before:absolute before:left-0 before:top-0 before:h-full before:w-1 ${t.ring} ${emphasise ? "ring-1 ring-primary/30" : ""}`}
    >
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1 font-semibold text-foreground ${emphasise ? "text-3xl" : "text-2xl"}`}>{value}</div>
    </div>
  );
}

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

function QuickLink({ to, label, primary }: { to: string; label: string; primary?: boolean }) {
  return (
    <Link
      to={to}
      className={
        primary
          ? "inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          : "inline-flex min-h-11 items-center rounded-lg border bg-card px-4 text-sm font-medium text-foreground shadow-sm hover:bg-accent"
      }
    >
      {label}
    </Link>
  );
}

function StatLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="block w-full text-left transition-transform hover:scale-[1.01]">
      {children}
    </button>
  );
}
