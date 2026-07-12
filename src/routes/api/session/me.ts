// GET /api/session/me — resolves the authenticated N3 user server-side.
// Returns tenantCode, display name, email, and isAdministrator for the shell.
// Never trusts browser-supplied values.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/session/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          return Response.json({
            tenantCode: user.tenantCode,
            companyName: user.companyName,
            email: user.email,
            displayName: user.displayName,
            userCode: user.userCode,
            isAdministrator: user.isAdministrator,
            // Only expose the general source label; never expose env values.
            adminGate:
              user.adminSource === "env_allowlist"
                ? "env"
                : user.adminSource === "db_allowlist"
                  ? "allowlist"
                  : user.adminSource === "db_bootstrap"
                    ? "bootstrap"
                    : "none",
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[session/me] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Session lookup failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
