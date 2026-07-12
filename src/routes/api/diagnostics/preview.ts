// GET /api/diagnostics/preview — first 10 tenant-scoped snapshot rows for
// each snapshot type + a mapping-config count. Read-only, admin console use.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/diagnostics/preview")({
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

          const [customersRes, stockRes, contractsRes, mappingsRes] = await Promise.all([
            supabaseAdmin
              .from("customer_snapshots")
              .select(
                "customer_code, customer_name, contact_person, phone, email, n3_status, tenant_code, last_synced_at",
                { count: "exact" },
              )
              .eq("tenant_code", tenant)
              .order("customer_code", { ascending: true })
              .limit(10),
            supabaseAdmin
              .from("stock_snapshots")
              .select(
                "stock_code, stock_name, description, is_active, tenant_code, last_synced_at",
                { count: "exact" },
              )
              .eq("tenant_code", tenant)
              .order("stock_code", { ascending: true })
              .limit(10),
            supabaseAdmin
              .from("customer_contract_snapshots")
              .select(
                "customer_code, latest_document_no, latest_document_date, latest_document_type, renewal_stock_code, contract_days, contract_start_date, expiry_date, remaining_days, contract_status, is_stale, calculation_error, tenant_code, last_calculated_at",
                { count: "exact" },
              )
              .eq("tenant_code", tenant)
              .order("customer_code", { ascending: true })
              .limit(10),
            supabaseAdmin
              .from("renewal_stock_mappings")
              .select("stock_code", { count: "exact", head: true })
              .eq("tenant_code", tenant)
              .eq("is_active", true),
          ]);

          return Response.json({
            tenantCode: tenant,
            customers: {
              total: customersRes.count ?? 0,
              rows: customersRes.data ?? [],
              error: customersRes.error?.message ?? null,
            },
            stock: {
              total: stockRes.count ?? 0,
              rows: stockRes.data ?? [],
              error: stockRes.error?.message ?? null,
            },
            contracts: {
              total: contractsRes.count ?? 0,
              rows: contractsRes.data ?? [],
              error: contractsRes.error?.message ?? null,
            },
            mappings: {
              activeCount: mappingsRes.count ?? 0,
              error: mappingsRes.error?.message ?? null,
            },
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[diagnostics/preview] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Preview failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
