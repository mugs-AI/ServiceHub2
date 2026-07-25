import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { getStoredToken } from "@/lib/qne/tokens";
import { useTabs } from "@/lib/tabs";
import { formatMYDateTime } from "@/lib/format-date";

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
  assigned_user_id: string | null;
  assigned_user_name_snapshot: string | null;
  created_at: string;
}

const QUEUE_TABS = [
  { key: "", label: "All Pending", emptyMsg: "No jobs currently require action." },
  { key: "draft", label: "Draft", emptyMsg: "No Draft jobs." },
  { key: "pending_approval", label: "Pending Approval", emptyMsg: "No Pending Approval jobs." },
  { key: "open_unassigned", label: "Open · Unassigned", emptyMsg: "No Open unassigned jobs." },
  { key: "assigned_not_started", label: "Assigned", emptyMsg: "No Assigned jobs." },
  { key: "waiting_customer", label: "Waiting Customer", emptyMsg: "No jobs waiting on customer." },
  { key: "waiting_vendor", label: "Waiting Vendor", emptyMsg: "No jobs waiting on vendor." },
] as const;

export const Route = createFileRoute("/jobs/pending")({
  validateSearch: (s: Record<string, unknown>) => ({
    scope: s.scope === "team" ? ("team" as const) : undefined,
  }),
  component: PendingQueuePage,
});

function authHeaders(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function PendingQueuePage() {
  const { scope } = Route.useSearch();
  const excludeMe = scope === "team";
  const [queueType, setQueueType] = useState<string>("");
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const navigate = useNavigate();
  const { openJobTab } = useTabs();

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const sp = new URLSearchParams();
      sp.set("page", String(page));
      sp.set("pageSize", String(pageSize));
      if (queueType) sp.set("queueType", queueType);
      if (q.trim()) sp.set("q", q.trim());
      if (priority) sp.set("priority", priority);
      if (excludeMe) sp.set("excludeMe", "1");
      const res = await fetch(`/api/workspace/jobs/pending?${sp.toString()}`, {
        headers: authHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Failed to load queue");
      setRows(body.jobs ?? []);
      setTotal(body.total ?? 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [queueType, q, priority, page]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const open = (r: QueueRow) => {
    openJobTab(r.id, r.job_number);
    navigate({ to: "/jobs/$jobId", params: { jobId: r.id } });
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Workspace
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">
            {excludeMe ? "Pending from My Team" : "Pending Queue"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {excludeMe
              ? "Office-wide pending jobs, excluding jobs assigned to you."
              : "Sorted by priority (High → Low), then oldest waiting first."}
          </p>
        </div>
        <Link
          to="/support"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Workspace
        </Link>
      </header>

      <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1">
        {QUEUE_TABS.map((t) => {
          const active = t.key === queueType;
          return (
            <button
              key={t.key || "all"}
              type="button"
              onClick={() => {
                setQueueType(t.key);
                setPage(1);
              }}
              className={`min-h-9 rounded-md px-3 text-xs font-semibold transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

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
      </div>

      {err && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </div>
      )}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && rows.length === 0 && !err && (
        <div className="rounded-lg border border-dashed bg-background/60 px-4 py-3 text-sm text-muted-foreground">
          {QUEUE_TABS.find((t) => t.key === queueType)?.emptyMsg ?? "No jobs."}
        </div>
      )}

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => open(r)}
                className="block w-full rounded-lg border bg-background p-3 text-left shadow-sm hover:bg-accent/40"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-primary">
                    {r.job_number}
                  </span>
                  <span className="text-[10px] uppercase text-muted-foreground">
                    {formatMYDateTime(r.created_at)}
                  </span>
                </div>
                <div className="mt-1 truncate text-sm font-semibold">{r.subject}</div>
                <div className="text-xs text-muted-foreground">
                  {r.customer_name_snapshot ?? r.customer_code_snapshot}
                </div>
                <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-semibold uppercase">
                  <span className="rounded-full border px-2 py-0.5">{r.status}</span>
                  <span className={`rounded-full border px-2 py-0.5 ${priorityTone(r.priority)}`}>
                    {r.priority}
                  </span>
                  <span className="rounded-full border px-2 py-0.5">
                    {r.assigned_user_name_snapshot ?? "Unassigned"}
                  </span>
                  {r.requires_approval && (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-800">
                      Approval
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {total > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Page {page} / {totalPages} · {total} jobs
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="min-h-9 rounded-md border bg-background px-3 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="min-h-9 rounded-md border bg-background px-3 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function priorityTone(p: string): string {
  if (p === "High") return "border-red-300 bg-red-50 text-red-800";
  if (p === "Medium") return "border-amber-300 bg-amber-50 text-amber-800";
  return "";
}
