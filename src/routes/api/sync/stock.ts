// POST /api/sync/stock — StockSnapshotSync for the caller's tenant.
// Administrator-only. Tenant resolved server-side from N3 BasicInfo/JWT.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/sync/stock")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { syncStockSnapshots } = await import("@/lib/qne/sync/index.server");
        try {
          const user = await requireAdministrator(request);
          const result = await syncStockSnapshots({
            token: user.token,
            tenantCode: user.tenantCode,
            companyName: user.companyName,
            email: user.email,
          });
          return Response.json({ tenantCode: user.tenantCode, ...result });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
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
