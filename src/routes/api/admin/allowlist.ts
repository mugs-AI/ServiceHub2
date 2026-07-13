// GET/POST/DELETE /api/admin/allowlist — Administrator-only management of
// the tenant-scoped ServiceHub admin allowlist. Interim gate — see Phase 0.9.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/allowlist")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAdministrator(request);
          const { data, error } = await supabaseAdmin
            .from("service_hub_admins")
            .select("id, email, granted_by, is_bootstrap, created_at")
            .eq("tenant_code", user.tenantCode)
            .order("created_at", { ascending: true });
          if (error) throw error;
          const fallbackEnabled = process.env.SERVICEHUB_ALLOWLIST_FALLBACK === "1";
          return Response.json({ tenantCode: user.tenantCode, admins: data ?? [], fallbackEnabled });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
      POST: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAdministrator(request);
          const body = (await request.json().catch(() => ({}))) as { email?: string };
          const email = String(body.email ?? "").trim();
          if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return Response.json({ error: "Valid email required" }, { status: 400 });
          }
          const { data, error } = await supabaseAdmin
            .from("service_hub_admins")
            .upsert(
              {
                tenant_code: user.tenantCode,
                email,
                granted_by: user.email,
                is_bootstrap: false,
              },
              { onConflict: "tenant_code,email" },
            )
            .select("id, email")
            .single();
          if (error) throw error;
          return Response.json({ ok: true, admin: data });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
      DELETE: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAdministrator(request);
          const url = new URL(request.url);
          const email = (url.searchParams.get("email") ?? "").trim();
          if (!email) {
            return Response.json({ error: "email query param required" }, { status: 400 });
          }
          if (email.toLowerCase() === user.email.toLowerCase()) {
            return Response.json(
              { error: "Cannot remove your own administrator access" },
              { status: 400 },
            );
          }
          const { error } = await supabaseAdmin
            .from("service_hub_admins")
            .delete()
            .eq("tenant_code", user.tenantCode)
            .ilike("email", email);
          if (error) throw error;
          return Response.json({ ok: true });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
