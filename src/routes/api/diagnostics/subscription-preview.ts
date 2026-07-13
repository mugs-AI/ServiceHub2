// GET /api/diagnostics/subscription-preview — first 25 subscription snapshot
// rows for the caller's tenant. Administrator-only.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/diagnostics/subscription-preview")({
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
            .from("customer_subscription_snapshots")
            .select(
              "customer_code, customer_name, subscription_category, stock_code, latest_document_no, latest_source_type, latest_document_date, expiry_date, remaining_days, subscription_status",
            )
            .eq("tenant_code", user.tenantCode)
            .order("subscription_category", { ascending: true })
            .order("customer_code", { ascending: true })
            .limit(25);
          if (error) throw error;
          return Response.json({ tenantCode: user.tenantCode, rows: data ?? [] });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[diagnostics/subscription-preview] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
