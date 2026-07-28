import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { AdminOnly } from "@/components/qne/AdminOnly";
import { StatCard } from "./dashboard";
import { useSession } from "@/lib/qne/session-context";
import { getStoredToken } from "@/lib/qne/tokens";


export const Route = createFileRoute("/admin/dashboard")({
  component: () => (
    <AdminOnly>
      <AdminDashboard />
    </AdminOnly>
  ),
});

interface HealthRow {
  snapshot_type: "Customers" | "Stock" | "Contract";
  health_status: "Healthy" | "Warning" | "Error";
  last_successful_sync?: string | null;
  error_message?: string | null;
}

interface HealthResponse {
  tenantCode: string;
  snapshots: HealthRow[];
}


interface AdminSummary {
  jobsToday: number;
  pendingApproval: number;
  waitingCustomer: number;
  waitingVendor: number;
  dueSoonCustomers: number;
  overdueCustomers: number;
}
interface WorkloadRow {
  user_id: string;
  name: string;
  total: number;
  inProgress: number;
  waiting: number;
}
interface AdminDashboardResponse {
  summary: AdminSummary;
  userWorkload: WorkloadRow[];
  generatedAt: string;
}

const AUTO_REFRESH_MS = 30_000;

function AdminDashboard() {
  const { session, currentUser } = useSession();
  const navigate = useNavigate();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ops, setOps] = useState<AdminDashboardResponse | null>(null);
  const [opsErr, setOpsErr] = useState<string | null>(null);
  const [opsLoading, setOpsLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = getStoredToken();
        const res = await fetch("/api/diagnostics/health", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const json = (await res.json()) as HealthResponse & { error?: string };
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setHealth(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadOps = useCallback(async () => {
    setOpsLoading(true);
    setOpsErr(null);
    try {
      const token = getStoredToken();
      const res = await fetch("/api/admin/dashboard", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = (await res.json()) as AdminDashboardResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setOps(json);
      setLastRefreshed(new Date());
    } catch (e) {
      setOpsErr(e instanceof Error ? e.message : String(e));
    } finally {
      setOpsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOps();
    const iv = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadOps();
    }, AUTO_REFRESH_MS);
    const onFocus = () => void loadOps();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadOps]);

  const healthMap = new Map<HealthRow["snapshot_type"], HealthRow>(
    (health?.snapshots ?? []).map((r) => [r.snapshot_type, r]),
  );
  const failedCount =
    health?.snapshots.filter((r) => r.health_status === "Error").length ?? 0;
  const lastSyncs = (health?.snapshots ?? [])
    .map((r) => r.last_successful_sync ?? null)
    .filter((x): x is string => !!x)
    .sort()
    .reverse();
  const lastSyncLabel = lastSyncs.length > 0
    ? new Date(lastSyncs[0]).toLocaleString()
    : "—";

  const s = ops?.summary;

  return (
    <div className="space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Administrator dashboard
          </p>
          <h1 className="mt-1 truncate text-2xl font-semibold text-foreground sm:text-3xl">
            {session?.companyName || "—"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tenant {session?.tenantCode || "—"} · Signed in as{" "}
            {currentUser?.displayName || currentUser?.email || "administrator"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 text-[11px] text-muted-foreground">
            {lastRefreshed
              ? `Updated ${lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "—"}
          </div>
          <button
            type="button"
            onClick={() => void loadOps()}
            disabled={opsLoading}
            className="min-h-9 rounded-md border bg-card px-3 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-50"
          >
            {opsLoading ? "Refreshing…" : "Refresh"}
          </button>
          <QuickLink to="/support" label="Workspace" />
          <QuickLink to="/admin/snapshots" label="Snapshot Console" primary />
          <QuickLink to="/settings" label="Settings" />
        </div>
      </header>

      <Section title="Operations">
        {opsErr && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {opsErr}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6">
          <StatLink to="/support"><StatCard label="Jobs Today" value={s?.jobsToday ?? "—"} tone="blue" /></StatLink>
          <StatLink to="/jobs/pending" search={{ queueType: "pending_approval" }}><StatCard label="Pending Approval" value={s?.pendingApproval ?? "—"} tone="amber" /></StatLink>
          <StatLink to="/jobs/pending" search={{ queueType: "waiting_customer" }}><StatCard label="Waiting Customer" value={s?.waitingCustomer ?? "—"} tone="amber" /></StatLink>
          <StatLink to="/jobs/pending" search={{ queueType: "waiting_vendor" }}><StatCard label="Waiting Vendor" value={s?.waitingVendor ?? "—"} tone="purple" /></StatLink>
          <StatLink to="/customers/entitlements" search={{ status: "due_soon" }}><StatCard label="Due Soon Customers" value={s?.dueSoonCustomers ?? "—"} tone="amber" /></StatLink>
          <StatLink to="/customers/entitlements" search={{ status: "overdue" }}><StatCard label="Overdue Customers" value={s?.overdueCustomers ?? "—"} tone="red" /></StatLink>
        </div>
      </Section>

      <Section title="User workload">
        {(!ops || ops.userWorkload.length === 0) ? (
          <p className="rounded-lg border border-dashed bg-background/60 px-4 py-3 text-sm text-muted-foreground">
            No active assignments right now.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Technician</th>
                  <th className="px-3 py-2 text-right">Active jobs</th>
                  <th className="px-3 py-2 text-right">In Progress</th>
                  <th className="px-3 py-2 text-right">Waiting</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {ops.userWorkload.map((w) => (
                  <tr
                    key={w.user_id}
                    className="cursor-pointer hover:bg-accent/40"
                    onClick={() =>
                      navigate({
                        to: "/jobs/pending",
                        search: { technician: w.user_id, technicianName: w.name },
                      })
                    }
                  >
                    <td className="px-3 py-2 text-foreground">{w.name}</td>
                    <td className="px-3 py-2 text-right font-semibold text-foreground">{w.total}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{w.inProgress}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{w.waiting}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="System health">
        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <HealthCard title="Customer Snapshots" row={healthMap.get("Customers")} loading={loading} />
          <HealthCard title="Stock Snapshots" row={healthMap.get("Stock")} loading={loading} />
          <HealthCard title="Contract Snapshots" row={healthMap.get("Contract")} loading={loading} />

        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <StatCard label="Last Synchronization" value={lastSyncLabel} tone="blue" />
          <StatCard
            label="Failed Synchronizations"
            value={failedCount}
            tone={failedCount > 0 ? "red" : "green"}
          />
          <StatCard label="Calculation Errors" tone="amber" comingSoon />
        </div>
      </Section>

      <Section title="Role diagnostics">
        <RoleDiagnostics />
      </Section>

      <p className="rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground shadow-sm">
        Full operational KPIs, approvals and reports arrive with Phase 1
        business modules. System-health tiles are already live and read from
        this tenant's diagnostics API.
      </p>
    </div>
  );
}

function RoleDiagnostics() {
  const { currentUser } = useSession();
  const d = currentUser?.diagnostics;
  const gateLabel: Record<string, string> = {
    n3_owner: "Official N3 tenant Owner (isOwner=true)",
    allowlist: "Tenant-scoped ServiceHub allowlist (emergency fallback)",
    bootstrap: "First-user bootstrap (emergency fallback)",
    none: "Not an administrator",
  };
  const reasonLabel: Record<string, string> = {
    matched_owner: "Matched N3 user has isOwner = true",
    matched_not_owner: "Matched N3 user has isOwner = false",
    no_matching_user: "No matching N3 user in /api/Users",
    users_endpoint_failed: "/api/Users request failed",
    users_endpoint_unauthorized: "/api/Users returned 401 Unauthorized",
    users_endpoint_forbidden: "/api/Users returned 403 Forbidden",
    identity_missing: "N3 JWT did not carry a user identifier",
    allowlist_fallback: "Granted via tenant allowlist (emergency fallback)",
    bootstrap_fallback: "Granted as first user of this tenant (emergency fallback)",
  };
  const ep = d?.usersEndpoint;
  const endpointText = ep
    ? ep.status === "ok"
      ? `ok — ${ep.count} users (${ep.shape})`
      : `${ep.status}${ep.httpStatus ? ` (${ep.httpStatus})` : ""} — ${ep.error ?? "unknown"}`
    : "—";
  return (
    <div className="rounded-xl border bg-card p-4 text-xs shadow-sm">
      <dl className="grid gap-2 sm:grid-cols-2">
        <Row k="Identity source" v={d?.identitySource ?? "—"} />
        <Row k="Identity identifier" v={d?.identityUserIdentifier ?? "—"} />
        <Row k="Matched N3 user id" v={d?.matchedN3UserId ?? "—"} />
        <Row k="Matched display name" v={d?.matchedDisplayName ?? "—"} />
        <Row k="isOwner" v={currentUser?.isOwner ? "true" : "false"} />
        <Row
          k="Role names"
          v={currentUser?.roleNames?.length ? currentUser.roleNames.join(", ") : "—"}
        />
        <Row
          k="isAdministrator"
          v={currentUser?.isAdministrator ? "true" : "false"}
        />
        <Row k="Admin gate" v={gateLabel[currentUser?.adminGate ?? "none"]} />
        <Row k="Reason" v={reasonLabel[d?.reason ?? "no_matching_user"] ?? d?.reason ?? "—"} />
        <Row k="/api/Users" v={endpointText} />
      </dl>
    </div>
  );
}


function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {k}
      </dt>
      <dd className="mt-0.5 break-words text-foreground">{v}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function HealthCard({
  title,
  row,
  loading,
}: {
  title: string;
  row?: HealthRow;
  loading: boolean;
}) {
  const status = row?.health_status ?? "Unknown";
  const tone =
    status === "Healthy"
      ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
      : status === "Warning"
        ? "bg-amber-100 text-amber-800 ring-amber-200"
        : status === "Error"
          ? "bg-red-100 text-red-800 ring-red-200"
          : "bg-muted text-muted-foreground ring-border";
  const dot =
    status === "Healthy"
      ? "bg-emerald-500"
      : status === "Warning"
        ? "bg-amber-500"
        : status === "Error"
          ? "bg-red-500"
          : "bg-muted-foreground/60";
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${tone}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {loading ? "Loading" : status}
        </span>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        Last success:{" "}
        {row?.last_successful_sync
          ? new Date(row.last_successful_sync).toLocaleString()
          : "—"}
      </div>
      {row?.error_message && (
        <div className="mt-1 line-clamp-2 text-xs text-red-700">
          {row.error_message}
        </div>
      )}
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

function StatLink({
  to,
  search,
  children,
}: {
  to: string;
  search?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <Link to={to} search={search as never} className="block transition-transform hover:scale-[1.01]">
      {children}
    </Link>
  );
}
