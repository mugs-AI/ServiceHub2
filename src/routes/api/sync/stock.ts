// POST /api/sync/stock — StockSnapshotSync for the caller's tenant.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/sync/stock")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { resolveTenantContext, UnauthorizedSyncError, syncStockSnapshots } =
          await import("@/lib/qne/sync/index.server");
        try {
          const ctx = await resolveTenantContext(request);
          const result = await syncStockSnapshots(ctx);
          return Response.json({ tenantCode: ctx.tenantCode, ...result });
        } catch (err) {
          if (err instanceof UnauthorizedSyncError) {
            return Response.json({ error: err.message }, { status: 401 });
          }
          console.error("[sync/stock] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Sync failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
