import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { getStoredToken } from "@/lib/qne/tokens";
import { formatMY } from "@/lib/format-date";
import { EntitlementBadge, Skeleton } from "@/components/qne/badges";

type StatusKey = "active" | "due_soon" | "overdue";

export const Route = createFileRoute("/customers/entitlements")({
  validateSearch: (s: Record<string, unknown>): { status: StatusKey } => {
    const raw = typeof s.status === "string" ? s.status : "due_soon";
    const status: StatusKey =
      raw === "active" || raw === "overdue" || raw === "due_soon"
        ? (raw as StatusKey)
        : "due_soon";
    return { status };
  },
  component: EntitlementCustomersPage,
});

interface Row {
  customer_code: string;
  customer_name: string | null;
  entitlements: number;
  earliestExpiry: string | null;
  minRemainingDays: number | null;
  samples: string[];
}

function authHeaders(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function EntitlementCustomersPage() {
  const { status } = Route.useSearch();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/workspace/entitlement-customers?status=${status}`, {
      headers: authHeaders(),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
        setRows(body.rows ?? []);
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
  }, [status]);

  const title =
    status === "overdue"
      ? "Overdue Customers"
      : status === "active"
        ? "Active Entitlements — Customers"
        : "Due Soon Customers";
  const helper =
    status === "overdue"
      ? "Customers with at least one expired entitlement."
      : status === "active"
        ? "Customers with at least one active entitlement."
        : "Customers whose earliest entitlement expires soon.";

  const openCustomer = (r: Row) => {
    // Land on Workspace with the customer pre-selected — the Workspace
    // search box will match by code.
    navigate({ to: "/support" });
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(
        "input[placeholder^='Search Customer']",
      );
      if (el) {
        el.value = r.customer_code;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.focus();
      }
    }, 100);
  };

  return (
    <div className="space-y-4">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 sm:flex sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Entitlements
          </p>
          <h1 className="mt-1 truncate text-2xl font-semibold text-foreground">
            {title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{helper}</p>
        </div>
        <Link
          to="/admin/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
      </header>

      <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1">
        {(["due_soon", "overdue", "active"] as const).map((s) => (
          <Link
            key={s}
            to="/customers/entitlements"
            search={{ status: s }}
            className={`min-h-9 rounded-md px-3 py-1.5 text-xs font-semibold ${
              s === status
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {s === "due_soon" ? "Due Soon" : s === "overdue" ? "Overdue" : "Active"}
          </Link>
        ))}
      </div>

      {err && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}

      {!loading && !err && rows.length === 0 && (
        <div className="rounded-lg border border-dashed bg-background/60 p-6 text-center text-sm text-muted-foreground">
          No customers match this entitlement status.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.customer_code}>
              <button
                type="button"
                onClick={() => openCustomer(r)}
                className="block w-full rounded-lg border bg-background p-3 text-left shadow-sm hover:bg-accent/40"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {r.customer_name ?? r.customer_code}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.customer_code} · {r.entitlements} entitlement
                      {r.entitlements === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <EntitlementBadge
                      status={status === "due_soon" ? "Due Soon" : status === "overdue" ? "Overdue" : "Active"}
                    />
                    <span className="text-muted-foreground">
                      Earliest expiry:{" "}
                      <span className="font-semibold text-foreground">
                        {r.earliestExpiry ? formatMY(r.earliestExpiry) : "—"}
                      </span>
                    </span>
                  </div>
                </div>
                {r.samples.length > 0 && (
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {r.samples.join(" · ")}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
