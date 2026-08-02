// GET/PUT /api/settings/tenant — Travel & GPS, Attachments and Completion
// settings for the current tenant. Owner/Administrator only for writes.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/settings/tenant")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { loadTenantSettings } = await import(
          "@/lib/qne/service-jobs/tenant-settings.server"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const settings = await loadTenantSettings(user.tenantCode);
          return Response.json({ settings, isAdmin: Boolean(user.isAdministrator) });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/tenant GET] failed", err);
          return Response.json({ error: "Failed to load settings" }, { status: 500 });
        }
      },

      PUT: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { loadTenantSettings, saveTenantSettings } = await import(
          "@/lib/qne/service-jobs/tenant-settings.server"
        );
        const { mergeTenantSettings } = await import("@/lib/qne/service-jobs/tenant-settings");
        try {
          const user = await requireAuthenticatedN3User(request);
          if (!user.isAdministrator) {
            return Response.json(
              { error: "Only an Owner or Administrator can change these settings." },
              { status: 403 },
            );
          }
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const area = String(body.area ?? "settings");
          const current = await loadTenantSettings(user.tenantCode);
          const next = mergeTenantSettings({ ...current, ...(body.settings ?? {}) });
          const saved = await saveTenantSettings(
            user.tenantCode,
            next,
            {
              userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
              name: user.displayName || user.email || null,
            },
            area,
          );
          return Response.json({ ok: true, settings: saved });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/tenant PUT] failed", err);
          return Response.json({ error: "Failed to save settings" }, { status: 500 });
        }
      },
    },
  },
});
