import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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


function AdminDashboard() {
  const { session, currentUser } = useSession();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <div className="flex flex-wrap gap-2">
          <QuickLink to="/support" label="Workspace" />
          <QuickLink to="/admin/snapshots" label="Snapshot Console" primary />
          <QuickLink to="/settings" label="Settings" />
        </div>
      </header>

      <Section title="Operations">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Jobs Today" tone="blue" comingSoon />
          <StatCard label="Pending Approval" tone="amber" comingSoon />
          <StatCard label="Waiting Customer" tone="amber" comingSoon />
          <StatCard label="Waiting Vendor" tone="purple" comingSoon />
          <StatCard label="Due Soon Customers" tone="amber" comingSoon />
          <StatCard label="Overdue Customers" tone="red" comingSoon />
        </div>
      </Section>

      <Section title="Management">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="User Workload" tone="blue" comingSoon />
          <StatCard label="Renewal Summary" tone="green" comingSoon />
          <StatCard label="Reports" tone="grey" comingSoon />
          <StatCard label="Notifications" tone="purple" comingSoon />
        </div>
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

      <p className="rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground shadow-sm">
        Full operational KPIs, approvals and reports arrive with Phase 1
        business modules. System-health tiles are already live and read from
        this tenant's diagnostics API.
      </p>
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
  const status = row?.status ?? "unknown";
  const tone =
    status === "healthy"
      ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
      : status === "warning"
        ? "bg-amber-100 text-amber-800 ring-amber-200"
        : status === "error"
          ? "bg-red-100 text-red-800 ring-red-200"
          : "bg-muted text-muted-foreground ring-border";
  const dot =
    status === "healthy"
      ? "bg-emerald-500"
      : status === "warning"
        ? "bg-amber-500"
        : status === "error"
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
        {row?.last_success_at
          ? new Date(row.last_success_at).toLocaleString()
          : "—"}
      </div>
      {row?.last_error && (
        <div className="mt-1 line-clamp-2 text-xs text-red-700">
          {row.last_error}
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
