// POST /api/sync/customers — CustomerSnapshotSync for the caller's tenant.
// The tenant is resolved server-side from BasicInfo using the caller's JWT;
// browser-supplied tenant values are ignored.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/sync/customers")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { resolveTenantContext, UnauthorizedSyncError, syncCustomerSnapshots } =
          await import("@/lib/qne/sync/index.server");
        try {
          const ctx = await resolveTenantContext(request);
          const result = await syncCustomerSnapshots(ctx);
          return Response.json({ tenantCode: ctx.tenantCode, ...result });
        } catch (err) {
          if (err instanceof UnauthorizedSyncError) {
            return Response.json({ error: err.message }, { status: 401 });
          }
          console.error("[sync/customers] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Sync failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
