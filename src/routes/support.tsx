import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { getStoredToken } from "@/lib/qne/tokens";
import { useSession } from "@/lib/qne/session-context";
import { useTabs } from "@/lib/tabs";


export const Route = createFileRoute("/support")({
  component: SupportWorkspace,
});

/* ---------------- helpers ---------------- */

function authHeaders(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setMonth(from.getMonth() - 3);
  return { from: isoDate(from), to: isoDate(now) };
}

const RANGE_KEY = "sh2:workspaceRange:v1";

function loadRange(): { from: string; to: string } {
  if (typeof window === "undefined") return defaultRange();
  try {
    const raw = window.sessionStorage.getItem(RANGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p.from === "string" && typeof p.to === "string") {
        return { from: p.from, to: p.to };
      }
    }
  } catch { /* ignore */ }
  return defaultRange();
}

function saveRange(r: { from: string; to: string }) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(RANGE_KEY, JSON.stringify(r));
  } catch { /* ignore */ }
}

/* ---------------- types ---------------- */

interface CustomerRow {
  customer_code: string;
  customer_name: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
}

interface JobRow {
  id: string;
  job_number: string;
  customer_code_snapshot: string;
  customer_name_snapshot: string | null;
  subject: string;
  status: string;
  priority: string;
  source: string;
  assigned_user_id: string | null;
  assigned_user_name_snapshot: string | null;
  created_at: string;
}

interface Summary {
  total: number;
  active: number;
  pendingApproval: number;
  assigned: number;
  completed: number;
}

/* ---------------- page ---------------- */

function SupportWorkspace() {
  const { session, currentUser } = useSession();
  const name = currentUser?.displayName || session?.email || "there";

  const [range, setRange] = useState(loadRange);
  const [pendingRange, setPendingRange] = useState(range);

  const [customer, setCustomer] = useState<CustomerRow | null>(null);

  const [filters, setFilters] = useState({
    q: "",
    status: "",
    priority: "",
    technician: "",
  });

  const [page, setPage] = useState(1);
  const pageSize = 20;

  const applyRange = () => {
    setRange(pendingRange);
    saveRange(pendingRange);
    setPage(1);
  };
  const resetRange = () => {
    const r = defaultRange();
    setPendingRange(r);
    setRange(r);
    saveRange(r);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Workspace
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground sm:text-3xl">
          Welcome, {name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {session?.companyName || "—"} · Tenant {session?.tenantCode || "—"}
        </p>
      </header>

      <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Customer search
        </h2>
        <CustomerSearchBox
          selected={customer}
          onSelect={(c) => {
            setCustomer(c);
            setPage(1);
          }}
          onClear={() => {
            setCustomer(null);
            setPage(1);
          }}
        />
      </section>

      {customer && (
        <CustomerSummaryPanel
          customer={customer}
          range={range}
          onViewJobs={() => {
            // Scroll to list — filter is already applied via `customer`.
            const el = document.getElementById("workspace-jobs");
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      )}

      <section id="workspace-jobs" className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Service jobs
          </h2>
          <Link
            to="/jobs/new"
            search={
              customer ? { customerCode: customer.customer_code } : undefined
            }
            className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            + New Service Job
          </Link>
        </div>

        <DateRangeBar
          value={pendingRange}
          onChange={setPendingRange}
          onApply={applyRange}
          onReset={resetRange}
        />

        <FilterBar
          filters={filters}
          onChange={(f) => {
            setFilters(f);
            setPage(1);
          }}
        />

        <JobList
          customerCode={customer?.customer_code ?? null}
          filters={filters}
          range={range}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
        />
      </section>
    </div>
  );
}

/* ---------------- customer search ---------------- */

function CustomerSearchBox({
  selected,
  onSelect,
  onClear,
}: {
  selected: CustomerRow | null;
  onSelect: (c: CustomerRow) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const inflight = useRef<string | null>(null);

  const run = useCallback(async (term: string) => {
    const t = term.trim();
    if (t.length < 2) {
      setRows([]);
      return;
    }
    if (inflight.current === t) return;
    inflight.current = t;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/workspace/customers?q=${encodeURIComponent(t)}`,
        { headers: authHeaders() },
      );
      const body = await res.json().catch(() => ({}));
      if (inflight.current !== t) return;
      if (!res.ok) {
        setErr(body?.error ?? "Search failed.");
        setRows([]);
      } else {
        setRows(body.rows ?? []);
        setOpen(true);
      }
    } finally {
      if (inflight.current === t) inflight.current = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => run(q), 250);
    return () => clearTimeout(t);
  }, [q, run]);

  if (selected) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
        <div>
          <div className="font-semibold text-foreground">
            {selected.customer_name ?? "(no name)"}
          </div>
          <div className="text-xs text-muted-foreground">
            {selected.customer_code}
            {selected.contact_person ? ` · ${selected.contact_person}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onClear();
            setQ("");
            setRows([]);
          }}
          className="min-h-11 rounded-lg border px-3 text-xs font-semibold text-muted-foreground hover:bg-accent"
        >
          Change customer
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => rows.length > 0 && setOpen(true)}
        placeholder="Search Customer name, code, phone or email…"
        className="min-h-11 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:bg-blue-50"
      />
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
      {loading && <p className="mt-1 text-xs text-muted-foreground">Searching…</p>}
      {open && rows.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
          {rows.map((c) => (
            <li key={c.customer_code}>
              <button
                type="button"
                onClick={() => {
                  onSelect(c);
                  setOpen(false);
                  setQ("");
                  setRows([]);
                }}
                className="block w-full border-b px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <div className="font-medium text-foreground">
                  {c.customer_name ?? "(no name)"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {c.customer_code}
                  {c.contact_person ? ` · ${c.contact_person}` : ""}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- customer summary ---------------- */

function CustomerSummaryPanel({
  customer,
  range,
  onViewJobs,
}: {
  customer: CustomerRow;
  range: { from: string; to: string };
  onViewJobs: () => void;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const sp = new URLSearchParams({
      customerCode: customer.customer_code,
    });
    fetch(`/api/workspace/jobs/summary?${sp.toString()}`, {
      headers: authHeaders(),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) throw new Error(body?.error ?? "Failed");
        setSummary(body);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customer.customer_code]);

  const cards: { label: string; value: number | string; tone: string }[] = [
    { label: "Service Jobs", value: summary?.total ?? "—", tone: "text-foreground" },
    { label: "Active", value: summary?.active ?? "—", tone: "text-blue-700" },
    { label: "Pending Approval", value: summary?.pendingApproval ?? "—", tone: "text-amber-700" },
    { label: "Assigned", value: summary?.assigned ?? "—", tone: "text-purple-700" },
    { label: "Completed", value: summary?.completed ?? "—", tone: "text-emerald-700" },
  ];

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {customer.customer_name ?? customer.customer_code}
          </h2>
          <p className="text-xs text-muted-foreground">
            {customer.customer_code} · All-time counts (job list below honours the date range)
          </p>
        </div>
        <button
          type="button"
          onClick={onViewJobs}
          className="min-h-11 rounded-lg border bg-background px-3 text-sm font-semibold text-foreground hover:bg-accent"
        >
          View Service Jobs
        </button>
      </div>

      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}

      <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border bg-background p-3 shadow-sm"
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {c.label}
            </div>
            <div className={`mt-1 text-2xl font-bold ${c.tone}`}>
              {loading ? "…" : c.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- date range ---------------- */

function DateRangeBar({
  value,
  onChange,
  onApply,
  onReset,
}: {
  value: { from: string; to: string };
  onChange: (v: { from: string; to: string }) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  const inputCls =
    "min-h-11 rounded-lg border-[1.5px] border-gray-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:bg-blue-50";
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
        From
        <input
          type="date"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          className={inputCls}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
        To
        <input
          type="date"
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          className={inputCls}
        />
      </label>
      <button
        type="button"
        onClick={onApply}
        className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
      >
        Apply
      </button>
      <button
        type="button"
        onClick={onReset}
        className="min-h-11 rounded-lg border bg-background px-3 text-sm font-medium text-foreground hover:bg-accent"
      >
        Reset (Latest 3 Months)
      </button>
    </div>
  );
}

/* ---------------- filter bar ---------------- */

const STATUS_OPTS = ["", "Draft", "Pending Approval", "Assigned", "In Progress", "Completed"];
const PRIORITY_OPTS = ["", "High", "Medium", "Low"];

function FilterBar({
  filters,
  onChange,
}: {
  filters: { q: string; status: string; priority: string; technician: string };
  onChange: (f: typeof filters) => void;
}) {
  const inputCls =
    "min-h-11 rounded-lg border-[1.5px] border-gray-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:bg-blue-50";
  return (
    <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <input
        value={filters.q}
        onChange={(e) => onChange({ ...filters, q: e.target.value })}
        placeholder="Job number, subject or customer"
        className={inputCls}
      />
      <select
        value={filters.status}
        onChange={(e) => onChange({ ...filters, status: e.target.value })}
        className={inputCls}
      >
        {STATUS_OPTS.map((s) => (
          <option key={s} value={s}>
            {s || "All statuses"}
          </option>
        ))}
      </select>
      <select
        value={filters.priority}
        onChange={(e) => onChange({ ...filters, priority: e.target.value })}
        className={inputCls}
      >
        {PRIORITY_OPTS.map((p) => (
          <option key={p} value={p}>
            {p || "All priorities"}
          </option>
        ))}
      </select>
      <input
        value={filters.technician}
        onChange={(e) => onChange({ ...filters, technician: e.target.value })}
        placeholder="Technician user id (or __unassigned__)"
        className={inputCls}
      />
    </div>
  );
}

/* ---------------- job list ---------------- */

function JobList({
  customerCode,
  filters,
  range,
  page,
  pageSize,
  onPageChange,
}: {
  customerCode: string | null;
  filters: { q: string; status: string; priority: string; technician: string };
  range: { from: string; to: string };
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}) {
  const [rows, setRows] = useState<JobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const navigate = useNavigate();
  const { openJobTab } = useTabs();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const sp = new URLSearchParams();
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    sp.set("from", `${range.from}T00:00:00Z`);
    sp.set("to", `${range.to}T23:59:59Z`);
    if (customerCode) sp.set("customerCode", customerCode);
    if (filters.q.trim()) sp.set("q", filters.q.trim());
    if (filters.status) sp.set("status", filters.status);
    if (filters.priority) sp.set("priority", filters.priority);
    if (filters.technician.trim()) sp.set("technician", filters.technician.trim());

    fetch(`/api/workspace/jobs?${sp.toString()}`, { headers: authHeaders() })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) throw new Error(body?.error ?? "Failed to load jobs");
        setRows(body.jobs ?? []);
        setTotal(body.total ?? 0);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerCode, filters.q, filters.status, filters.priority, filters.technician, range.from, range.to, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const open = (job: JobRow) => {
    openJobTab(job.id, job.job_number);
    navigate({ to: "/jobs/$jobId", params: { jobId: job.id } });
  };

  return (
    <div className="space-y-3">
      {err && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </div>
      )}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && rows.length === 0 && (
        <div className="rounded-lg border border-dashed bg-background/60 p-6 text-center text-sm text-muted-foreground">
          No service jobs match these filters.
        </div>
      )}
      {rows.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Job No</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">Subject</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Priority</th>
                  <th className="px-3 py-2 text-left">Technician</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((j) => (
                  <tr
                    key={j.id}
                    onClick={() => open(j)}
                    className="cursor-pointer border-t hover:bg-accent/40"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-primary">
                      {j.job_number}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(j.created_at).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{j.customer_name_snapshot ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{j.customer_code_snapshot}</div>
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-2" title={j.subject}>{j.subject}</td>
                    <td className="px-3 py-2 text-xs">{j.status}</td>
                    <td className="px-3 py-2 text-xs">{j.priority}</td>
                    <td className="px-3 py-2 text-xs">
                      {j.assigned_user_name_snapshot ?? (
                        <span className="text-muted-foreground">Unassigned</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {rows.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => open(j)}
                  className="block w-full rounded-lg border bg-background p-3 text-left shadow-sm hover:bg-accent/40"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-primary">
                      {j.job_number}
                    </span>
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {new Date(j.created_at).toLocaleDateString("en-GB")}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-sm font-semibold">{j.subject}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {j.customer_name_snapshot ?? j.customer_code_snapshot}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-semibold uppercase">
                    <span className="rounded-full border px-2 py-0.5">{j.status}</span>
                    <span className="rounded-full border px-2 py-0.5">{j.priority}</span>
                    <span className="rounded-full border px-2 py-0.5">
                      {j.assigned_user_name_snapshot ?? "Unassigned"}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={onPageChange}
          />
        </>
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        Showing {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="min-h-9 rounded-md border bg-background px-3 disabled:opacity-40"
        >
          Prev
        </button>
        <span className="px-2">
          Page {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="min-h-9 rounded-md border bg-background px-3 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
