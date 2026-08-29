// POST /api/integrations/google-drive/connect — Owner/Admin only.
// Returns the Google consent URL for THIS tenant. The opaque state is created
// and bound server-side; the browser never chooses it.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/integrations/google-drive/connect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { beginAuthorization, missingDriveEnv } = await import(
          "@/lib/qne/storage/google-drive.server"
        );
        try {
          const user = await requireAdministrator(request);
          const actor = {
            tenantCode: user.tenantCode,
            userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName || user.email || null,
          };
          const missing = missingDriveEnv();
          if (missing.length) {
            return Response.json(
              {
                error:
                  "Google Drive is not configured for this deployment yet. An administrator must set the server-only environment variables.",
                missingEnv: missing,
              },
              { status: 503 },
            );
          }
          // State creation and the connect_started audit commit atomically.
          const authorizationUrl = await beginAuthorization(actor);
          return Response.json({ authorizationUrl });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[google-drive connect] failed");
          return Response.json({ error: "Failed to start Google Drive connection" }, { status: 500 });
        }
      },
    },
  },
});
