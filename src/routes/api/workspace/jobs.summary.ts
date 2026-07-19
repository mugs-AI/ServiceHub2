// GET /api/workspace/jobs/summary — ALL-TIME customer Service Job counts
// for the current tenant.
//
// Feature Pack B §10 definitions (do not change without updating tests):
//   Service Jobs      = all non-deleted for customer
//   Active            = non-deleted AND status IN
//                       (Open, Assigned, In Progress,
//                        Waiting Customer, Waiting Vendor)
//   Pending Approval  = non-deleted AND status = 'Pending Approval'
//   Assigned          = non-deleted AND assigned_user_id IS NOT NULL
//                       AND status NOT IN (Completed, Cancelled)
//   Completed         = non-deleted AND status = 'Completed'
//   Draft & Cancelled included in total, NOT in Active.
//
// IMPORTANT: this endpoint MUST ignore any date filters. Date filters apply
// only to the Job List endpoint. See Feature Pack A → B fix.

import { createFileRoute } from "@tanstack/react-router";

function trim(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export const Route = createFileRoute("/api/workspace/jobs/summary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const sp = new URL(request.url).searchParams;
          const customerCode = trim(sp.get("customerCode"), 100);

          const base = () => {
            let q = supabaseAdmin
              .from("service_jobs")
              .select("id", { count: "exact", head: true })
              .eq("tenant_code", user.tenantCode)
              .eq("is_deleted", false);
            if (customerCode) q = q.eq("customer_code_snapshot", customerCode);
            return q;
          };

          const [totalR, activeR, pendingR, assignedR, completedR] = await Promise.all([
            base(),
            base().in("status", [
              "Open",
              "Assigned",
              "In Progress",
              "Waiting Customer",
              "Waiting Vendor",
            ]),
            base().eq("status", "Pending Approval"),
            base()
              .not("assigned_user_id", "is", null)
              .not("status", "in", "(Completed,Cancelled)"),
            base().eq("status", "Completed"),
          ]);
          for (const r of [totalR, activeR, pendingR, assignedR, completedR]) {
            if (r.error) throw r.error;
          }

          return Response.json({
            total: totalR.count ?? 0,
            active: activeR.count ?? 0,
            pendingApproval: pendingR.count ?? 0,
            assigned: assignedR.count ?? 0,
            completed: completedR.count ?? 0,
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/summary GET] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
