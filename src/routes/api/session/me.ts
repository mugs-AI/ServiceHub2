// GET /api/session/me — resolves the authenticated N3 user server-side.
// Returns tenantCode, display name, email, role names and isAdministrator
// (resolved from official N3 /api/Users role attachments, with the
// tenant-scoped ServiceHub allowlist as a secure fallback).
// Diagnostics fields are Administrator-only.

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
            roleNames: user.roleNames,
            isAdministrator: user.isAdministrator,
            adminGate: user.adminGate,
            // Phase 0.9.5: diagnostics exposed to the current authenticated
            // user (own identifiers only — no other users' data, no tokens,
            // no raw payloads) so Normal Users can see the exact reason
            // Administrator resolution failed.
            diagnostics: user.diagnostics,
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
