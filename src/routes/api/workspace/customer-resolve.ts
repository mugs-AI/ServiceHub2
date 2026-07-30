// GET /api/workspace/customer-resolve?customerId=<n3 id>|customerCode=<code>
//
// Resolves ONE customer snapshot for contextual deep links (Workspace →
// New Service Job). Tenant is derived server-side from the session and the
// customer is validated against that tenant; the immutable N3 customer id is
// accepted as input but never echoed back to the browser.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/customer-resolve")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAuthenticatedN3User(request);
          const sp = new URL(request.url).searchParams;
          const customerId = (sp.get("customerId") ?? "").trim();
          const customerCode = (sp.get("customerCode") ?? "").trim();
          if (!customerId && !customerCode) {
            return Response.json(
              { error: "Provide customerId or customerCode." },
              { status: 400 },
            );
          }

          let query = supabaseAdmin
            .from("customer_snapshots")
            .select(
              "n3_customer_id, customer_code, customer_name, contact_person, phone, email, address",
            )
            .eq("tenant_code", user.tenantCode)
            .limit(5);
          query = customerId
            ? query.eq("n3_customer_id", customerId)
            : query.eq("customer_code", customerCode);

          const { data, error } = await query;
          if (error) throw error;
          const row = (data ?? [])[0];
          if (!row) {
            return Response.json(
              { error: "Customer not found for this tenant." },
              { status: 404 },
            );
          }
          const { n3_customer_id: _id, ...safe } = row;
          return Response.json({ customer: safe });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/customer-resolve] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
