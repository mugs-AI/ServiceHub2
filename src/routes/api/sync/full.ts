// POST /api/sync/full — Unified sync orchestrator (Customers → Stock →
// Subscriptions → display refresh). Administrator-only.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/sync/full")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { runFullSync } = await import("@/lib/qne/sync/orchestrator.server");
        try {
          const user = await requireAdministrator(request);
          const orchestration = await runFullSync({
            token: user.token,
            tenantCode: user.tenantCode,
            companyName: user.companyName,
            email: user.email,
          });
          return Response.json({ tenantCode: user.tenantCode, orchestration });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[sync/full] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Sync failed" },
            { status: 500 },
          );
        }
      },
      GET: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { getLatestOrchestration } = await import(
          "@/lib/qne/sync/orchestrator.server"
        );
        try {
          const user = await requireAdministrator(request);
          const orchestration = await getLatestOrchestration(user.tenantCode);
          return Response.json({ tenantCode: user.tenantCode, orchestration });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
