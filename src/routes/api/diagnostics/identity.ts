// GET /api/diagnostics/identity — N3 Identity coverage & recent backfill
// activity for the caller's tenant. Administrator-only.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/diagnostics/identity")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAdministrator(request);
          const tenant = user.tenantCode;

          const countPair = async (table: string, idCol: string) => {
            const [{ count: total }, { count: withId }] = await Promise.all([
              supabaseAdmin.from(table as never).select("id", { count: "exact", head: true }).eq("tenant_code", tenant),
              supabaseAdmin.from(table as never).select("id", { count: "exact", head: true }).eq("tenant_code", tenant).not(idCol, "is", null),
            ]);
            return { total: total ?? 0, with_n3_id: withId ?? 0, without_n3_id: (total ?? 0) - (withId ?? 0) };
          };

          const [customers, stock, mappings, entitlements] = await Promise.all([
            countPair("customer_snapshots", "n3_customer_id"),
            countPair("stock_snapshots", "n3_stock_id"),
            countPair("renewal_stock_mappings", "n3_stock_id"),
            supabaseAdmin
              .from("customer_subscription_snapshots")
              .select("id", { count: "exact", head: true })
              .eq("tenant_code", tenant)
              .then((r) => ({ total: r.count ?? 0 })),
          ]);

          const { data: recentBackfill } = await supabaseAdmin
            .from("snapshot_identity_backfill")
            .select("*")
            .eq("tenant_code", tenant)
            .order("created_at", { ascending: false })
            .limit(20);

          const { data: recentOrchestrations } = await supabaseAdmin
            .from("sync_orchestrations")
            .select("id, overall_status, current_stage, started_at, completed_at, total_duration_ms, safe_error_summary")
            .eq("tenant_code", tenant)
            .order("started_at", { ascending: false })
            .limit(5);

          return Response.json({
            tenantCode: tenant,
            coverage: { customers, stock, renewal_mappings: mappings, entitlements },
            recentBackfill: recentBackfill ?? [],
            recentOrchestrations: recentOrchestrations ?? [],
          });
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
