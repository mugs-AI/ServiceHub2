// Subscriptions & Entitlements for one selected Customer.
//
// Read-only projection of the existing entitlement read model. It calls ONLY
// `GET /api/workspace/customer-subscriptions?customerCode=…` (authenticated,
// tenant-scoped, server-derived tenant). No entitlement calculation happens
// here — this component renders exactly what the Subscription Engine stored.

import { useEffect, useState } from "react";

import { getStoredToken } from "@/lib/qne/tokens";

export interface SubscriptionRow {
  customer_code: string;
  subscription_category: string | null;
  stock_code: string | null;
  stock_name: string | null;
  latest_document_no: string | null;
  latest_source_type: string | null;
  latest_document_date: string | null;
  renewal_cycle_value: number | null;
  renewal_cycle_unit: string | null;
  expiry_date: string | null;
  remaining_days: number | null;
  subscription_status: string | null;
  calculation_error: string | null;
  updated_at: string | null;
}

type PanelState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; rows: SubscriptionRow[] }
  | { kind: "error"; message: string };

function statusColor(s: string | null | undefined): string {
  switch ((s ?? "").toLowerCase()) {
    case "active":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "due soon":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "overdue":
      return "bg-rose-100 text-rose-800 border-rose-200";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatCycle(value: number | null, unit: string | null): string | null {
  if (!value || !unit) return null;
  return `${value} ${value === 1 ? unit : `${unit}s`}`;
}

export function CustomerSubscriptionsPanel({ customerCode }: { customerCode: string | null }) {
  const [state, setState] = useState<PanelState>({ kind: "idle" });

  useEffect(() => {
    // Switching customer A → B (or clearing) must immediately drop A's rows,
    // and a late response for A must never overwrite B.
    if (!customerCode) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const token = getStoredToken();
        const res = await fetch(
          `/api/workspace/customer-subscriptions?customerCode=${encodeURIComponent(customerCode)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setState({ kind: "error", message: body?.error ?? "Unable to load subscriptions." });
          return;
        }
        setState({ kind: "ok", rows: (body.subscriptions ?? []) as SubscriptionRow[] });
      } catch {
        if (!cancelled) setState({ kind: "error", message: "Unable to load subscriptions." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerCode]);

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Subscriptions &amp; Entitlements
      </div>

      {!customerCode && (
        <p className="mt-2 text-sm text-muted-foreground">
          Select a customer to view their subscriptions and entitlements.
        </p>
      )}
      {customerCode && state.kind === "loading" && (
        <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
      )}
      {customerCode && state.kind === "error" && (
        <p className="mt-2 text-sm text-destructive">{state.message}</p>
      )}
      {customerCode && state.kind === "ok" && state.rows.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          This customer has no Active, Due Soon or Overdue entitlement recorded.
        </p>
      )}

      {customerCode && state.kind === "ok" && state.rows.length > 0 && (
        <ul className="mt-3 space-y-3">
          {state.rows.map((r) => {
            const status = (r.subscription_status ?? "unknown").toLowerCase();
            const expiryDate = formatDate(r.expiry_date);
            const remainingText =
              r.remaining_days == null
                ? null
                : status === "overdue" || r.remaining_days < 0
                  ? `${Math.abs(r.remaining_days)} day${Math.abs(r.remaining_days) === 1 ? "" : "s"} overdue`
                  : `${r.remaining_days} day${r.remaining_days === 1 ? "" : "s"} remaining`;
            const latestText = r.latest_source_type
              ? `${r.latest_document_no ?? "—"} (${r.latest_source_type})`
              : (r.latest_document_no ?? "—");
            const docDate = formatDate(r.latest_document_date);
            const cycle = formatCycle(r.renewal_cycle_value, r.renewal_cycle_unit);

            return (
              <li
                key={`${r.subscription_category}-${r.latest_document_no ?? "none"}-${r.stock_code ?? "none"}`}
                className="rounded-lg border bg-background p-3 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="text-sm font-bold text-foreground">
                    {r.subscription_category ?? "Uncategorised"}
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${statusColor(
                      r.subscription_status,
                    )}`}
                  >
                    {r.subscription_status ?? "unknown"}
                  </span>
                </div>

                <div className="mt-2 text-lg font-bold text-primary sm:text-xl">
                  {expiryDate ? (
                    <span>
                      Expiry: {expiryDate}
                      {remainingText && (
                        <span className="ml-4 whitespace-nowrap">({remainingText})</span>
                      )}
                    </span>
                  ) : (
                    <span>Expiry: Not available</span>
                  )}
                </div>

                <div className="mt-2 text-xs text-muted-foreground sm:text-sm">
                  <span className="font-medium">Latest:</span>{" "}
                  <span title={latestText}>{latestText}</span>
                  {docDate && (
                    <>
                      <span className="mx-2">·</span>
                      <span className="font-medium">Dated:</span> {docDate}
                    </>
                  )}
                  {r.stock_code && (
                    <>
                      <span className="mx-2">·</span>
                      <span className="font-medium">Stock:</span>{" "}
                      <span
                        title={r.stock_name ? `${r.stock_code} · ${r.stock_name}` : r.stock_code}
                      >
                        {r.stock_code}
                        {r.stock_name ? ` · ${r.stock_name}` : ""}
                      </span>
                    </>
                  )}
                  {cycle && (
                    <>
                      <span className="mx-2">·</span>
                      <span className="font-medium">Renewal cycle:</span> {cycle}
                    </>
                  )}
                </div>

                {r.calculation_error && (
                  <p className="mt-2 text-xs text-destructive">{r.calculation_error}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
