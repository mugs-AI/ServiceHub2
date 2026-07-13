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
            return (
              <div key={type} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{type}</h3>
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

        <PreviewTable
          title="Contract snapshots"
          total={preview?.contracts.total ?? 0}
          error={preview?.contracts.error ?? null}
          rows={preview?.contracts.rows ?? []}
          columns={[
            ["customer_code", "Customer"],
            ["latest_document_no", "Doc No"],
            ["latest_document_type", "Doc Type"],
            ["latest_document_date", "Doc Date"],
            ["renewal_stock_code", "Renewal Stock"],
            ["contract_days", "Days"],
            ["contract_start_date", "Start"],
            ["expiry_date", "Expiry"],
            ["remaining_days", "Remaining"],
            ["contract_status", "Status"],
            ["tenant_code", "Tenant"],
          ]}
          emptyHint={
            mappingCount === 0
              ? "No renewal stock mappings — every contract will be Unknown until mappings exist."
              : "No contract snapshots yet. Run Recalculate Contracts."
          }
        />
      </section>
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
