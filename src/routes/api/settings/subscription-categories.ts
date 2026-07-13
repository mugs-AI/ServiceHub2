// Administrator-only Subscription Categories API (tenant-scoped master).
//
// GET    /api/settings/subscription-categories       → list categories
// POST   /api/settings/subscription-categories       → add { name }
// PATCH  /api/settings/subscription-categories       → update { id, name?, is_active?, display_order? }
// DELETE /api/settings/subscription-categories?id=…  → remove (non-system only)
//
// Tenant is always resolved from the authenticated N3 session. Never trust
// browser-supplied tenant_code. System-seeded categories cannot be deleted
// but may be disabled.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/settings/subscription-categories")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { ensureDefaultCategories } = await import("@/lib/qne/sync/index.server");
        try {
          const user = await requireAdministrator(request);
          await ensureDefaultCategories(user.tenantCode);
          const { data, error } = await supabaseAdmin
            .from("subscription_categories")
            .select("id, name, display_order, is_active, is_system, updated_at")
            .eq("tenant_code", user.tenantCode)
            .order("display_order", { ascending: true })
            .order("name", { ascending: true });
          if (error) throw error;
          return Response.json({ rows: data ?? [] });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/subscription-categories GET] failed", err);
          return Response.json({ error: "Categories unavailable." }, { status: 500 });
        }
      },

      POST: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAdministrator(request);
          const body = (await request.json().catch(() => ({}))) as {
            name?: string;
            display_order?: number;
          };
          const name = String(body.name ?? "").trim();
          if (!name) {
            return Response.json({ error: "name is required" }, { status: 400 });
          }
          const { data, error } = await supabaseAdmin
            .from("subscription_categories")
            .insert({
              tenant_code: user.tenantCode,
              name,
              display_order:
                typeof body.display_order === "number" ? body.display_order : 100,
              is_system: false,
              is_active: true,
            })
            .select("id, name, display_order, is_active, is_system")
            .single();
          if (error) {
            if (error.code === "23505") {
              return Response.json(
                { error: "A category with that name already exists." },
                { status: 409 },
              );
            }
            throw error;
          }
          return Response.json({ ok: true, category: data });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/subscription-categories POST] failed", err);
          return Response.json(
            { error: "Category could not be saved." },
            { status: 500 },
          );
        }
      },

      PATCH: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAdministrator(request);
          const body = (await request.json().catch(() => ({}))) as {
            id?: string;
            name?: string;
            is_active?: boolean;
            display_order?: number;
          };
          if (!body.id) {
            return Response.json({ error: "id is required" }, { status: 400 });
          }
          const patch: {
            updated_at: string;
            name?: string;
            is_active?: boolean;
            display_order?: number;
          } = { updated_at: new Date().toISOString() };
          if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
          if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
          if (typeof body.display_order === "number") patch.display_order = body.display_order;
          const { error } = await supabaseAdmin
            .from("subscription_categories")
            .update(patch)
            .eq("tenant_code", user.tenantCode)
            .eq("id", body.id);
          if (error) throw error;
          return Response.json({ ok: true });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/subscription-categories PATCH] failed", err);
          return Response.json(
            { error: "Category could not be updated." },
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
          const id = (url.searchParams.get("id") ?? "").trim();
          if (!id) return Response.json({ error: "id required" }, { status: 400 });
          // Refuse to delete a system-seeded category; disable instead.
          const { data: existing } = await supabaseAdmin
            .from("subscription_categories")
            .select("is_system")
            .eq("tenant_code", user.tenantCode)
            .eq("id", id)
            .maybeSingle();
          if (existing?.is_system) {
            return Response.json(
              { error: "System category cannot be removed. Disable it instead." },
              { status: 400 },
            );
          }
          const { error } = await supabaseAdmin
            .from("subscription_categories")
            .delete()
            .eq("tenant_code", user.tenantCode)
            .eq("id", id);
          if (error) throw error;
          return Response.json({ ok: true });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/subscription-categories DELETE] failed", err);
          return Response.json(
            { error: "Category could not be removed." },
            { status: 500 },
          );
        }
      },
    },
  },
});
