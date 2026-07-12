// POST /api/sync/contracts — ContractSnapshotSync for the caller's tenant.
// Administrator-only. Tenant resolved server-side from N3 BasicInfo/JWT.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/sync/contracts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { syncContractSnapshots } = await import("@/lib/qne/sync/index.server");
        try {
          const user = await requireAdministrator(request);
          let customerCodes: string[] | undefined;
          try {
            const raw = await request.text();
            if (raw) {
              const parsed = JSON.parse(raw) as { customerCodes?: unknown };
              if (Array.isArray(parsed.customerCodes)) {
                customerCodes = parsed.customerCodes.filter(
                  (c): c is string => typeof c === "string" && c.trim().length > 0,
                );
              }
            }
          } catch {
            // ignore body parse errors
          }
          const result = await syncContractSnapshots(
            {
              token: user.token,
              tenantCode: user.tenantCode,
              companyName: user.companyName,
              email: user.email,
            },
            { customerCodes },
          );
          return Response.json({ tenantCode: user.tenantCode, ...result });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[sync/contracts] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Sync failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
