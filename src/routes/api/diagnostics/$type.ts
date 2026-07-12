// GET /api/diagnostics/$type — detailed diagnostics for one snapshot type.
// $type ∈ { customers | stock | contract } (case-insensitive).

import { createFileRoute } from "@tanstack/react-router";
import type { HealthSnapshotType } from "@/lib/qne/sync/health.server";

function normaliseType(raw: string): HealthSnapshotType | null {
  const t = raw.trim().toLowerCase();
  if (t === "customers" || t === "customer") return "Customers";
  if (t === "stock") return "Stock";
  if (t === "contract" || t === "contracts") return "Contract";
  return null;
}

export const Route = createFileRoute("/api/diagnostics/$type")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { getSnapshotDiagnostics } = await import("@/lib/qne/diagnostics.server");
        const type = normaliseType(params.type);
        if (!type) {
          return Response.json(
            { error: "Unknown snapshot type. Use customers, stock, or contract." },
            { status: 400 },
          );
        }
        try {
          const user = await requireAdministrator(request);
          const result = await getSnapshotDiagnostics(user.tenantCode, type);
          return Response.json(result);
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[diagnostics/$type] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Diagnostics failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
