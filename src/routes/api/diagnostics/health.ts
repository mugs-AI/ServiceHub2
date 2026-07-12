// GET /api/diagnostics/health — snapshot health summary for caller's tenant.
// Administrator-only.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/diagnostics/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { getSnapshotHealth } = await import("@/lib/qne/diagnostics.server");
        try {
          const user = await requireAdministrator(request);
          const result = await getSnapshotHealth(user.tenantCode);
          return Response.json(result);
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[diagnostics/health] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Diagnostics failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
