import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Database,
  Flag,
  LayoutList,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldAlert,
  Truck,
  UserX,
  type LucideIcon,
} from "lucide-react";

import { AdminOnly } from "@/components/qne/AdminOnly";
import { formatMYDateTime } from "@/lib/format-date";
import { StatCard } from "./dashboard";
import { useSession } from "@/lib/qne/session-context";
import { getStoredToken } from "@/lib/qne/tokens";
import {
  ADMIN_CARD_GROUPS,
  ADMIN_COMPLETION_DATA_ALERT,
  type AdminCardDef,
  type AdminSummaryKey,
} from "@/lib/qne/dashboard/admin-cards";
import {
  DashboardAction,
  DashboardHero,
  DashboardProgress,
  DashboardSection,
  DashboardSkeletonGrid,
  DashboardStatCard,
  type DashboardTone,
} from "@/components/qne/dashboard/DashboardPrimitives";

export const Route = createFileRoute("/admin/dashboard")({
  head: () => ({
    meta: [
      { title: "Administrator Command Centre — ServiceHub" },
      {
        name: "description",
        content:
          "Tenant-wide service operations: approvals, live job flow, customer coverage and completion integrity.",
      },
      { property: "og:title", content: "Administrator Command Centre — ServiceHub" },
      {
        property: "og:description",
        content:
          "Tenant-wide service operations: approvals, live job flow, customer coverage and completion integrity.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
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
  activeJobs: number;
  inProgress: number;
  pendingApproval: number;
  cancellationRequests: number;
  /** WP3A — pending reopen requests awaiting an Owner/Admin decision. */
  reopenRequests: number;
  /** WP3B — current-cycle completion outcomes. */
  followUpOpen: number;
  reopenPending: number;
  resolvedToday: number;
  completedCurrentCycle: number;
  legacyCompleted: number;
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

/**
 * WP3C — card icons only. Label, counted field and destination scope come from
 * the shared catalogue, so a card's list can never be broader or narrower than
 * the number it showed.
 */
const CARD_ICONS: Record<AdminSummaryKey, LucideIcon> = {
  pendingApproval: ClipboardCheck,
  cancellationRequests: ShieldAlert,
  reopenRequests: RotateCcw,
  followUpOpen: Flag,
  jobsToday: CalendarPlus,
  activeJobs: Activity,
  inProgress: PlayCircle,
  waitingCustomer: Clock,
  waitingVendor: Truck,
  resolvedToday: CheckCircle2,
  reopenPending: RotateCcw,
  completedCurrentCycle: CheckCircle2,
  legacyCompleted: Archive,
  dueSoonCustomers: Clock,
  overdueCustomers: UserX,
};

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
  const failedCount = health?.snapshots.filter((r) => r.health_status === "Error").length ?? 0;
  const lastSyncs = (health?.snapshots ?? [])
    .map((r) => r.last_successful_sync ?? null)
    .filter((x): x is string => !!x)
    .sort()
    .reverse();
  // Malaysian standard: dd/mm/yyyy, Malaysia time.
  const lastSyncLabel = lastSyncs.length > 0 ? formatMYDateTime(lastSyncs[0]) : "—";

  const s = ops?.summary;
  const showSkeleton = opsLoading && !ops;

  const openCard = (card: AdminCardDef) => {
    if (card.to) {
      void navigate({ to: card.to });
      return;
    }
    void navigate({
      to: "/jobs/pending",
      search: {
        scope: undefined,
        queueType: card.queueType,
        technician: undefined,
        technicianName: undefined,
      },
    });
  };

  const renderCards = (cards: readonly AdminCardDef[]) => (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {cards.map((card) => (
        <DashboardStatCard
          key={card.label}
          label={card.label}
          value={s ? (s[card.key] ?? 0) : "—"}
          meaning={card.meaning}
          icon={CARD_ICONS[card.key]}
          tone={card.tone as DashboardTone}
          onClick={() => openCard(card)}
        />
      ))}
    </div>
  );

  const maxWorkload = Math.max(1, ...(ops?.userWorkload ?? []).map((w) => w.total));

  return (
    <div className="min-w-0 space-y-6">
      <DashboardHero
        eyebrow="Administrator command centre"
        title={session?.companyName || "—"}
        subtitle="Approvals, live job flow, customer coverage and completion integrity for your whole tenant."
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Tenant {session?.tenantCode || "—"} ·{" "}
              {currentUser?.displayName || currentUser?.email || "administrator"}
            </span>
            <span>
              {lastRefreshed
                ? `Updated ${lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : "Loading…"}
            </span>
            <button
              type="button"
              onClick={() => void loadOps()}
              disabled={opsLoading}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border bg-card/90 px-3 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-50 sm:min-h-9"
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
              {opsLoading ? "Refreshing…" : "Refresh"}
            </button>
          </span>
        }
        actions={
          <>
            <DashboardAction
              to="/admin/snapshots"
              label="Snapshot Console"
              icon={Database}
              primary
            />
            <DashboardAction to="/support" label="Workspace" icon={LayoutList} />
            <DashboardAction to="/settings" label="Settings" icon={Settings} />
          </>
        }
      />

      {opsErr && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{opsErr}</p>
      )}

      {ADMIN_CARD_GROUPS.map((group) => (
        <DashboardSection key={group.title} title={group.title} description={group.description}>
          {showSkeleton ? (
            <DashboardSkeletonGrid count={group.cards.length} />
          ) : (
            renderCards(group.cards)
          )}
        </DashboardSection>
      ))}

      <DashboardSection title="User workload" description="Active assignments per technician.">
        {!ops || ops.userWorkload.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-background/60 px-4 py-3 text-sm text-muted-foreground">
            No active assignments right now.
          </p>
        ) : (
          <>
            {/* Mobile — stacked cards, no horizontal scrolling. */}
            <ul className="space-y-2 md:hidden">
              {ops.userWorkload.map((w) => (
                <li key={w.user_id}>
                  <button
                    type="button"
                    onClick={() =>
                      navigate({
                        to: "/jobs/pending",
                        search: {
                          scope: undefined,
                          queueType: undefined,
                          technician: w.user_id,
                          technicianName: w.name,
                        },
                      })
                    }
                    className="dashboard-card block w-full min-h-11 rounded-lg border bg-card p-3 text-left shadow-sm"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-bold text-dashboard-ink">
                        {w.name}
                      </span>
                      <span className="text-sm font-bold text-dashboard-ink">{w.total}</span>
                    </div>
                    <div className="mt-2">
                      <DashboardProgress
                        value={w.total}
                        max={maxWorkload}
                        label={`${w.name} active jobs`}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                      <span>In Progress {w.inProgress}</span>
                      <span>Waiting {w.waiting}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            {/* Desktop — compact table. */}
            <div className="hidden max-w-full overflow-hidden rounded-lg border bg-card shadow-sm md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Technician</th>
                    <th className="px-3 py-2">Load</th>
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
                          search: {
                            scope: undefined,
                            queueType: undefined,
                            technician: w.user_id,
                            technicianName: w.name,
                          },
                        })
                      }
                    >
                      <td className="px-3 py-2 font-medium text-foreground">{w.name}</td>
                      <td className="w-1/3 px-3 py-2">
                        <DashboardProgress
                          value={w.total}
                          max={maxWorkload}
                          label={`${w.name} active jobs`}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-foreground">
                        {w.total}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{w.inProgress}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{w.waiting}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </DashboardSection>

      <DashboardSection
        title="Integration health"
        description="Live N3 snapshot diagnostics and data checks for this tenant."
      >
        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <HealthCard
            title="Customer Snapshots"
            row={healthMap.get("Customers")}
            loading={loading}
          />
          <HealthCard title="Stock Snapshots" row={healthMap.get("Stock")} loading={loading} />
          <HealthCard
            title="Contract Snapshots"
            row={healthMap.get("Contract")}
            loading={loading}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          <DashboardStatCard
            label="Last Synchronization"
            value={lastSyncLabel}
            icon={Database}
            tone="blue"
          />
          <DashboardStatCard
            label="Failed Synchronizations"
            value={failedCount}
            icon={AlertTriangle}
            tone={failedCount > 0 ? "rose" : "emerald"}
          />
          {/* Audit alert — same count, same click-through scope, never hidden. */}
          <DashboardStatCard
            label={ADMIN_COMPLETION_DATA_ALERT.label}
            value={s ? (s[ADMIN_COMPLETION_DATA_ALERT.key] ?? 0) : "—"}
            meaning={ADMIN_COMPLETION_DATA_ALERT.meaning}
            icon={CARD_ICONS[ADMIN_COMPLETION_DATA_ALERT.key]}
            tone={
              s && (s[ADMIN_COMPLETION_DATA_ALERT.key] ?? 0) > 0
                ? "rose"
                : (ADMIN_COMPLETION_DATA_ALERT.tone as DashboardTone)
            }
            onClick={() => openCard(ADMIN_COMPLETION_DATA_ALERT)}
          />
          <div className="opacity-70">
            <StatCard label="Calculation Errors" tone="grey" comingSoon />
          </div>
        </div>
      </DashboardSection>
    </div>
  );
}

function HealthCard({ title, row, loading }: { title: string; row?: HealthRow; loading: boolean }) {
  const status = row?.health_status ?? "Unknown";
  const tone =
    status === "Healthy"
      ? "bg-dashboard-emerald-soft text-dashboard-ink ring-dashboard-emerald/30"
      : status === "Warning"
        ? "bg-dashboard-amber-soft text-dashboard-ink ring-dashboard-amber/40"
        : status === "Error"
          ? "bg-dashboard-rose-soft text-dashboard-ink ring-dashboard-rose/30"
          : "bg-muted text-muted-foreground ring-border";
  const dot =
    status === "Healthy"
      ? "bg-dashboard-emerald"
      : status === "Warning"
        ? "bg-dashboard-amber"
        : status === "Error"
          ? "bg-dashboard-rose"
          : "bg-muted-foreground/60";
  return (
    <div className="min-w-0 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 break-words text-sm font-semibold text-foreground">{title}</div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${tone}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {loading ? "Loading" : status}
        </span>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        Last success: {row?.last_successful_sync ? formatMYDateTime(row.last_successful_sync) : "—"}
      </div>
      {row?.error_message && (
        <div className="mt-1 line-clamp-2 text-xs text-destructive">{row.error_message}</div>
      )}
    </div>
  );
}

/** Kept so existing deep links from other pages keep type-checking. */
export function AdminQuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-11 items-center justify-center rounded-lg border bg-card px-3 text-sm font-medium text-foreground shadow-sm hover:bg-accent"
    >
      {label}
    </Link>
  );
}
