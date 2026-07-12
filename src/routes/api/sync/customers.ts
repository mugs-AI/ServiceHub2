// POST /api/sync/customers — CustomerSnapshotSync for the caller's tenant.
// Administrator-only. Tenant resolved server-side from N3 BasicInfo/JWT.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/sync/customers")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { syncCustomerSnapshots } = await import("@/lib/qne/sync/index.server");
        try {
          const user = await requireAdministrator(request);
          const result = await syncCustomerSnapshots({
            token: user.token,
            tenantCode: user.tenantCode,
            companyName: user.companyName,
            email: user.email,
          });
          return Response.json({ tenantCode: user.tenantCode, ...result });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
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
