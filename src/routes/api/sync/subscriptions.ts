// POST /api/sync/subscriptions — Customer Subscription Snapshot Sync.
// Administrator-only. Tenant resolved server-side from the N3 session.
// Rebuilds customer_subscription_snapshots (one row per Customer + Category).

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/sync/subscriptions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { syncSubscriptionSnapshots } = await import(
          "@/lib/qne/sync/index.server"
        );
        try {
          const user = await requireAdministrator(request);
          const result = await syncSubscriptionSnapshots({
            token: user.token,
            tenantCode: user.tenantCode,
            companyName: user.companyName,
            email: user.email,
          });
          return Response.json({ tenantCode: user.tenantCode, ...result });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[sync/subscriptions] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Sync failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
