// GET /api/workspace/jobs/summary — customer Service Job counts for the
// current tenant. Tenant is derived server-side; browser input for
// tenant is ignored. Optional date range narrows results by created_at.

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
          const from = trim(sp.get("from"), 40);
          const to = trim(sp.get("to"), 40);

          const base = () => {
            let q = supabaseAdmin
              .from("service_jobs")
              .select("id", { count: "exact", head: true })
              .eq("tenant_code", user.tenantCode);
            if (customerCode) q = q.eq("customer_code_snapshot", customerCode);
            if (from) q = q.gte("created_at", from);
            if (to) q = q.lte("created_at", to);
            return q;
          };

          const [totalR, activeR, pendingR, assignedR, completedR] =
            await Promise.all([
              base(),
              base().in("status", ["Draft", "Pending Approval", "Assigned", "In Progress"]),
              base().eq("status", "Pending Approval"),
              base().not("assigned_user_id", "is", null),
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
