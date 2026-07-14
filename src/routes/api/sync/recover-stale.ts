// POST /api/sync/recover-stale — Administrator (Owner) only.
// Marks the tenant's abandoned in-flight sync log as failed and releases
// the stale lock for a given snapshot type. Does NOT touch a live (non-stale)
// lock: those cases return HTTP 409 with the active-run details.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/sync/recover-stale")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { recoverStaleLock } = await import("@/lib/qne/sync/log.server");
        try {
          const user = await requireAdministrator(request);
          const body = (await request.json().catch(() => ({}))) as {
            snapshotType?: string;
          };
          const raw = (body.snapshotType ?? "contract").toLowerCase();
          const snapshotType = raw === "customer" || raw === "stock" || raw === "contract"
            ? (raw as "customer" | "stock" | "contract")
            : "contract";

          const result = await recoverStaleLock(user.tenantCode, snapshotType);
          if (!result.recovered && result.wasLive) {
            return Response.json(
              {
                error: "The current sync run is still active; nothing to recover.",
                activeLock: result.wasLive,
              },
              { status: 409 },
            );
          }
          return Response.json({
            tenantCode: user.tenantCode,
            snapshotType,
            recovered: result.recovered,
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[sync/recover-stale] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Recovery failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
