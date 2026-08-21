// GET/PUT /api/settings/entitlement-policy — tenant Due Soon Window.
//
// Owner/Administrator only. Tenant is always server-resolved from the
// authenticated N3 session; the browser can never supply a tenant, a date or
// an out-of-range threshold. Writes touch only general_settings.due_soon_days
// and are recorded in settings_audit_log.

import { createFileRoute } from "@tanstack/react-router";

const AUDIT_AREA = "entitlement_policy";

export const Route = createFileRoute("/api/settings/entitlement-policy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { resolveDueSoonDays } = await import("@/lib/qne/entitlements/temporal.server");
        try {
          const user = await requireAdministrator(request);
          const dueSoonDays = await resolveDueSoonDays(user.tenantCode);
          return Response.json({ dueSoonDays });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/entitlement-policy GET] failed", err);
          return Response.json({ error: "Failed to load entitlement policy" }, { status: 500 });
        }
      },

      PUT: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { resolveDueSoonDays } = await import("@/lib/qne/entitlements/temporal.server");
        const { parseDueSoonDaysInput } = await import("@/lib/qne/entitlements/due-soon-policy");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { auditSettings } = await import(
          "@/lib/qne/service-jobs/tenant-settings.server"
        );
        try {
          const user = await requireAdministrator(request);
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const parsed = parseDueSoonDaysInput(body.dueSoonDays);
          if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

          const before = await resolveDueSoonDays(user.tenantCode);
          if (before === parsed.value) {
            // Unchanged save: persist nothing, audit nothing.
            return Response.json({ ok: true, dueSoonDays: before, changed: false });
          }

          const { error } = await supabaseAdmin
            .from("general_settings")
            .upsert(
              { tenant_code: user.tenantCode, due_soon_days: parsed.value },
              { onConflict: "tenant_code" },
            );
          if (error) throw error;

          await auditSettings(
            user.tenantCode,
            AUDIT_AREA,
            "due_soon_days_updated",
            { dueSoonDays: before },
            { dueSoonDays: parsed.value },
            {
              userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
              name: user.displayName || user.email || null,
            },
          );

          const saved = await resolveDueSoonDays(user.tenantCode);
          return Response.json({ ok: true, dueSoonDays: saved, changed: true });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/entitlement-policy PUT] failed", err);
          return Response.json({ error: "Failed to save entitlement policy" }, { status: 500 });
        }
      },
    },
  },
});
