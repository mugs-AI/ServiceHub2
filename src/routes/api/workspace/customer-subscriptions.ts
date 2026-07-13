// GET /api/workspace/customer-subscriptions?customerCode=... — tenant-scoped
// entitlement list for a single customer. Any authenticated N3 user in the
// tenant may read; RLS is enforced server-side via requireAuthenticatedUser.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/customer-subscriptions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAuthenticatedUser(request);
          const url = new URL(request.url);
          const customerCode = (url.searchParams.get("customerCode") ?? "").trim();
          if (!customerCode) {
            return Response.json(
              { error: "Provide a customerCode." },
              { status: 400 },
            );
          }
          const { data, error } = await supabaseAdmin
            .from("customer_subscription_snapshots")
            .select(
              "customer_code, customer_name, subscription_category, stock_code, stock_name, latest_document_no, latest_document_type, latest_document_date, renewal_cycle_value, renewal_cycle_unit, expiry_date, remaining_days, subscription_status, calculation_status, calculation_error, updated_at",
            )
            .eq("tenant_code", user.tenantCode)
            .eq("customer_code", customerCode);
          if (error) throw error;

          // Maintenance first, then alphabetical by category.
          const rows = (data ?? []).sort((a, b) => {
            const aM = (a.subscription_category ?? "").toLowerCase() === "maintenance" ? 0 : 1;
            const bM = (b.subscription_category ?? "").toLowerCase() === "maintenance" ? 0 : 1;
            if (aM !== bM) return aM - bM;
            return (a.subscription_category ?? "").localeCompare(b.subscription_category ?? "");
          });

          return Response.json({
            tenantCode: user.tenantCode,
            customerCode,
            subscriptions: rows,
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/customer-subscriptions] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
