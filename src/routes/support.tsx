import { createFileRoute } from "@tanstack/react-router";

import { CustomerLookup } from "@/components/qne/CustomerLookup";
import { useSession } from "@/lib/qne/session-context";

export const Route = createFileRoute("/support")({
  component: SupportWorkspace,
});

function SupportWorkspace() {
  const { session, currentUser } = useSession();
  const name = currentUser?.displayName || session?.email || "there";

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Workspace
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground sm:text-3xl">
          Welcome, {name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {session?.companyName || "—"} · Tenant {session?.tenantCode || "—"}
        </p>
      </header>

      <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Customer lookup
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Search live N3 customers and check their maintenance contract status.
          </p>
        </div>
        <CustomerLookup />
      </section>

      <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Jobs, calendar and reports will appear here as Phase 1 business
        features ship.
      </p>
    </div>
  );
}
