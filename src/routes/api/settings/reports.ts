// GET/PUT /api/settings/reports — WP4 Inquiry & Export Access.
// Owner/Administrator only. Configures ONLY the two WP5 inquiry keys for the
// Normal User role; Owner/Admin access is immutable and never stored.
// Enforcement for WP5 lives in src/lib/qne/inquiry/permissions.server.ts.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/settings/reports")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } =
          await import("@/lib/qne/session/current-user.server");
        const { loadInquiryRows } = await import("@/lib/qne/inquiry/permissions.server");
        const { INQUIRY_KEYS, INQUIRY_LABEL, permissionFromRow, OWNER_ADMIN_ACCESS } =
          await import("@/lib/qne/inquiry/permissions");
        try {
          const user = await requireAuthenticatedN3User(request);
          if (!user.isAdministrator) {
            return Response.json({ error: "Owner access required." }, { status: 403 });
          }
          const rows = await loadInquiryRows(user.tenantCode);
          return Response.json({
            inquiries: INQUIRY_KEYS.map((key) => ({
              key,
              label: INQUIRY_LABEL[key],
              ownerAdmin: OWNER_ADMIN_ACCESS,
              normalUser: permissionFromRow(rows.find((r) => r.report_code === key)),
            })),
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/reports GET] failed", err);
          return Response.json({ error: "Failed to load inquiry access" }, { status: 500 });
        }
      },

      PUT: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } =
          await import("@/lib/qne/session/current-user.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { auditSettings } = await import("@/lib/qne/service-jobs/tenant-settings.server");
        const { loadInquiryRows } = await import("@/lib/qne/inquiry/permissions.server");
        const { isInquiryKey, validateInquiryPermission, permissionFromRow, NORMAL_USER_ROLE } =
          await import("@/lib/qne/inquiry/permissions");
        try {
          const user = await requireAuthenticatedN3User(request);
          if (!user.isAdministrator) {
            return Response.json({ error: "Owner access required." }, { status: 403 });
          }
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          if (!isInquiryKey(body.key)) {
            return Response.json({ error: "Unknown inquiry." }, { status: 400 });
          }
          if (body.role !== undefined && body.role !== NORMAL_USER_ROLE) {
            return Response.json(
              { error: "Only Normal User access can be configured. Owner/Admin is always full." },
              { status: 400 },
            );
          }
          const checked = validateInquiryPermission(body.permission);
          if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });
          const key = body.key;
          const next = checked.value;

          const before = permissionFromRow(
            (await loadInquiryRows(user.tenantCode)).find((r) => r.report_code === key),
          );
          const row = {
            tenant_code: user.tenantCode,
            report_code: key,
            role: NORMAL_USER_ROLE,
            can_view: next.can_view,
            can_print: false,
            can_export_excel: next.can_export_excel,
            can_export_csv: false,
            data_scope: next.scope,
            view_private_notes: next.view_private_notes,
            view_financial: false,
            view_gps: next.view_gps,
            updated_at: new Date().toISOString(),
          };
          const { error } = await supabaseAdmin
            .from("report_role_permissions")
            .upsert(row as never, { onConflict: "tenant_code,report_code,role" });
          if (error) throw error;

          await auditSettings(
            user.tenantCode,
            "inquiry_access",
            "updated",
            { key, role: NORMAL_USER_ROLE, ...before },
            { key, role: NORMAL_USER_ROLE, ...next },
            {
              userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
              name: user.displayName || user.email || null,
            },
          );
          return Response.json({ ok: true, key, normalUser: next });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/reports PUT] failed", err);
          return Response.json({ error: "Failed to save inquiry access" }, { status: 500 });
        }
      },
    },
  },
});
