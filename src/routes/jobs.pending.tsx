import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { getStoredToken } from "@/lib/qne/tokens";
import { useTabs } from "@/lib/tabs";
import { useSession } from "@/lib/qne/session-context";
import { formatMYDateTime } from "@/lib/format-date";
import { StatusBadge, PriorityBadge, Skeleton } from "@/components/qne/badges";
import { QUEUE_REOPEN_REQUESTS } from "@/lib/qne/service-jobs/wp3a-queues";
import {
  APPROVAL_TYPES,
  COMPLETED_PAGE_SIZES,
  COMPLETED_SUBFILTERS,
  QUEUE_GROUPS,
  WAITING_SUBFILTERS,
  type QueueGroup,
  type QueueView,
  defaultCompletedRange,
  defaultScopeForGroup,
  serverQueueTypeFor,
  usesDefaultCompletedRange,
  viewForQueueKey,
} from "@/lib/qne/dashboard/pending-queue-groups";
import { MalaysiaDateInput } from "@/components/qne/MalaysiaDateInput";

/** Owner/Admin decision queue row (GET /api/admin/cancellation-requests). */
interface CancellationRow {
  request_id: string;
  service_job_id: string;
  job_number: string;
  subject: string;
  customer_code: string;
  customer_name: string | null;
  job_status: string;
  priority: string;
  assigned_user_name: string | null;
  requested_by_name: string | null;
  requested_at: string;
  reason: string;
  prior_status: string;
}

/** Admin decision-queue key (also used by the Admin Dashboard deep link). */
const CANCELLATION_QUEUE = "cancellation_requests";
/** Safe Workspace queue key used by Normal Users for the same visible tab. */
const CANCELLATION_WORKSPACE_QUEUE = "cancellation_requested";

interface QueueRow {
  id: string;
  job_number: string;
  customer_code_snapshot: string;
  customer_name_snapshot: string | null;
  subject: string;
  status: string;
  priority: string;
  source: string;
  requires_approval: boolean;
  approval_reason: string | null;
  subscription_category_snapshot: string | null;
  stock_code_snapshot: string | null;
  entitlement_status_snapshot: string | null;
  entitlement_expiry_snapshot: string | null;
  assigned_user_id: string | null;
  assigned_user_name_snapshot: string | null;
  created_at: string;
  completed_at?: string | null;
  /** Owner/Admin only — set by the server for Jobs with an active request. */
  has_active_cancellation_request?: boolean;
  /** Completion outcome indicator, when decided by the outcome read model. */
  outcome?: string | null;
}

/** WP3A — pending reopen request row (GET /api/workspace/reopen-requests). */
interface ReopenRow {
  request_id: string;
  service_job_id: string;
  job_number: string;
  subject: string;
  customer_code: string;
  customer_name: string | null;
  job_status: string;
  priority: string;
  assigned_user_name: string | null;
  requested_by_name: string | null;
  requested_at: string;
  reason: string;
  prior_status: string;
}

/** Empty-state copy per exact scope key. */
const EMPTY_MSG: Record<string, string> = {
  "": "No jobs currently require action.",
  draft: "No Draft jobs.",
  open_unassigned: "No Open unassigned jobs.",
  assigned_not_started: "No Assigned jobs.",
  in_progress: "No jobs in progress.",
  active: "No active jobs.",
  jobs_today: "No jobs created today.",
  waiting: "No jobs waiting on customer or vendor.",
  waiting_customer: "No jobs waiting on customer.",
  waiting_vendor: "No jobs waiting on vendor.",
  pending_approval: "No Job Approvals pending.",
  [CANCELLATION_QUEUE]: "No jobs with a pending cancellation request.",
  [QUEUE_REOPEN_REQUESTS]: "No pending reopen requests.",
  approvals: "Nothing is waiting for approval.",
  completed: "No completed jobs in this date range.",
  resolved: "No resolved jobs in this date range.",
  follow_up_open: "No open follow-ups.",
  reopen_pending: "No reopen-pending jobs.",
  legacy_completed: "No legacy completed jobs without modern evidence.",
  resolved_today: "Nothing resolved today yet.",
  completed_current_cycle: "No completed jobs in the current cycle.",
  cancelled: "No cancelled jobs.",
  all_jobs: "No jobs.",
};

const OUTCOME_BADGE: Record<string, { label: string; cls: string }> = {
  resolved_at_completion: { label: "Resolved", cls: "border-emerald-300 bg-emerald-50 text-emerald-900" },
  resolved_after_follow_up: {
    label: "Resolved after Follow-up",
    cls: "border-emerald-300 bg-emerald-50 text-emerald-900",
  },
  follow_up_open: { label: "Follow-up Open", cls: "border-amber-300 bg-amber-50 text-amber-900" },
  reopen_pending: { label: "Reopen Pending", cls: "border-orange-300 bg-orange-50 text-orange-900" },
  legacy_unknown: { label: "Legacy · Data Alert", cls: "border-rose-300 bg-rose-50 text-rose-900" },
};

export const Route = createFileRoute("/jobs/pending")({
  validateSearch: (s: Record<string, unknown>) => ({
    scope: s.scope === "team" ? ("team" as const) : undefined,
    queueType: typeof s.queueType === "string" ? s.queueType : undefined,
    technician: typeof s.technician === "string" ? s.technician : undefined,
    technicianName: typeof s.technicianName === "string" ? s.technicianName : undefined,
  }),
  component: PendingQueuePage,
});

function authHeaders(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function PendingQueuePage() {
  const { scope, queueType: qtInit, technician: techInit, technicianName } = Route.useSearch();
  const excludeMe = scope === "team";
  const [view, setView] = useState<QueueView>(() => viewForQueueKey(qtInit));
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState("");
  const [technicianFilter] = useState<string>(techInit ?? "");
  const [page, setPage] = useState(1);
  const [completedPageSize, setCompletedPageSize] = useState<number>(20);
  // WP3C-2 — Completed is server-bounded: latest three Malaysia months by
  // default; dashboard deep links open without a window to keep count parity.
  const [completedRange, setCompletedRange] = useState<{ from: string; to: string }>(() =>
    usesDefaultCompletedRange(qtInit) ? defaultCompletedRange() : { from: "", to: "" },
  );

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [cancelRows, setCancelRows] = useState<CancellationRow[]>([]);
  const [reopenRows, setReopenRows] = useState<ReopenRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const navigate = useNavigate();
  const { openJobTab } = useTabs();
  const { currentUser } = useSession();
  const isAdmin = !!currentUser?.isAdministrator;

  const isCompletedGroup = view.group === "completed";
  const pageSize = isCompletedGroup ? completedPageSize : approvalsAll ? 100 : 25;
  const approvalsAll = view.group === "approvals" && view.scope === "";
  const isCancellationScope = view.group === "approvals" && view.scope === CANCELLATION_QUEUE;
  const reopenScope = view.group === "approvals" && view.scope === QUEUE_REOPEN_REQUESTS;
  const serverQueueType = serverQueueTypeFor(view);

  const selectGroup = (group: QueueGroup) => {
    setView({ group, scope: defaultScopeForGroup(group), chip: null });
    if (group === "completed" && !completedRange.from && !completedRange.to) {
      setCompletedRange(defaultCompletedRange());
    }
    setPage(1);
  };
  const selectScope = (scopeKey: string) => {
    setView((v) => ({ group: v.group, scope: scopeKey, chip: null }));
    setPage(1);
  };
  const clearChip = () => selectGroup(view.group);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const base = new URLSearchParams();
      base.set("page", String(page));
      base.set("pageSize", String(pageSize));
      if (q.trim()) base.set("q", q.trim());
      if (priority) base.set("priority", priority);

      const loadCancellations = async (sp: URLSearchParams) => {
        if (isAdmin) {
          const res = await fetch(`/api/admin/cancellation-requests?${sp.toString()}`, {
            headers: authHeaders(),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body?.error ?? "Failed to load cancellation requests");
          return { admin: (body.requests ?? []) as CancellationRow[], jobs: [] as QueueRow[], total: Number(body.total ?? 0) };
        }
        // Normal Users see the safe, Job-state-only view of the same scope.
        const js = new URLSearchParams(sp);
        js.set("queueType", CANCELLATION_WORKSPACE_QUEUE);
        if (technicianFilter) js.set("technician", technicianFilter);
        if (excludeMe) js.set("excludeMe", "1");
        const res = await fetch(`/api/workspace/jobs/pending?${js.toString()}`, { headers: authHeaders() });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? "Failed to load queue");
        return { admin: [] as CancellationRow[], jobs: (body.jobs ?? []) as QueueRow[], total: Number(body.total ?? 0) };
      };
      const loadReopens = async (sp: URLSearchParams) => {
        const res = await fetch(`/api/workspace/reopen-requests?${sp.toString()}`, {
          headers: authHeaders(),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? "Failed to load reopen requests");
        return { rows: (body.requests ?? []) as ReopenRow[], total: Number(body.total ?? 0) };
      };
      const loadJobs = async (queue: string) => {
        const sp = new URLSearchParams(base);
        if (queue) sp.set("queueType", queue);
        if (technicianFilter) sp.set("technician", technicianFilter);
        if (excludeMe) sp.set("excludeMe", "1");
        if (isCompletedGroup) {
          if (completedRange.from) sp.set("completedFrom", completedRange.from);
          if (completedRange.to) sp.set("completedTo", completedRange.to);
        }
        const res = await fetch(`/api/workspace/jobs/pending?${sp.toString()}`, {
          headers: authHeaders(),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? "Failed to load queue");
        return { rows: (body.jobs ?? []) as QueueRow[], total: Number(body.total ?? 0) };
      };

      if (approvalsAll) {
        // Approvals > All: every pending approval type, each with its type
        // indicator. Each source stays tenant/role scoped by its own API.
        const [jobs, cancels, reopens] = await Promise.all([
          loadJobs("pending_approval"),
          loadCancellations(base),
          loadReopens(base),
        ]);
        setRows([...jobs.rows, ...cancels.jobs]);
        setCancelRows(cancels.admin);
        setReopenRows(reopens.rows);
        setTotal(Math.max(jobs.total, cancels.total, reopens.total));
        return;
      }
      if (isCancellationScope) {
        const c = await loadCancellations(base);
        setCancelRows(c.admin);
        setRows(c.jobs);
        setReopenRows([]);
        setTotal(c.total);
        return;
      }
      if (reopenScope) {
        const r = await loadReopens(base);
        setReopenRows(r.rows);
        setRows([]);
        setCancelRows([]);
        setTotal(r.total);
        return;
      }
      const j = await loadJobs(serverQueueType ?? "");
      setRows(j.rows);
      setCancelRows([]);
      setReopenRows([]);
      setTotal(j.total);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [
    page,
    pageSize,
    q,
    priority,
    technicianFilter,
    excludeMe,
    isAdmin,
    approvalsAll,
    isCancellationScope,
    reopenScope,
    serverQueueType,
    isCompletedGroup,
    completedRange.from,
    completedRange.to,
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openJob = (id: string, jobNumber: string) => {
    openJobTab(id, jobNumber);
    navigate({ to: "/jobs/$jobId", params: { jobId: id } });
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const emptyKey = approvalsAll ? "approvals" : (serverQueueType ?? view.scope);
  const subFilters =
    view.group === "waiting"
      ? WAITING_SUBFILTERS
      : view.group === "approvals"
        ? APPROVAL_TYPES
        : view.group === "completed"
          ? COMPLETED_SUBFILTERS
          : null;
  const chipClass = (active: boolean) =>
    `min-h-11 shrink-0 rounded-full border px-3 text-xs font-semibold transition-colors sm:min-h-9 ${
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
    }`;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Workspace</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">
            {excludeMe ? "Pending from My Team" : "Pending"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {excludeMe
              ? "Office-wide pending jobs, excluding jobs assigned to you."
              : "Sorted by priority (High → Low), then oldest waiting first."}
          </p>
          {technicianFilter && (
            <p className="mt-1 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              Technician: {technicianName ?? technicianFilter}
              <Link
                to="/jobs/pending"
                search={{
                  scope: undefined,
                  queueType: undefined,
                  technician: undefined,
                  technicianName: undefined,
                }}
                className="text-primary/70 hover:text-primary"
              >
                clear
              </Link>
            </p>
          )}
        </div>
      </header>

      {/* WP3C-2 — six primary groups (3×2 on phones, one row on desktop). */}
      <div
        role="tablist"
        aria-label="Queue groups"
        className="grid grid-cols-3 gap-1 rounded-lg border bg-card p-1 sm:flex sm:flex-wrap"
      >
        {QUEUE_GROUPS.map((g) => {
          const active = view.group === g.key;
          return (
            <button
              key={g.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectGroup(g.key)}
              className={`min-h-11 rounded-md px-2 text-xs font-semibold transition-colors sm:min-h-9 sm:px-3 ${
                active
                  ? "bg-primary text-primary-foreground ring-2 ring-primary/40"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {(subFilters || view.chip) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {subFilters?.map((f) => (
            <button
              key={f.key || "all"}
              type="button"
              aria-pressed={!view.chip && view.scope === f.key}
              onClick={() => selectScope(f.key)}
              className={chipClass(!view.chip && view.scope === f.key)}
            >
              {f.label}
            </button>
          ))}
          {view.chip && (
            <span
              data-testid="active-filter-chip"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary sm:min-h-9"
            >
              Filter: {view.chip}
              <button
                type="button"
                aria-label={`Clear ${view.chip} filter`}
                onClick={clearChip}
                className="text-primary/70 hover:text-primary"
              >
                ✕
              </button>
            </span>
          )}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search job, subject or customer"
          className="min-h-11 rounded-lg border-[1.5px] border-gray-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:bg-blue-50"
        />
        <select
          value={priority}
          onChange={(e) => {
            setPriority(e.target.value);
            setPage(1);
          }}
          className="min-h-11 rounded-lg border-[1.5px] border-gray-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:bg-blue-50"
        >
          <option value="">All priorities</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
        {isCompletedGroup && (
          <select
            aria-label="Rows per page"
            value={completedPageSize}
            onChange={(e) => {
              setCompletedPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="min-h-11 rounded-lg border-[1.5px] border-gray-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:bg-blue-50"
          >
            {COMPLETED_PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} per page
              </option>
            ))}
          </select>
        )}
      </div>

      {isCompletedGroup && (
        <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
          <MalaysiaDateInput
            label="Completed from"
            value={completedRange.from}
            onChange={(iso) => {
              setCompletedRange((r) => ({ ...r, from: iso }));
              setPage(1);
            }}
            className="sm:w-44"
          />
          <MalaysiaDateInput
            label="Completed to"
            value={completedRange.to}
            onChange={(iso) => {
              setCompletedRange((r) => ({ ...r, to: iso }));
              setPage(1);
            }}
            className="sm:w-44"
          />
          <button
            type="button"
            onClick={() => {
              setCompletedRange(defaultCompletedRange());
              setPage(1);
            }}
            className="col-span-2 min-h-11 rounded-md border px-3 text-xs font-semibold hover:bg-accent sm:col-span-1"
          >
            Last 3 months
          </button>
        </div>
      )}

      {err && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>
      )}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}
      {!loading &&
        rows.length === 0 &&
        cancelRows.length === 0 &&
        reopenRows.length === 0 &&
        !err && (
          <div className="rounded-lg border border-dashed bg-background/60 px-4 py-6 text-center text-sm text-muted-foreground">
            {EMPTY_MSG[emptyKey] ?? "No jobs."}
          </div>
        )}

      {/* Reopen requests: enough context to decide, and a clear open action
          to the Job where an Owner/Admin approves or rejects. */}
      {reopenRows.length > 0 && (
        <ul data-testid="reopen-queue" className="space-y-2">
          {reopenRows.map((r) => (
            <li key={r.request_id}>
              <button
                type="button"
                onClick={() => openJob(r.service_job_id, r.job_number)}
                className="block w-full min-w-0 rounded-lg border-2 border-amber-300 border-l-4 border-l-amber-500 bg-amber-50 p-3 text-left shadow-sm hover:bg-amber-100"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-primary underline-offset-2 hover:underline">
                    {r.job_number}
                  </span>
                  <span className="text-[10px] uppercase text-muted-foreground">
                    Requested {formatMYDateTime(r.requested_at)}
                  </span>
                </div>
                <div className="mt-1 break-words text-sm font-semibold">{r.subject}</div>
                <div className="break-words text-xs text-muted-foreground">
                  {r.customer_name ?? r.customer_code}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] font-semibold">
                  <span className="rounded-full border border-amber-500 bg-amber-100 px-2 py-0.5 uppercase text-amber-900">
                    Reopen Request
                  </span>
                  <StatusBadge status={r.job_status} />
                  <PriorityBadge priority={r.priority} />
                  <span className="rounded-full border px-2 py-0.5 uppercase text-muted-foreground">
                    {r.assigned_user_name ?? "Unassigned"}
                  </span>
                  <span className="rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-amber-900">
                    Awaiting Owner/Admin Decision
                  </span>
                </div>
                <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  <div className="break-words">
                    Requested by{" "}
                    <span className="font-medium text-foreground">
                      {r.requested_by_name ?? "—"}
                    </span>
                  </div>
                  <div className="break-words whitespace-pre-wrap text-foreground">{r.reason}</div>
                  <div className="font-semibold text-primary">Open Job to decide →</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {cancelRows.length > 0 && (
        <ul className="space-y-2">
          {cancelRows.map((r) => (
            <li key={r.request_id}>
              <button
                type="button"
                onClick={() => openJob(r.service_job_id, r.job_number)}
                className="block w-full rounded-lg border-2 border-red-300 border-l-4 border-l-red-500 bg-red-50 p-3 text-left shadow-sm hover:bg-red-100"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-primary underline-offset-2 hover:underline">
                    {r.job_number}
                  </span>
                  <span className="text-[10px] uppercase text-muted-foreground">
                    Requested {formatMYDateTime(r.requested_at)}
                  </span>
                </div>
                <div className="mt-1 break-words text-sm font-semibold">{r.subject}</div>
                <div className="text-xs text-muted-foreground">
                  {r.customer_name ?? r.customer_code}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] font-semibold">
                  <span className="rounded-full border border-red-400 bg-red-100 px-2 py-0.5 uppercase text-red-900">
                    Cancellation Request
                  </span>
                  <StatusBadge status={r.job_status} />
                  <PriorityBadge priority={r.priority} />
                  <span className="rounded-full border px-2 py-0.5 uppercase text-muted-foreground">
                    {r.assigned_user_name ?? "Unassigned"}
                  </span>
                  <span className="rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-red-900">
                    Awaiting Owner/Admin Decision
                  </span>
                </div>
                <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  <div>
                    Requested by{" "}
                    <span className="font-medium text-foreground">
                      {r.requested_by_name ?? "—"}
                    </span>{" "}
                    · Prior status {r.prior_status}
                  </div>
                  <div className="whitespace-pre-wrap text-foreground">{r.reason}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => {
            const outcome = r.outcome ? OUTCOME_BADGE[r.outcome] : undefined;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => openJob(r.id, r.job_number)}
                  className={`block w-full rounded-lg border p-3 text-left shadow-sm ${
                    r.has_active_cancellation_request
                      ? "border-red-300 border-l-4 border-l-red-500 bg-red-50 hover:bg-red-100"
                      : "bg-background hover:bg-accent/40"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-primary underline-offset-2 hover:underline">
                      {r.job_number}
                    </span>
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {isCompletedGroup && r.completed_at
                        ? `Completed ${formatMYDateTime(r.completed_at)}`
                        : formatMYDateTime(r.created_at)}
                    </span>
                  </div>
                  <div className="mt-1 break-words text-sm font-semibold">{r.subject}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.customer_name_snapshot ?? r.customer_code_snapshot}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] font-semibold">
                    {approvalsAll && r.status === "Pending Approval" && (
                      <span className="rounded-full border border-sky-400 bg-sky-50 px-2 py-0.5 uppercase text-sky-900">
                        Job Approval
                      </span>
                    )}
                    <StatusBadge status={r.status} />
                    <PriorityBadge priority={r.priority} />
                    {outcome && (
                      <span className={`rounded-full border px-2 py-0.5 ${outcome.cls}`}>
                        {outcome.label}
                      </span>
                    )}
                    <span className="rounded-full border px-2 py-0.5 uppercase text-muted-foreground">
                      {r.assigned_user_name_snapshot ?? "Unassigned"}
                    </span>
                    {r.has_active_cancellation_request && (
                      <span className="rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-red-900">
                        Cancellation Requested
                      </span>
                    )}
                    {r.requires_approval && r.status === "Pending Approval" && (
                      <span className="rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-amber-900">
                        Waiting for Approval{r.approval_reason ? ` · ${r.approval_reason}` : ""}
                      </span>
                    )}
                    {(r.subscription_category_snapshot || r.stock_code_snapshot) && (
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 normal-case text-sky-900">
                        {r.subscription_category_snapshot ?? "Entitlement"}
                        {r.stock_code_snapshot ? ` · ${r.stock_code_snapshot}` : ""}
                        {r.entitlement_status_snapshot ? ` · ${r.entitlement_status_snapshot}` : ""}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {total > pageSize && !approvalsAll && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Page {page} / {totalPages} · {total} jobs
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="min-h-11 rounded-md border bg-background px-3 disabled:opacity-40 sm:min-h-9"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="min-h-11 rounded-md border bg-background px-3 disabled:opacity-40 sm:min-h-9"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
