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

interface ActiveLock {
  tenantCode: string;
  snapshotType: "customer" | "stock" | "contract";
  acquiredAt: string | null;
  heartbeatAt: string | null;
  expiresAt: string | null;
  stage: string | null;
  isStale: boolean;
  ageSeconds: number | null;
}

interface HealthResponse {
  tenantCode: string;
  snapshots: HealthRow[];
  activeLocks?: ActiveLock[];
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
  const [running, setRunning] = useState<SnapshotKind | "all" | "full" | null>(null);
  const [lastResults, setLastResults] = useState<Record<string, SyncResult>>({});
  const [diag, setDiag] = useState<DiagnosticsResponse | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);

  const [recoverBusy, setRecoverBusy] = useState(false);
  const [recoverMsg, setRecoverMsg] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [orch, setOrch] = useState<Record<string, unknown> | null>(null);
  const [identity, setIdentity] = useState<Record<string, unknown> | null>(null);
  const [identityBusy, setIdentityBusy] = useState(false);

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

  // Poll health while a sync is running so activeLocks[].stage + heartbeat
  // stays live for the "Sync in progress" panel.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      void reloadHealth();
    }, 3000);
    return () => clearInterval(id);
  }, [running, reloadHealth]);


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

  const runFullSync = useCallback(async () => {
    if (running) return;
    setRunning("full");
    setOrch(null);
    try {
      const res = await authFetch("/api/sync/full", { method: "POST" });
      const json = (await res.json()) as { orchestration?: Record<string, unknown>; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setOrch(json.orchestration ?? null);
    } catch (err) {
      setOrch({ overall_status: "failed", safe_error_summary: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(null);
      await reloadHealth();
      await reloadPreview();
    }
  }, [running, reloadHealth, reloadPreview]);

  const loadIdentity = useCallback(async () => {
    setIdentityBusy(true);
    try {
      const res = await authFetch("/api/diagnostics/identity");
      const json = (await res.json()) as Record<string, unknown> & { error?: string };
      if (!res.ok || json.error) throw new Error((json.error as string) ?? `HTTP ${res.status}`);
      setIdentity(json);
    } catch (err) {
      setIdentity({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setIdentityBusy(false);
    }
  }, []);

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
  const activeLocks = health?.activeLocks ?? [];
  const staleLocks = activeLocks.filter((l) => l.isStale);
  const liveLocks = activeLocks.filter((l) => !l.isStale);

  const recoverStale = useCallback(
    async (snapshotType: ActiveLock["snapshotType"]) => {
      setRecoverBusy(true);
      setRecoverMsg(null);
      try {
        const res = await authFetch("/api/sync/recover-stale", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshotType }),
        });
        const json = (await res.json()) as { recovered?: boolean; error?: string };
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setRecoverMsg(
          json.recovered
            ? "Stale sync lock released. You can start a new run now."
            : "Nothing to recover — no stale lock found.",
        );
      } catch (err) {
        setRecoverMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setRecoverBusy(false);
        await reloadHealth();
      }
    },
    [reloadHealth],
  );

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

      {(staleLocks.length > 0 || liveLocks.length > 0) && (
        <section className="rounded-lg border p-4 space-y-3"
          style={{ borderColor: staleLocks.length > 0 ? "rgb(252 165 165)" : "rgb(191 219 254)", background: staleLocks.length > 0 ? "rgb(254 242 242)" : "rgb(239 246 255)" }}
        >
          {staleLocks.map((l) => (
            <div key={`stale-${l.snapshotType}`} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-red-900">
                <strong>A previous synchronization stopped unexpectedly.</strong>{" "}
                <span className="text-red-800">
                  Type: <code>{l.snapshotType}</code> · last heartbeat{" "}
                  {l.ageSeconds != null ? `${l.ageSeconds}s ago` : "unknown"} ·
                  stage: {l.stage ?? "unknown"}
                </span>
              </div>
              <button
                disabled={recoverBusy}
                onClick={() => recoverStale(l.snapshotType)}
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {recoverBusy ? "Recovering…" : "Recover Stale Sync"}
              </button>
            </div>
          ))}
          {liveLocks.map((l) => (
            <div key={`live-${l.snapshotType}`} className="text-sm text-blue-900">
              Sync in progress · <code>{l.snapshotType}</code> · stage:{" "}
              <strong>{l.stage ?? "starting"}</strong>
              {l.ageSeconds != null ? ` · last heartbeat ${l.ageSeconds}s ago` : ""}
            </div>
          ))}
          {recoverMsg && (
            <p className="text-xs text-foreground">{recoverMsg}</p>
          )}
        </section>
      )}


      {/* Unified Sync */}
      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Sync N3 Data</h2>
          <div className="text-xs text-muted-foreground">
            {mappingCount} active renewal stock mapping{mappingCount === 1 ? "" : "s"} configured
          </div>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Runs the full pipeline in order: Customers → Stock → Subscriptions
          (headers, details, events, rebuild) → Refresh display Codes and Names.
          Safe to re-run at any time.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy}
            onClick={runFullSync}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {running === "full" ? "Running full sync…" : "Sync N3 Data & Recalculate"}
          </button>
        </div>
        {mappingCount === 0 && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No Renewal Stock Mapping is configured for this tenant. Subscription
            recalculation will produce Unknown status for every customer until
            you add mappings.
          </p>
        )}
        {orch && (
          <div className="mt-3 rounded-md border bg-muted/40 p-3 text-xs">
            <div className="font-medium">
              Last run: {String(orch.overall_status ?? "—")}
              {typeof orch.total_duration_ms === "number"
                ? ` · ${Math.round(orch.total_duration_ms / 1000)}s`
                : ""}
            </div>
            {orch.safe_error_summary ? (
              <div className="mt-1 text-red-700">Error: {String(orch.safe_error_summary)}</div>
            ) : null}
          </div>
        )}
        <details className="mt-4" open={showAdvanced} onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            Advanced — run stages individually
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() => runSync("customers")}
              className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {running === "customers" ? "Syncing…" : "Sync Customers only"}
            </button>
            <button
              disabled={busy}
              onClick={() => runSync("stock")}
              className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {running === "stock" ? "Syncing…" : "Sync Stock only"}
            </button>
            <button
              disabled={busy}
              onClick={() => runSync("subscriptions")}
              className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {running === "subscriptions" ? "Syncing…" : "Sync Subscriptions only"}
            </button>
            <button
              disabled={busy}
              onClick={runAll}
              className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {running === "all" ? "Running all…" : "Run All (legacy)"}
            </button>
          </div>
        </details>
      </section>

      {/* Identity Verification */}
      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Identity Verification</h2>
          <button
            disabled={identityBusy}
            onClick={loadIdentity}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            {identityBusy ? "Loading…" : identity ? "Refresh" : "Load"}
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Shows N3 Identity (n3_customer_id / n3_stock_id) coverage across your
          snapshot tables plus the most recent identity backfill and merge
          activity. Rows without an N3 ID are legacy and will be linked on
          the next sync when the matching N3 record is seen.
        </p>
        {identity && !("error" in identity) && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["customers", "stock", "renewal_mappings"] as const).map((k) => {
                const c = (identity.coverage as Record<string, { total: number; with_n3_id: number; without_n3_id: number }>)[k];
                if (!c) return null;
                const pct = c.total > 0 ? Math.round((c.with_n3_id / c.total) * 100) : 0;
                return (
                  <div key={k} className="rounded-md border p-2 text-xs">
                    <div className="font-medium capitalize">{k.replace("_", " ")}</div>
                    <div className="text-muted-foreground">
                      {c.with_n3_id}/{c.total} linked ({pct}%)
                    </div>
                    {c.without_n3_id > 0 && (
                      <div className="text-amber-700">{c.without_n3_id} legacy</div>
                    )}
                  </div>
                );
              })}
            </div>
            {Array.isArray(identity.recentBackfill) && identity.recentBackfill.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium">Recent identity events</div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {(identity.recentBackfill as Array<Record<string, unknown>>).slice(0, 10).map((b, i) => (
                    <li key={i} className="font-mono">
                      {String(b.entity_type)} · {String(b.match_method)} · {String(b.migration_status)}
                      {b.natural_key ? ` · ${String(b.natural_key)}` : ""}
                      {b.notes ? ` — ${String(b.notes).slice(0, 100)}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {identity && "error" in identity && (
          <p className="text-xs text-red-700">Error: {String(identity.error)}</p>
        )}
      </section>

      {/* Live sync progress — visible while any sync is running */}
      {busy && (
        <section className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            Sync in progress{running === "all" ? " (Run All)" : ""}
          </h2>
          {liveLocks.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Starting… waiting for the first heartbeat.
            </p>
          ) : (
            <ul className="space-y-1 text-xs">
              {liveLocks.map((l) => {
                const hb = l.heartbeatAt ? new Date(l.heartbeatAt) : null;
                const ageSec = hb ? Math.max(0, Math.round((Date.now() - hb.getTime()) / 1000)) : null;
                return (
                  <li key={`${l.snapshotType}`} className="flex flex-wrap items-center gap-x-3">
                    <span className="font-medium capitalize">{l.snapshotType}</span>
                    <span className="text-muted-foreground">
                      stage: <span className="font-mono">{l.stage ?? "…"}</span>
                    </span>
                    {ageSec != null && (
                      <span className="text-muted-foreground">
                        heartbeat {ageSec}s ago
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {running === "all" && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Order: Customers → Stock → Subscriptions. The Subscriptions stage
              runs the longest.
            </p>
          )}
        </section>
      )}


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
  perSource?: {
    salesInvoice: LineBreakdown;
    deliveryOrder: LineBreakdown;
  };
  reconciliationNote?: string;
  activeLocks: Array<{ snapshotType: string; acquiredAt: string }>;
  error?: string;
}

interface LineBreakdown {
  total: number;
  stock: number;
  description: number;
  serial_or_reference: number;
  child_detail: number;
  unknown: number;
  voided: number;
  linesWithoutStock: number;
  stockRenewalMapped: number;
  stockAdHocMapped: number;
  stockUnmapped: number;
  duplicateRowsDetected: number;
  distinctDocuments: number;
}

// Per-run detail counters emitted by subscription-sync.server.ts. Mirrors the
// SourceMetrics shape server-side (Phase 1.0.4).
interface RunSourceDetails {
  headersScanned?: number;
  detailRequestsSucceeded?: number;
  detailRequestsFailed?: number;
  detailLinesStored?: number;
  mappedRenewalLines?: number;
  renewalEventsInserted?: number;
  renewalEventsSkipped?: number;
  renewalEventsSkippedVoided?: number;
  renewalEventsSkippedMissingCustomer?: number;
  renewalEventsSkippedInvalidDate?: number;
  voidedDocuments?: number;
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
          {state.reconciliationNote && (
            <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-900">
              {state.reconciliationNote}
            </p>
          )}
          {state.perSource && (
            <div className="grid gap-3 md:grid-cols-2">
              <BreakdownCard
                title="Sales Invoices"
                b={state.perSource.salesInvoice}
                run={runSourceDetails(state.latest?.details, "salesInvoice")}
              />
              <BreakdownCard
                title="Delivery Orders"
                b={state.perSource.deliveryOrder}
                run={runSourceDetails(state.latest?.details, "deliveryOrder")}
              />
            </div>
          )}

          {renderSubscriptionSourceSplit(state.latest?.details)}
          {renderReconciliationSummary(state.latest?.details)}



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

function runSourceDetails(
  details: Record<string, unknown> | null | undefined,
  key: "salesInvoice" | "deliveryOrder",
): RunSourceDetails | null {
  if (!details) return null;
  const v = details[key];
  return v && typeof v === "object" ? (v as RunSourceDetails) : null;
}

interface ReconciliationSummary {
  enabled?: boolean;
  checked?: number;
  confirmedDeleted?: number;
  confirmedLineRemoved?: number;
  transient?: number;
  unknownEnvelope?: number;
  skippedUnsafe?: boolean;
  skippedReason?: string | null;
  inventoryTotal?: number | null;
  uniqueHeadersSeen?: number;
  pagesFetched?: number;
  candidateDocuments?: number;
}

function renderReconciliationSummary(
  details: Record<string, unknown> | null | undefined,
) {
  if (!details) return null;
  const r = details.reconciliation as
    | {
        salesInvoice?: ReconciliationSummary;
        deliveryOrder?: ReconciliationSummary;
        totals?: {
          checked?: number;
          confirmedDeleted?: number;
          confirmedLineRemoved?: number;
          transient?: number;
          unknownEnvelope?: number;
        };
      }
    | undefined;
  if (!r) return null;
  const si = r.salesInvoice ?? {};
  const dord = r.deliveryOrder ?? {};
  const t = r.totals ?? {};
  const row = (label: string, s: ReconciliationSummary) => (
    <div>
      <div className="mb-1 font-medium text-foreground">{label}</div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-muted-foreground">
        <span>Inventory total</span><span>{s.inventoryTotal ?? "—"}</span>
        <span>Unique headers seen</span><span>{s.uniqueHeadersSeen ?? 0}</span>
        <span>Pages fetched</span><span>{s.pagesFetched ?? 0}</span>
        <span>Candidates checked</span><span>{s.checked ?? 0} / {s.candidateDocuments ?? 0}</span>
        <span>Confirmed deleted</span><span>{s.confirmedDeleted ?? 0}</span>
        <span>Lines removed</span><span>{s.confirmedLineRemoved ?? 0}</span>
        <span>Transient</span><span>{s.transient ?? 0}</span>
        <span>Unknown</span><span>{s.unknownEnvelope ?? 0}</span>
        <span>Status</span>
        <span>
          {s.enabled === false
            ? "disabled"
            : s.skippedUnsafe
              ? `skipped (${s.skippedReason ?? "unsafe scan"})`
              : "ok"}
        </span>
      </div>
    </div>
  );
  return (
    <div className="rounded-md border bg-background p-3">
      <h4 className="mb-2 text-xs font-semibold text-foreground">
        Reconciliation — deleted documents & removed lines (this run)
      </h4>
      <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground md:grid-cols-5">
        <div><span className="font-medium text-foreground">Checked:</span> {t.checked ?? 0}</div>
        <div><span className="font-medium text-foreground">Deleted:</span> {t.confirmedDeleted ?? 0}</div>
        <div><span className="font-medium text-foreground">Lines removed:</span> {t.confirmedLineRemoved ?? 0}</div>
        <div><span className="font-medium text-foreground">Transient:</span> {t.transient ?? 0}</div>
        <div><span className="font-medium text-foreground">Unknown:</span> {t.unknownEnvelope ?? 0}</div>
      </div>
      <div className="grid gap-3 text-[11px] md:grid-cols-2">
        {row("Sales Invoice", si)}
        {row("Delivery Order", dord)}
      </div>
    </div>
  );
}


function renderSubscriptionSourceSplit(
  details: Record<string, unknown> | null | undefined,
) {
  if (!details) return null;
  const bySource = details.subscriptionSnapshotsBySource as
    | {
        invoice?: { inserted?: number; updated?: number; unchanged?: number; total?: number };
        delivery_order?: {
          inserted?: number;
          updated?: number;
          unchanged?: number;
          total?: number;
        };
      }
    | undefined;
  if (!bySource) return null;
  const inv = bySource.invoice ?? {};
  const dord = bySource.delivery_order ?? {};
  return (
    <div className="rounded-md border bg-background p-3">
      <h4 className="mb-2 text-xs font-semibold text-foreground">
        Current subscriptions — winning source (this run)
      </h4>
      <div className="grid gap-3 text-[11px] md:grid-cols-2">
        <div>
          <div className="mb-1 font-medium text-foreground">Sales Invoice</div>
          <dl className="space-y-1 font-mono">
            <div className="flex justify-between"><dt>Total</dt><dd>{inv.total ?? 0}</dd></div>
            <div className="flex justify-between"><dt>Inserted</dt><dd>{inv.inserted ?? 0}</dd></div>
            <div className="flex justify-between"><dt>Updated</dt><dd>{inv.updated ?? 0}</dd></div>
            <div className="flex justify-between text-muted-foreground"><dt>Unchanged</dt><dd>{inv.unchanged ?? 0}</dd></div>
          </dl>
        </div>
        <div>
          <div className="mb-1 font-medium text-foreground">Delivery Order</div>
          <dl className="space-y-1 font-mono">
            <div className="flex justify-between"><dt>Total</dt><dd>{dord.total ?? 0}</dd></div>
            <div className="flex justify-between"><dt>Inserted</dt><dd>{dord.inserted ?? 0}</dd></div>
            <div className="flex justify-between"><dt>Updated</dt><dd>{dord.updated ?? 0}</dd></div>
            <div className="flex justify-between text-muted-foreground"><dt>Unchanged</dt><dd>{dord.unchanged ?? 0}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  );
}

function BreakdownCard({
  title,
  b,
  run,
}: {
  title: string;
  b: LineBreakdown;
  run?: RunSourceDetails | null;
}) {
  const Row = ({ k, v, muted }: { k: string; v: number | string; muted?: boolean }) => (
    <div className={`flex justify-between ${muted ? "text-muted-foreground" : ""}`}>
      <dt>{k}</dt>
      <dd className="font-mono">{typeof v === "number" ? v.toLocaleString() : v}</dd>
    </div>
  );
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-foreground">{title}</h4>
        <span className="text-[10px] text-muted-foreground">
          {b.distinctDocuments.toLocaleString()} documents
        </span>
      </div>
      <dl className="space-y-1 text-[11px]">
        <Row k="Total lines stored" v={b.total} />
        <Row k="Stock lines" v={b.stock} />
        <Row k="Description-only" v={b.description} muted />
        <Row k="Serial / reference" v={b.serial_or_reference} muted />
        <Row k="Child detail" v={b.child_detail} muted />
        <Row k="Unknown / other" v={b.unknown} muted />
        <Row k="Voided source lines" v={b.voided} muted />
        <div className="mt-2 border-t pt-1" />
        <Row k="Stock → Renewal mapped" v={b.stockRenewalMapped} />
        <Row k="Stock → Ad Hoc mapped" v={b.stockAdHocMapped} />
        <Row k="Stock — no mapping" v={b.stockUnmapped} muted />
        <Row k="Lines without stock (ignored)" v={b.linesWithoutStock} muted />
        {b.duplicateRowsDetected > 0 && (
          <Row k="Duplicate rows detected" v={b.duplicateRowsDetected} />
        )}
        {run && (
          <>
            <div className="mt-2 border-t pt-1" />
            <div className="text-[10px] uppercase text-muted-foreground">Latest run</div>
            <Row k="Headers scanned" v={run.headersScanned ?? 0} />
            <Row k="Detail requests OK" v={run.detailRequestsSucceeded ?? 0} />
            {(run.detailRequestsFailed ?? 0) > 0 && (
              <Row k="Detail requests failed" v={run.detailRequestsFailed ?? 0} />
            )}
            <Row k="Renewal events inserted" v={run.renewalEventsInserted ?? 0} />
            <Row k="Events skipped — voided" v={run.renewalEventsSkippedVoided ?? 0} muted />
            <Row
              k="Events skipped — missing customer"
              v={run.renewalEventsSkippedMissingCustomer ?? 0}
              muted
            />
            <Row
              k="Events skipped — invalid date"
              v={run.renewalEventsSkippedInvalidDate ?? 0}
              muted
            />
          </>
        )}
      </dl>
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

interface DocCandidate {
  document_no: string;
  n3_document_id: string;
  source_type: "invoice" | "delivery_order";
  document_date: string | null;
  document_status: string | null;
  customer_code: string | null;
  customer_name: string | null;
  total_lines: number;
  eligible_lines: number;
}

function DocumentVerifier() {
  const [docNo, setDocNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyDocResponse | null>(null);
  const [candidates, setCandidates] = useState<DocCandidate[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const verifyByDocument = async (c: DocCandidate) => {
    setBusy(true);
    setResult(null);
    setSelectedKey(`${c.source_type}::${c.n3_document_id}`);
    try {
      const params = new URLSearchParams({
        docNo: c.document_no,
        documentId: c.n3_document_id,
        source: c.source_type,
      });
      const res = await authFetch(`/api/diagnostics/verify-document?${params.toString()}`);
      const json = (await res.json()) as VerifyDocResponse;
      if (!res.ok) setResult({ ...json, found: false, error: json.error ?? `HTTP ${res.status}` });
      else setResult(json);
    } catch (err) {
      setResult({
        tenantCode: "",
        documentNo: c.document_no,
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = docNo.trim();
    if (!q) return;
    setSearchError(null);
    setCandidates(null);
    setSelectedKey(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await authFetch(
        `/api/diagnostics/document-search?q=${encodeURIComponent(q)}`,
      );
      const json = (await res.json()) as {
        candidates?: DocCandidate[];
        truncated?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setSearchError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      const list = json.candidates ?? [];
      setTruncated(!!json.truncated);
      setCandidates(list);
      // Only auto-verify when exactly one record exists across all sources
      // AND the document number itself is unique — otherwise let the admin
      // pick to disambiguate reused document numbers.
      if (list.length === 1) {
        await verifyByDocument(list[0]);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (status: string | null | undefined) => {
    const s = (status ?? "").trim().toLowerCase();
    if (s === "deleted")
      return "bg-destructive/10 text-destructive border border-destructive/30";
    if (s === "cancelled" || s === "canceled")
      return "bg-amber-100 text-amber-800 border border-amber-300";
    return "bg-emerald-100 text-emerald-800 border border-emerald-300";
  };

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Document Verifier</h2>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          value={docNo}
          onChange={(e) => setDocNo(e.target.value)}
          placeholder="Search by Doc No, Customer Name or Customer Code"
          className="min-h-10 min-w-72 flex-1 rounded-md border bg-background px-3 text-sm shadow-sm"
        />
        <button
          disabled={busy || !docNo.trim()}
          className="min-h-10 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Searching…" : "Search"}
        </button>
      </form>
      {searchError && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {searchError}
        </p>
      )}
      {candidates && candidates.length === 0 && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No matching documents. Sync Transaction Details first, or try a broader search.
        </p>
      )}
      {candidates && candidates.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border">
          {truncated && (
            <p className="border-b bg-amber-50 px-3 py-1 text-[11px] text-amber-800">
              Showing the most recent matches only. Refine the search for a specific document.
            </p>
          )}
          <table className="w-full text-xs">
            <thead className="bg-muted uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left">Document</th>
                <th className="px-2 py-1 text-left">N3 ID</th>
                <th className="px-2 py-1 text-left">Source</th>
                <th className="px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-left">Date</th>
                <th className="px-2 py-1 text-left">Customer</th>
                <th className="px-2 py-1 text-right">Lines</th>
                <th className="px-2 py-1 text-right">Eligible</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const key = `${c.source_type}::${c.n3_document_id}`;
                const isSelected = key === selectedKey;
                return (
                  <tr
                    key={key}
                    className={`border-t ${isSelected ? "bg-primary/5" : ""}`}
                  >
                    <td className="px-2 py-1 font-mono">{c.document_no}</td>
                    <td
                      className="px-2 py-1 font-mono text-[10px] text-muted-foreground"
                      title={c.n3_document_id}
                    >
                      {c.n3_document_id.slice(0, 8)}…
                    </td>
                    <td className="px-2 py-1">{c.source_type}</td>
                    <td className="px-2 py-1">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBadge(c.document_status)}`}
                      >
                        {c.document_status ?? "Active"}
                      </span>
                    </td>
                    <td className="px-2 py-1">{fmtDate(c.document_date ?? "")}</td>
                    <td className="px-2 py-1">
                      {c.customer_code ?? "—"} {c.customer_name ?? ""}
                    </td>
                    <td className="px-2 py-1 text-right">{c.total_lines}</td>
                    <td className="px-2 py-1 text-right">{c.eligible_lines}</td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => verifyByDocument(c)}
                        className="rounded-md border border-primary/40 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
                      >
                        {isSelected ? "Selected" : "Verify"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
                      <th className="px-2 py-1 text-left">Type</th>
                      <th className="px-2 py-1 text-left">Stock</th>
                      <th className="px-2 py-1 text-left">Description</th>
                      <th className="px-2 py-1 text-right">Qty</th>
                      <th className="px-2 py-1 text-left">Void</th>
                      <th className="px-2 py-1 text-left">Mapping</th>
                      <th className="px-2 py-1 text-left">Category</th>
                      <th className="px-2 py-1 text-left">Cycle</th>
                      <th className="px-2 py-1 text-left">Renewal Event</th>
                      <th className="px-2 py-1 text-left">Eligibility</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.lines.map((l, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1">{String(l.line_no ?? "")}</td>
                        <td className="px-2 py-1">{String(l.line_type ?? "—")}</td>
                        <td className="px-2 py-1 font-mono">{String(l.stock_code ?? "")}</td>
                        <td className="px-2 py-1">{String(l.description ?? l.stock_name ?? "")}</td>
                        <td className="px-2 py-1 text-right">{String(l.quantity ?? "")}</td>
                        <td className="px-2 py-1">{String(l.is_void ?? false)}</td>
                        <td className="px-2 py-1">{String(l.mapping_result ?? "")}</td>
                        <td className="px-2 py-1">{String(l.subscription_category ?? "—")}</td>
                        <td className="px-2 py-1">{String(l.renewal_cycle ?? "—")}</td>
                        <td className="px-2 py-1">
                          {(() => {
                            const s = (l as { renewal_event_state?: string }).renewal_event_state;
                            if (s === "existing") return "existing";
                            if (s === "missing") return "missing (re-sync needed)";
                            return l.renewal_event ? "existing" : "—";
                          })()}
                        </td>
                        <td className="px-2 py-1">
                          {l.eligible_for_renewal === "yes"
                            ? "yes"
                            : l.ineligible_reason
                              ? `no · ${String(l.ineligible_reason).replaceAll("_", " ")}`
                              : "—"}
                        </td>
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

