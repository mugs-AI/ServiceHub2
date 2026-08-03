// GET/PUT /api/settings/reports — per-report, per-role report permissions.
// Owner/Administrator only. Server-side enforcement helper lives in
// src/lib/qne/reports/registry.ts (hasCapability / scopeFor).

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/settings/reports")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAuthenticatedN3User(request);
          if (!user.isAdministrator) {
            return Response.json({ error: "Owner access required." }, { status: 403 });
          }
          const { data, error } = await supabaseAdmin
            .from("report_role_permissions")
            .select("*")
            .eq("tenant_code", user.tenantCode);
          if (error) throw error;
          return Response.json({ permissions: data ?? [] });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/reports GET] failed", err);
          return Response.json({ error: "Failed to load report access" }, { status: 500 });
        }
      },

      PUT: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { auditSettings } = await import(
          "@/lib/qne/service-jobs/tenant-settings.server"
        );
        const { REPORT_REGISTRY, REPORT_ROLES, DATA_SCOPES, defaultPermission } = await import(
          "@/lib/qne/reports/registry"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          if (!user.isAdministrator) {
            return Response.json({ error: "Owner access required." }, { status: 403 });
          }
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const code = String(body.report_code ?? "");
          const role = String(body.role ?? "");
          if (!REPORT_REGISTRY.some((r) => r.code === code)) {
            return Response.json({ error: "Unknown report." }, { status: 400 });
          }
          if (!(REPORT_ROLES as readonly string[]).includes(role)) {
            return Response.json({ error: "Unknown role." }, { status: 400 });
          }
          if (role === "administrator") {
            return Response.json(
              { error: "Administrator/Owner always keeps full report access." },
              { status: 400 },
            );
          }
          const base = defaultPermission(code, role as never);
          const patch = (body.permission ?? {}) as Record<string, unknown>;
          const scope = String(patch.data_scope ?? base.data_scope);
          const row = {
            tenant_code: user.tenantCode,
            report_code: code,
            role,
            can_view: Boolean(patch.can_view),
            can_print: Boolean(patch.can_print),
            can_export_excel: Boolean(patch.can_export_excel),
            can_export_csv: Boolean(patch.can_export_csv),
            data_scope: (DATA_SCOPES as readonly string[]).includes(scope) ? scope : "own",
            view_private_notes: Boolean(patch.view_private_notes),
            view_financial: Boolean(patch.view_financial),
            view_gps: Boolean(patch.view_gps),
            updated_at: new Date().toISOString(),
          };
          const { error } = await supabaseAdmin
            .from("report_role_permissions")
            .upsert(row as never, { onConflict: "tenant_code,report_code,role" });
          if (error) throw error;

          await auditSettings(user.tenantCode, "reports_access", "updated", null, row, {
            userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName || user.email || null,
          });
          return Response.json({ ok: true, permission: row });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/reports PUT] failed", err);
          return Response.json({ error: "Failed to save report access" }, { status: 500 });
        }
      },
    },
  },
});
