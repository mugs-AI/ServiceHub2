import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useSession } from "@/lib/qne/session-context";

export const Route = createFileRoute("/dashboard")({
  component: UserDashboard,
});

/**
 * Normal User Dashboard — "What work needs my attention today?".
 * Administrator can also visit; they typically land on /admin/dashboard.
 * All operational KPIs are Coming Soon until Phase 1 modules ship — we do
 * not invent fake counts or records.
 */
function UserDashboard() {
  const { session, currentUser } = useSession();
  const name = currentUser?.displayName || session?.email || "there";

  return (
    <div className="space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            My workspace
          </p>
          <h1 className="mt-1 truncate text-2xl font-semibold text-foreground sm:text-3xl">
            Hello, {name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {session?.companyName || "—"} · What needs your attention today
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <QuickLink to="/support" label="Open Workspace" primary />
          <QuickAction label="New Service Job" />
          <QuickAction label="Quick Service" />
        </div>
      </header>

      <section>
        <SectionTitle>My work</SectionTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="My Open Jobs" tone="blue" comingSoon />
          <StatCard label="High Priority" tone="red" comingSoon />
          <StatCard label="Waiting Customer" tone="amber" comingSoon />
          <StatCard label="Waiting Vendor" tone="purple" comingSoon />
        </div>
      </section>

      <section>
        <SectionTitle>Today</SectionTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Today's Calendar" tone="blue" comingSoon />
          <StatCard label="Due Soon Customers" tone="amber" comingSoon />
          <StatCard label="Recent Customers" tone="grey" comingSoon />
          <StatCard label="Authorized Reports" tone="green" comingSoon />
        </div>
      </section>

      <p className="rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground shadow-sm">
        Your daily workspace fills in as job features ship in Phase 1. No
        example data is created — all counts read from your real tenant.
      </p>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

type Tone = "blue" | "green" | "amber" | "red" | "purple" | "grey";

const toneClasses: Record<Tone, { ring: string; icon: string; badge: string }> = {
  blue: {
    ring: "before:bg-blue-500",
    icon: "bg-blue-100 text-blue-700",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
  },
  green: {
    ring: "before:bg-emerald-500",
    icon: "bg-emerald-100 text-emerald-700",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  amber: {
    ring: "before:bg-amber-500",
    icon: "bg-amber-100 text-amber-800",
    badge: "bg-amber-50 text-amber-800 ring-amber-200",
  },
  red: {
    ring: "before:bg-red-500",
    icon: "bg-red-100 text-red-700",
    badge: "bg-red-50 text-red-700 ring-red-200",
  },
  purple: {
    ring: "before:bg-purple-500",
    icon: "bg-purple-100 text-purple-700",
    badge: "bg-purple-50 text-purple-700 ring-purple-200",
  },
  grey: {
    ring: "before:bg-slate-400",
    icon: "bg-slate-100 text-slate-700",
    badge: "bg-slate-100 text-slate-600 ring-slate-200",
  },
};

export function StatCard({
  label,
  value,
  tone = "blue",
  comingSoon,
  hint,
}: {
  label: string;
  value?: string | number;
  tone?: Tone;
  comingSoon?: boolean;
  hint?: string;
}) {
  const t = toneClasses[tone];
  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm transition-colors before:absolute before:left-0 before:top-0 before:h-full before:w-1 ${t.ring}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {comingSoon && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${t.badge}`}
          >
            Coming soon
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">
        {comingSoon ? "—" : (value ?? "—")}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
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

function QuickAction({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      title="Available when Job creation ships in Phase 1"
      className="inline-flex min-h-11 cursor-not-allowed items-center gap-2 rounded-lg border bg-muted/60 px-4 text-sm font-medium text-muted-foreground"
    >
      {label}
      <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ring-1 ring-border">
        Soon
      </span>
    </button>
  );
}
