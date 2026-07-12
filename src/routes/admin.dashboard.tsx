import { createFileRoute, Link } from "@tanstack/react-router";

import { AdminOnly } from "@/components/qne/AdminOnly";
import { useSession } from "@/lib/qne/session-context";

export const Route = createFileRoute("/admin/dashboard")({
  component: () => (
    <AdminOnly>
      <AdminDashboard />
    </AdminOnly>
  ),
});

function AdminDashboard() {
  const { session } = useSession();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Admin dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {session?.companyName || "—"} · Tenant {session?.tenantCode || "—"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          to="/admin/snapshots"
          title="Snapshot console"
          description="Sync N3 customers, stock and contracts. Inspect health."
        />
        <Tile
          to="/settings"
          title="Settings"
          description="Stock mappings, general settings, admin allowlist."
        />
        <Tile
          to="/"
          title="Service console"
          description="Look up customers and check contract status."
        />
      </div>

      <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Full management KPIs, approvals and reports will land in later phases.
        This page is a scaffold for the future Administrator dashboard.
      </p>
    </div>
  );
}

function Tile({ to, title, description }: { to: string; title: string; description: string }) {
  return (
    <Link
      to={to}
      className="group rounded-lg border bg-card p-4 transition-colors hover:border-primary hover:bg-accent/40"
    >
      <h3 className="text-sm font-semibold text-foreground group-hover:text-primary">
        {title}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </Link>
  );
}
