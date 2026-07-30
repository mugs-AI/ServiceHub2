// Shared UI for the dedicated entitlement business screens:
//   /customers/due-soon  and  /customers/overdue
//
// This is NOT the generic N3 Customers explorer. It reads only the
// ServiceHub entitlement read model through /api/workspace/entitlement-customers
// and renders grouped customer cards with entitlement sub-rows.

import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EntitlementBadge, Skeleton } from "@/components/qne/badges";
import { formatMY } from "@/lib/format-date";
import { getStoredToken } from "@/lib/qne/tokens";
import type { EntitlementRecord } from "@/lib/qne/entitlements/types";

export interface EntitlementGroupView {
  customer_code: string;
  customer_name: string | null;
  entitlement_count: number;
  earliest_expiry: string | null;
  latest_expiry: string | null;
  min_remaining_days: number | null;
  entitlements: EntitlementRecord[];
}

interface ApiResponse {
  status: "due_soon" | "overdue";
  statusLabel: string;
  sort: string;
  page: number;
  pageSize: number;
  totalPages: number;
  totals: { customers: number; entitlements: number };
  filteredTotals: { customers: number; entitlements: number };
  categories: string[];
  groups: EntitlementGroupView[];
  generatedAt: string;
}

function authHeaders(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function dueLabel(status: "due_soon" | "overdue", days: number | null): string {
  if (days == null) return "—";
  if (status === "overdue") return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  return `${Math.max(days, 0)} day${Math.max(days, 0) === 1 ? "" : "s"} until due`;
}

export function EntitlementCustomerScreen({
  status,
  title,
  subtitle,
}: {
  status: "due_soon" | "overdue";
  title: string;
  subtitle: string;
}) {
  const [q, setQ] = useState("");
  const [stock, setStock] = useState("");
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState(status === "overdue" ? "expiry_desc" : "expiry_asc");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced text filters so typing doesn't fire a request per keystroke.
  const [debounced, setDebounced] = useState({ q: "", stock: "" });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ q, stock }), 300);
    return () => clearTimeout(t);
  }, [q, stock]);

  useEffect(() => {
    setPage(1);
  }, [debounced.q, debounced.stock, category, from, to, sort, pageSize]);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams({
      status,
      sort,
      page: String(page),
      pageSize: String(pageSize),
    });
    if (debounced.q) params.set("q", debounced.q);
    if (debounced.stock) params.set("stock", debounced.stock);
    if (category) params.set("category", category);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    try {
      const res = await fetch(`/api/workspace/entitlement-customers?${params}`, {
        headers: authHeaders(),
        signal: ac.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setData(body as ApiResponse);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [status, sort, page, pageSize, debounced, category, from, to]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load, reloadKey]);

  const headline = useMemo(() => {
    const t = data?.filteredTotals;
    if (!t) return "";
    return `${t.customers} customer${t.customers === 1 ? "" : "s"} · ${t.entitlements} entitlement record${t.entitlements === 1 ? "" : "s"}`;
  }, [data]);

  const filtersActive =
    Boolean(debounced.q || debounced.stock || category || from || to);

  return (
    <div className="space-y-4">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Entitlements
          </p>
          <h1 className="mt-1 text-xl font-semibold text-foreground sm:text-2xl">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          <p className="mt-2 text-sm font-semibold text-foreground">
            {loading && !data ? <span className="text-muted-foreground">Loading…</span> : headline}
            {filtersActive && data && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                (of {data.totals.customers} customers · {data.totals.entitlements} records)
              </span>
            )}
          </p>
        </div>
        <Link
          to="/admin/dashboard"
          className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
      </header>

      <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1">
        <Link
          to="/customers/due-soon"
          className={`min-h-11 rounded-md px-3 py-2 text-xs font-semibold ${
            status === "due_soon"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          Due Soon
        </Link>
        <Link
          to="/customers/overdue"
          className={`min-h-11 rounded-md px-3 py-2 text-xs font-semibold ${
            status === "overdue"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          Overdue
        </Link>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-xs font-semibold text-muted-foreground">
          Customer Code / Name
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customer"
            className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm font-normal text-foreground"
          />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">
          Stock Code
          <input
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            placeholder="Search stock"
            className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm font-normal text-foreground"
          />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm font-normal text-foreground"
          >
            <option value="">All categories</option>
            {(data?.categories ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">
          Expiry From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm font-normal text-foreground"
          />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">
          Expiry To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm font-normal text-foreground"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-semibold text-muted-foreground">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border bg-background px-2 text-sm font-normal text-foreground"
            >
              <option value="expiry_asc">
                {status === "overdue" ? "Oldest overdue" : "Nearest expiry"}
              </option>
              <option value="expiry_desc">
                {status === "overdue" ? "Most recently expired" : "Furthest expiry"}
              </option>
              <option value="customer_name">Customer name</option>
              <option value="customer_code">Customer code</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">
            Page size
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="mt-1 min-h-11 w-full rounded-md border bg-background px-2 text-sm font-normal text-foreground"
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {err && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="min-w-0 break-words">{err}</span>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="min-h-11 rounded-md border border-destructive/40 px-3 text-xs font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}

      {!loading && !err && (data?.groups.length ?? 0) === 0 && (
        <div className="rounded-lg border border-dashed bg-background/60 p-6 text-center text-sm text-muted-foreground">
          No customers match this entitlement status.
        </div>
      )}

      {!loading && !err && (data?.groups.length ?? 0) > 0 && (
        <ul className="space-y-3">
          {data!.groups.map((g) => (
            <li key={g.customer_code} className="rounded-lg border bg-card shadow-sm">
              <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="break-words text-sm font-semibold text-foreground">
                    {g.customer_name ?? g.customer_code}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {g.customer_code} · {g.entitlement_count} matching entitlement
                    {g.entitlement_count === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to="/support"
                    search={{ customerCode: g.customer_code }}
                    className="min-h-11 rounded-md border px-3 py-2 text-xs font-semibold text-foreground hover:bg-accent"
                  >
                    Open Customer Workspace
                  </Link>
                  <Link
                    to="/jobs/new"
                    search={{ customerCode: g.customer_code }}
                    className="min-h-11 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    New Service Job
                  </Link>
                </div>
              </div>

              <ul className="divide-y">
                {g.entitlements.map((e) => (
                  <li
                    key={e.id}
                    className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
                          {e.subscription_category ?? "—"}
                        </span>
                        <EntitlementBadge status={e.subscription_status ?? ""} />
                        <span className="text-[11px] text-muted-foreground">
                          {dueLabel(status, e.remaining_days)}
                        </span>
                      </div>
                      <div className="break-words text-sm font-medium text-foreground">
                        {e.stock_code ?? "—"}
                        {e.stock_name ? ` — ${e.stock_name}` : ""}
                      </div>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground sm:grid-cols-4">
                        <div>
                          <dt className="inline">Doc No: </dt>
                          <dd className="inline font-medium text-foreground">
                            {e.latest_document_no ?? "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Doc Date: </dt>
                          <dd className="inline font-medium text-foreground">
                            {e.latest_document_date ? formatMY(e.latest_document_date) : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Start: </dt>
                          <dd className="inline font-medium text-foreground">
                            {e.contract_start_date ? formatMY(e.contract_start_date) : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Expiry: </dt>
                          <dd className="inline font-semibold text-foreground">
                            {e.expiry_date ? formatMY(e.expiry_date) : "—"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <Link
                      to="/jobs/new"
                      search={{ customerCode: g.customer_code, entitlementId: e.id }}
                      className="inline-flex min-h-11 items-center justify-center rounded-md border border-primary/40 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10"
                    >
                      New Service Job
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {!loading && data && data.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {data.page} of {data.totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={data.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="min-h-11 rounded-md border px-3 text-xs font-semibold disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={data.page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="min-h-11 rounded-md border px-3 text-xs font-semibold disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
