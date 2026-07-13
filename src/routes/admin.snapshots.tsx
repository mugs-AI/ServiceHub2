import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { AdminOnly } from "@/components/qne/AdminOnly";
import { useSession } from "@/lib/qne/session-context";
import { getStoredToken } from "@/lib/qne/tokens";

export const Route = createFileRoute("/admin/snapshots")({
  component: () => (
    <AdminOnly>
      <AdminSnapshots />
    </AdminOnly>
  ),
});

type SnapshotKind = "customers" | "stock" | "contracts" | "subscriptions";
type HealthType = "Customers" | "Stock" | "Contract";
type HealthStatus = "Healthy" | "Warning" | "Error";

interface HealthRow {
  snapshot_type: HealthType;
  health_status: HealthStatus;
  last_successful_sync: string | null;
  last_attempt: string | null;
  records_total: number;
  records_inserted: number;
  records_updated: number;
  records_failed: number;
  stale_records: number;
  calculation_errors: number;
  warning_message: string | null;
  error_message: string | null;
  is_stale: boolean;
  threshold_hours: number;
}

interface HealthResponse {
  tenantCode: string;
  snapshots: HealthRow[];
}

interface SyncResult {
  tenantCode?: string;
  inserted?: number;
  updated?: number;
  skipped?: number;
  failed?: number;
  durationMs?: number;
  logId?: string;
  status?: string;
  errorMessage?: string | null;
  error?: string;
}

interface PreviewRow {
  [k: string]: unknown;
}

interface PreviewResponse {
  tenantCode: string;
  customers: { total: number; rows: PreviewRow[]; error: string | null };
  stock: { total: number; rows: PreviewRow[]; error: string | null };
  contracts: { total: number; rows: PreviewRow[]; error: string | null };
  mappings: { activeCount: number; error: string | null };
  error?: string;
}

interface DiagnosticsResponse {
  tenantCode: string;
  snapshotType: HealthType;
  thresholdHours: number;
  isStale: boolean;
  health: Record<string, unknown> | null;
  validation: {
    issues: Array<{ code: string; message: string; count: number }>;
    staleRecords: number;
    calculationErrors: number;
    recordsTotal: number;
  };
  recentLogs: Array<Record<string, unknown>>;
  error?: string;
}

const authFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const token = getStoredToken();
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
};

function statusBadge(status?: HealthStatus | string | null) {
  const s = (status ?? "Unknown") as string;
  const cls =
    s === "Healthy"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : s === "Warning"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : s === "Error"
      ? "bg-red-100 text-red-800 border-red-200"
      : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {s}
    </span>
  );
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function AdminSnapshots() {
  const { session } = useSession();
  const tenant = session?.tenantCode ?? "";

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [running, setRunning] = useState<SnapshotKind | "all" | null>(null);
  const [lastResults, setLastResults] = useState<Record<string, SyncResult>>({});
  const [diag, setDiag] = useState<DiagnosticsResponse | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);

  const reloadHealth = useCallback(async () => {
    setHealthErr(null);
    try {
      const res = await authFetch("/api/diagnostics/health");
      const json = (await res.json()) as HealthResponse & { error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setHealth(json);
    } catch (err) {
      setHealthErr(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const reloadPreview = useCallback(async () => {
    setPreviewErr(null);
    try {
      const res = await authFetch("/api/diagnostics/preview");
      const json = (await res.json()) as PreviewResponse;
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPreview(json);
    } catch (err) {
      setPreviewErr(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!tenant) return;
    void reloadHealth();
    void reloadPreview();
  }, [tenant, reloadHealth, reloadPreview]);

  const runSync = useCallback(
    async (kind: SnapshotKind) => {
      if (running) return;
      setRunning(kind);
      try {
        const res = await authFetch(`/api/sync/${kind}`, { method: "POST" });
        const json = (await res.json()) as SyncResult;
        setLastResults((r) => ({ ...r, [kind]: json }));
      } catch (err) {
        setLastResults((r) => ({
          ...r,
          [kind]: { error: err instanceof Error ? err.message : String(err) },
        }));
      } finally {
        setRunning(null);
        await reloadHealth();
        await reloadPreview();
      }
    },
    [running, reloadHealth, reloadPreview],
  );

  const runAll = useCallback(async () => {
    if (running) return;
    setRunning("all");
    for (const kind of ["customers", "stock", "subscriptions"] as SnapshotKind[]) {
      try {
        const res = await authFetch(`/api/sync/${kind}`, { method: "POST" });
        const json = (await res.json()) as SyncResult;
        setLastResults((r) => ({ ...r, [kind]: json }));
      } catch (err) {
        setLastResults((r) => ({
          ...r,
          [kind]: { error: err instanceof Error ? err.message : String(err) },
        }));
      }
    }
    setRunning(null);
    await reloadHealth();
    await reloadPreview();
  }, [running, reloadHealth, reloadPreview]);

  const openDiagnostics = useCallback(async (type: "customers" | "stock" | "contract") => {
    setDiagBusy(true);
    setDiag(null);
    try {
      const res = await authFetch(`/api/diagnostics/${type}`);
      const json = (await res.json()) as DiagnosticsResponse;
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setDiag(json);
    } catch (err) {
      setDiag({
        tenantCode: tenant,
        snapshotType: (type === "contract" ? "Contract" : type === "stock" ? "Stock" : "Customers") as HealthType,
        thresholdHours: 0,
        isStale: false,
        health: null,
        validation: { issues: [], staleRecords: 0, calculationErrors: 0, recordsTotal: 0 },
        recentLogs: [],
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDiagBusy(false);
    }
  }, [tenant]);

  const busy = running !== null;
  const mappingCount = preview?.mappings.activeCount ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Admin · Snapshots</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operational console for Administrators. Tenant is resolved server-side
          from the authenticated N3 session: <strong>{tenant || "—"}</strong>.
          All data on this page is scoped to your Client company only.
        </p>
        <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          ServiceHub administration is granted to the current N3 company
          Owner (<code>UserDto.isOwner === true</code>). All other authenticated
          users are Normal Users. Both this page and its APIs enforce the
          Owner check server-side.
        </p>
      </div>

      {/* Actions */}
      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Snapshot actions</h2>
          <div className="text-xs text-muted-foreground">
            {mappingCount} active renewal stock mapping{mappingCount === 1 ? "" : "s"} configured
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy}
            onClick={() => runSync("customers")}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {running === "customers" ? "Syncing…" : "Sync Customers"}
          </button>
          <button
            disabled={busy}
            onClick={() => runSync("stock")}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {running === "stock" ? "Syncing…" : "Sync Stock"}
          </button>
          <button
            disabled={busy}
            onClick={() => runSync("subscriptions")}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {running === "subscriptions"
              ? "Syncing…"
              : "Sync Transaction Details & Recalculate Subscriptions"}
          </button>
          <button
            disabled={busy}
            onClick={runAll}
            className="rounded-md border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            {running === "all" ? "Running all…" : "Run All"}
          </button>
        </div>
        {mappingCount === 0 && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No Renewal Stock Mapping is configured for this tenant. Contract
            recalculation will produce Unknown status for every customer until
            you add mappings.
          </p>
        )}
      </section>

      {/* Last sync results */}
      {Object.keys(lastResults).length > 0 && (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Last run results</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Inserted</th>
                  <th className="px-3 py-2 text-right">Updated</th>
                  <th className="px-3 py-2 text-right">Skipped</th>
                  <th className="px-3 py-2 text-right">Failed</th>
                  <th className="px-3 py-2 text-right">Duration</th>
                  <th className="px-3 py-2 text-left">Log ID</th>
                  <th className="px-3 py-2 text-left">Error</th>
                </tr>
              </thead>
              <tbody>
                {(["customers", "stock", "contracts", "subscriptions"] as SnapshotKind[]).map((k) => {
                  const r = lastResults[k];
                  if (!r) return null;
                  return (
                    <tr key={k} className="border-t">
                      <td className="px-3 py-2 font-medium">{k}</td>
                      <td className="px-3 py-2">{r.status ?? (r.error ? "failed" : "—")}</td>
                      <td className="px-3 py-2 text-right">{r.inserted ?? 0}</td>
                      <td className="px-3 py-2 text-right">{r.updated ?? 0}</td>
                      <td className="px-3 py-2 text-right">{r.skipped ?? 0}</td>
                      <td className="px-3 py-2 text-right">{r.failed ?? 0}</td>
                      <td className="px-3 py-2 text-right">
                        {r.durationMs != null ? `${r.durationMs} ms` : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.logId ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-destructive">
                        {r.error ?? r.errorMessage ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Health summary */}
      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Snapshot health</h2>
          <button
            onClick={reloadHealth}
            className="rounded-md border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent"
          >
            Refresh
          </button>
        </div>
        {healthErr && (
          <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {healthErr}
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          {(["Customers", "Stock", "Contract"] as HealthType[]).map((type) => {
            const row = health?.snapshots.find((s) => s.snapshot_type === type);
            const displayLabel = type === "Contract" ? "Subscriptions" : type;
            return (
              <div key={type} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{displayLabel}</h3>
                  {statusBadge(row?.health_status ?? "Unknown")}
                </div>
                <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between"><dt>Last success</dt><dd>{fmtDate(row?.last_successful_sync)}</dd></div>
                  <div className="flex justify-between"><dt>Last attempt</dt><dd>{fmtDate(row?.last_attempt)}</dd></div>
                  <div className="flex justify-between"><dt>Total records</dt><dd>{row?.records_total ?? 0}</dd></div>
                  <div className="flex justify-between"><dt>Inserted (last)</dt><dd>{row?.records_inserted ?? 0}</dd></div>
                  <div className="flex justify-between"><dt>Updated (last)</dt><dd>{row?.records_updated ?? 0}</dd></div>
                  <div className="flex justify-between"><dt>Failed (last)</dt><dd>{row?.records_failed ?? 0}</dd></div>
                  <div className="flex justify-between"><dt>Stale records</dt><dd>{row?.stale_records ?? 0}</dd></div>
                  <div className="flex justify-between"><dt>Calc errors</dt><dd>{row?.calculation_errors ?? 0}</dd></div>
                  <div className="flex justify-between"><dt>Freshness</dt><dd>{row?.threshold_hours ?? "—"}h · {row?.is_stale ? "stale" : "fresh"}</dd></div>
                </dl>
                {row?.warning_message && (
                  <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{row.warning_message}</p>
                )}
                {row?.error_message && (
                  <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-800">{row.error_message}</p>
                )}
                <div className="mt-3">
                  <button
                    onClick={() => openDiagnostics(type === "Contract" ? "contract" : type === "Stock" ? "stock" : "customers")}
                    className="rounded-md border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent"
                  >
                    Diagnostics
                  </button>
                </div>
              </div>
            );
          })}

        </div>
      </section>

      {/* Diagnostics panel */}
      {(diagBusy || diag) && (
        <section className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Diagnostics {diag ? `· ${diag.snapshotType}` : ""}
            </h2>
            <button
              onClick={() => setDiag(null)}
              className="rounded-md border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent"
            >
              Close
            </button>
          </div>
          {diagBusy && <p className="text-xs text-muted-foreground">Loading…</p>}
          {diag?.error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {diag.error}
            </p>
          )}
          {diag && !diag.error && (
            <div className="space-y-3 text-sm">
              <div className="grid gap-1 text-xs text-muted-foreground md:grid-cols-3">
                <div>Freshness threshold: <strong>{diag.thresholdHours}h</strong></div>
                <div>Currently stale: <strong>{String(diag.isStale)}</strong></div>
                <div>Total records: <strong>{diag.validation.recordsTotal}</strong></div>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">Validation issues</h3>
                {diag.validation.issues.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">No validation issues detected.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-xs">
                    {diag.validation.issues.map((i) => (
                      <li key={i.code} className="flex justify-between rounded border px-2 py-1">
                        <span>{i.message}</span>
                        <span className="font-mono">{i.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">Recent sync logs</h3>
                {diag.recentLogs.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">No sync runs recorded yet.</p>
                ) : (
                  <div className="mt-1 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1 text-left">Started</th>
                          <th className="px-2 py-1 text-left">Status</th>
                          <th className="px-2 py-1 text-right">Ins</th>
                          <th className="px-2 py-1 text-right">Upd</th>
                          <th className="px-2 py-1 text-right">Skip</th>
                          <th className="px-2 py-1 text-right">Fail</th>
                          <th className="px-2 py-1 text-right">Duration</th>
                          <th className="px-2 py-1 text-left">Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diag.recentLogs.map((log, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-2 py-1">{fmtDate(log.started_at as string)}</td>
                            <td className="px-2 py-1">{String(log.status ?? "—")}</td>
                            <td className="px-2 py-1 text-right">{Number(log.inserted_count ?? 0)}</td>
                            <td className="px-2 py-1 text-right">{Number(log.updated_count ?? 0)}</td>
                            <td className="px-2 py-1 text-right">{Number(log.skipped_count ?? 0)}</td>
                            <td className="px-2 py-1 text-right">{Number(log.failed_count ?? 0)}</td>
                            <td className="px-2 py-1 text-right">{log.duration_ms != null ? `${log.duration_ms} ms` : "—"}</td>
                            <td className="px-2 py-1 text-destructive">{(log.error_message as string) ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Preview */}
      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Safe preview (first 10 rows per snapshot, tenant-scoped)
          </h2>
          <button
            onClick={reloadPreview}
            className="rounded-md border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent"
          >
            Refresh
          </button>
        </div>
        {previewErr && (
          <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {previewErr}
          </p>
        )}

        <PreviewTable
          title="Customer snapshots"
          total={preview?.customers.total ?? 0}
          error={preview?.customers.error ?? null}
          rows={preview?.customers.rows ?? []}
          columns={[
            ["customer_code", "Code"],
            ["customer_name", "Name"],
            ["contact_person", "Contact"],
            ["phone", "Phone"],
            ["email", "Email"],
            ["n3_status", "Status"],
            ["tenant_code", "Tenant"],
          ]}
          emptyHint="No customer snapshots yet. Run Sync Customers."
        />

        <PreviewTable
          title="Stock snapshots"
          total={preview?.stock.total ?? 0}
          error={preview?.stock.error ?? null}
          rows={preview?.stock.rows ?? []}
          columns={[
            ["stock_code", "Code"],
            ["stock_name", "Name"],
            ["description", "Description"],
            ["is_active", "Active"],
            ["tenant_code", "Tenant"],
          ]}
          emptyHint="No stock snapshots yet. Run Sync Stock."
        />

        {/* Legacy per-customer Contract preview removed in Phase 1.0.3 —
            entitlements now live in Subscription snapshots below. */}

      </section>

      <TransactionDetailDiagnostics tenant={tenant} />
      <DocumentVerifier />
      <SubscriptionSnapshotsPreview tenant={tenant} />

    </div>
  );
}

function PreviewTable({
  title,
  total,
  rows,
  error,
  columns,
  emptyHint,
}: {
  title: string;
  total: number;
  rows: PreviewRow[];
  error: string | null;
  columns: Array<[string, string]>;
  emptyHint: string;
}) {
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground">Total: {total}</span>
      </div>
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          {emptyHint}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted uppercase text-muted-foreground">
              <tr>
                {columns.map(([key, label]) => (
                  <th key={key} className="px-2 py-1 text-left">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t">
                  {columns.map(([key]) => {
                    const v = row[key];
                    return (
                      <td key={key} className="px-2 py-1 font-mono">
                        {v === null || v === undefined
                          ? "—"
                          : typeof v === "boolean"
                          ? String(v)
                          : String(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface SubRunResponse {
  tenantCode: string;
  latest: {
    id: string;
    status: string;
    started_at: string;
    completed_at: string | null;
    duration_ms: number | null;
    inserted_count: number;
    updated_count: number;
    skipped_count: number;
    failed_count: number;
    error_message: string | null;
    details: Record<string, unknown> | null;
  } | null;
  totals: {
    salesInvoiceLines: number;
    deliveryOrderLines: number;
    renewalEvents: number;
    currentSubscriptions: number;
  };
  activeLocks: Array<{ snapshotType: string; acquiredAt: string }>;
  error?: string;
}

function TransactionDetailDiagnostics({ tenant }: { tenant: string }) {
  const [state, setState] = useState<SubRunResponse | { error: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const res = await authFetch("/api/diagnostics/subscription-run");
      const json = await res.json();
      if (!res.ok) setState({ error: json?.error ?? `HTTP ${res.status}` });
      else setState(json);
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (tenant) void reload();
  }, [tenant, reload]);

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Transaction Detail Diagnostics
        </h2>
        <button
          onClick={reload}
          disabled={busy}
          className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      {state && "error" in state && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {state.error}
        </p>
      )}
      {state && !("error" in state) && (
        <div className="space-y-3 text-xs">
          <div className="grid gap-2 md:grid-cols-4">
            <Stat label="Sales invoice lines" value={state.totals.salesInvoiceLines} />
            <Stat label="Delivery order lines" value={state.totals.deliveryOrderLines} />
            <Stat label="Renewal events" value={state.totals.renewalEvents} />
            <Stat label="Current subscriptions" value={state.totals.currentSubscriptions} />
          </div>
          {state.activeLocks.length > 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
              Active sync locks:{" "}
              {state.activeLocks
                .map((l) => `${l.snapshotType} (since ${fmtDate(l.acquiredAt)})`)
                .join(", ")}
            </p>
          )}
          {state.latest ? (
            <div className="rounded-md border p-3">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-foreground">
                  Latest subscription sync
                </span>
                <span>{state.latest.status}</span>
              </div>
              <div className="grid gap-1 md:grid-cols-3">
                <div>Started: {fmtDate(state.latest.started_at)}</div>
                <div>Completed: {fmtDate(state.latest.completed_at)}</div>
                <div>Duration: {state.latest.duration_ms ?? "—"} ms</div>
                <div>Inserted: {state.latest.inserted_count}</div>
                <div>Updated: {state.latest.updated_count}</div>
                <div>Skipped: {state.latest.skipped_count}</div>
                <div>Failed: {state.latest.failed_count}</div>
              </div>
              {state.latest.error_message && (
                <p className="mt-2 rounded bg-destructive/10 px-2 py-1 text-destructive">
                  {state.latest.error_message}
                </p>
              )}
              {state.latest.details && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-muted-foreground">
                    Per-run details
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-[11px]">
                    {JSON.stringify(state.latest.details, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">
              No subscription sync has been recorded yet.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-semibold">{value.toLocaleString()}</div>
    </div>
  );
}

interface VerifyDocResponse {
  tenantCode: string;
  documentNo: string;
  found: boolean;
  header: Record<string, unknown> | null;
  detailFetch: { operation: string | null; linesStored: number };
  lines: Array<Record<string, unknown>>;
  currentSubscriptions: Array<Record<string, unknown>>;
  renewalEvents: Array<Record<string, unknown>>;
  hint: string | null;
  error?: string;
}

function DocumentVerifier() {
  const [docNo, setDocNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyDocResponse | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docNo.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await authFetch(
        `/api/diagnostics/verify-document?docNo=${encodeURIComponent(docNo.trim())}`,
      );
      const json = (await res.json()) as VerifyDocResponse;
      if (!res.ok) setResult({ ...json, found: false, error: json.error ?? `HTTP ${res.status}` });
      else setResult(json);
    } catch (err) {
      setResult({
        tenantCode: "",
        documentNo: docNo,
        found: false,
        header: null,
        detailFetch: { operation: null, linesStored: 0 },
        lines: [],
        currentSubscriptions: [],
        renewalEvents: [],
        hint: null,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Document Verifier</h2>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          value={docNo}
          onChange={(e) => setDocNo(e.target.value)}
          placeholder="Enter Sales Invoice or Delivery Order No (e.g. MIS2606008)"
          className="min-h-10 min-w-72 flex-1 rounded-md border bg-background px-3 text-sm shadow-sm"
        />
        <button
          disabled={busy || !docNo.trim()}
          className="min-h-10 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Verifying…" : "Verify"}
        </button>
      </form>
      {result?.error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {result.error}
        </p>
      )}
      {result && !result.error && (
        <div className="mt-3 space-y-3 text-xs">
          {!result.found && result.hint && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">{result.hint}</p>
          )}
          {result.found && (
            <>
              <div className="rounded-md border p-3">
                <div className="font-semibold text-foreground">
                  {String(result.header?.document_no ?? "")} ·{" "}
                  {String(result.header?.source_type ?? "")}
                </div>
                <div className="mt-1 grid gap-1 text-muted-foreground md:grid-cols-3">
                  <div>Customer: {String(result.header?.customer_code ?? "—")} {String(result.header?.customer_name ?? "")}</div>
                  <div>Date: {fmtDate(result.header?.document_date as string)}</div>
                  <div>Status: {String(result.header?.document_status ?? "—")}</div>
                  <div>Detail op: {result.detailFetch.operation ?? "—"}</div>
                  <div>Lines stored: {result.detailFetch.linesStored}</div>
                </div>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted uppercase text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left">Line</th>
                      <th className="px-2 py-1 text-left">Stock</th>
                      <th className="px-2 py-1 text-left">Description</th>
                      <th className="px-2 py-1 text-right">Qty</th>
                      <th className="px-2 py-1 text-left">Void</th>
                      <th className="px-2 py-1 text-left">Mapping</th>
                      <th className="px-2 py-1 text-left">Category</th>
                      <th className="px-2 py-1 text-left">Cycle</th>
                      <th className="px-2 py-1 text-left">Event</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.lines.map((l, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1">{String(l.line_no ?? "")}</td>
                        <td className="px-2 py-1 font-mono">{String(l.stock_code ?? "")}</td>
                        <td className="px-2 py-1">{String(l.description ?? l.stock_name ?? "")}</td>
                        <td className="px-2 py-1 text-right">{String(l.quantity ?? "")}</td>
                        <td className="px-2 py-1">{String(l.is_void ?? false)}</td>
                        <td className="px-2 py-1">{String(l.mapping_result ?? "")}</td>
                        <td className="px-2 py-1">{String(l.subscription_category ?? "—")}</td>
                        <td className="px-2 py-1">{String(l.renewal_cycle ?? "—")}</td>
                        <td className="px-2 py-1">{l.renewal_event ? "yes" : "no"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.currentSubscriptions.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    Current subscriptions tied to this document ({result.currentSubscriptions.length})
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-[11px]">
                    {JSON.stringify(result.currentSubscriptions, null, 2)}
                  </pre>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

interface SubPreviewRow {
  customer_code: string;
  customer_name: string | null;
  subscription_category: string | null;
  stock_code: string | null;
  latest_document_no: string | null;
  latest_source_type: string | null;
  latest_document_date: string | null;
  expiry_date: string | null;
  remaining_days: number | null;
  subscription_status: string | null;
}

function SubscriptionSnapshotsPreview({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<SubPreviewRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await authFetch("/api/diagnostics/subscription-preview");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setRows(json.rows ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (tenant) void reload();
  }, [tenant, reload]);

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Subscription snapshots (first 25, tenant-scoped)
        </h2>
        <button
          onClick={reload}
          disabled={busy}
          className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      {err && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>
      )}
      {rows && rows.length === 0 && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          No subscription snapshots yet. Run Sync Transaction Details & Recalculate Subscriptions.
        </p>
      )}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left">Customer</th>
                <th className="px-2 py-1 text-left">Category</th>
                <th className="px-2 py-1 text-left">Stock</th>
                <th className="px-2 py-1 text-left">Latest Doc</th>
                <th className="px-2 py-1 text-left">Doc Date</th>
                <th className="px-2 py-1 text-left">Expiry</th>
                <th className="px-2 py-1 text-right">Remaining</th>
                <th className="px-2 py-1 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="px-2 py-1">
                    {r.customer_code}
                    {r.customer_name ? ` · ${r.customer_name}` : ""}
                  </td>
                  <td className="px-2 py-1">{r.subscription_category ?? "—"}</td>
                  <td className="px-2 py-1 font-mono">{r.stock_code ?? "—"}</td>
                  <td className="px-2 py-1">
                    {r.latest_document_no ?? "—"}
                    {r.latest_source_type ? ` (${r.latest_source_type})` : ""}
                  </td>
                  <td className="px-2 py-1">{fmtDate(r.latest_document_date)}</td>
                  <td className="px-2 py-1">{fmtDate(r.expiry_date)}</td>
                  <td className="px-2 py-1 text-right">{r.remaining_days ?? "—"}</td>
                  <td className="px-2 py-1">{r.subscription_status ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

