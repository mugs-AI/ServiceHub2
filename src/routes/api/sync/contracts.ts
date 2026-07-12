// POST /api/sync/contracts — ContractSnapshotSync for the caller's tenant.
// Optional body: { customerCodes?: string[] } to rebuild only affected customers.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/sync/contracts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { resolveTenantContext, UnauthorizedSyncError, syncContractSnapshots } =
          await import("@/lib/qne/sync/index.server");
        try {
          const ctx = await resolveTenantContext(request);
          let customerCodes: string[] | undefined;
          try {
            const raw = await request.text();
            if (raw) {
              const parsed = JSON.parse(raw) as { customerCodes?: unknown };
              if (Array.isArray(parsed.customerCodes)) {
                customerCodes = parsed.customerCodes
                  .filter((c): c is string => typeof c === "string" && c.trim().length > 0);
              }
            }
          } catch {
            // ignore body parse errors — treat as full rebuild
          }
          const result = await syncContractSnapshots(ctx, { customerCodes });
          return Response.json({ tenantCode: ctx.tenantCode, ...result });
        } catch (err) {
          if (err instanceof UnauthorizedSyncError) {
            return Response.json({ error: err.message }, { status: 401 });
          }
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
