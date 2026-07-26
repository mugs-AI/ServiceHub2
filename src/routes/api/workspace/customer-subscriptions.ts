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
          const user = await requireAuthenticatedN3User(request);
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
              "id, customer_code, customer_name, subscription_category, stock_code, stock_name, latest_document_no, latest_source_type, latest_document_date, renewal_cycle_value, renewal_cycle_unit, expiry_date, remaining_days, subscription_status, calculation_error, updated_at",
            )
            .eq("tenant_code", user.tenantCode)
            .eq("customer_code", customerCode)
            // Phase 1.1.7a Fix A — Workspace is operational. Show only live
            // entitlements. Inactive / superseded / voided rows remain in
            // the database (Document Verifier still surfaces them) but must
            // not appear on the Customer workspace.
            .in("subscription_status", ["Active", "Due Soon", "Overdue"]);
          if (error) throw error;

          // Maintenance first, then alphabetical by category. Within a
          // category: Active, Due Soon, Overdue, Unknown; then earliest
          // expiry first; then stock_code A–Z.
          const statusOrder: Record<string, number> = {
            active: 0,
            "due soon": 1,
            overdue: 2,
            unknown: 3,
          };
          const rows = (data ?? []).sort((a, b) => {
            const aM = (a.subscription_category ?? "").toLowerCase() === "maintenance" ? 0 : 1;
            const bM = (b.subscription_category ?? "").toLowerCase() === "maintenance" ? 0 : 1;
            if (aM !== bM) return aM - bM;
            const catCmp = (a.subscription_category ?? "").localeCompare(
              b.subscription_category ?? "",
            );
            if (catCmp !== 0) return catCmp;
            const aS = statusOrder[(a.subscription_status ?? "unknown").toLowerCase()] ?? 4;
            const bS = statusOrder[(b.subscription_status ?? "unknown").toLowerCase()] ?? 4;
            if (aS !== bS) return aS - bS;
            const aE = a.expiry_date ? new Date(a.expiry_date).getTime() : Number.POSITIVE_INFINITY;
            const bE = b.expiry_date ? new Date(b.expiry_date).getTime() : Number.POSITIVE_INFINITY;
            if (aE !== bE) return aE - bE;
            return (a.stock_code ?? "").localeCompare(b.stock_code ?? "");
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
