// GET /api/diagnostics/health — snapshot health summary for caller's tenant.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/diagnostics/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { resolveTenantContext, UnauthorizedSyncError } = await import(
          "@/lib/qne/sync/index.server"
        );
        const { getSnapshotHealth } = await import("@/lib/qne/diagnostics.server");
        try {
          const ctx = await resolveTenantContext(request);
          const result = await getSnapshotHealth(ctx.tenantCode);
          return Response.json(result);
        } catch (err) {
          if (err instanceof UnauthorizedSyncError) {
            return Response.json({ error: err.message }, { status: 401 });
          }
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
