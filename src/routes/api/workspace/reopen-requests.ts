// GET /api/workspace/reopen-requests — pending Job reopen requests for the
// caller's tenant.
//
// Tenant is resolved server-side from the authenticated N3 session; the
// browser never supplies a tenant. Only status = 'pending' rows are returned —
// approved and rejected requests stay in the Job timeline, never in this queue.
// Approving or rejecting still happens at the Job's own Owner/Admin-only
// endpoint; this route is read-only.

import { createFileRoute } from "@tanstack/react-router";

function trim(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export const Route = createFileRoute("/api/workspace/reopen-requests")({
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
          const q = trim(sp.get("q"), 100);
          const priority = trim(sp.get("priority"), 20);
          const page = Math.max(Number(sp.get("page") ?? 1) || 1, 1);
          const pageSize = Math.min(Math.max(Number(sp.get("pageSize") ?? 50) || 50, 1), 200);

          const { data, error } = await supabaseAdmin
            .from("service_job_reopen_requests")
            .select(
              "id, service_job_id, reason, requested_at, requested_by_name_snapshot, prior_status, status",
            )
            .eq("tenant_code", user.tenantCode)
            .eq("status", "pending")
            .order("requested_at", { ascending: false })
            .limit(500);
          if (error) throw error;

          const rows = data ?? [];
          if (rows.length === 0) {
            return Response.json({ requests: [], total: 0, page, pageSize });
          }

          const { data: jobs, error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .select(
              "id, job_number, subject, status, priority, customer_code_snapshot, customer_name_snapshot, assigned_user_name_snapshot, is_deleted",
            )
            .eq("tenant_code", user.tenantCode)
            .in(
              "id",
              rows.map((r) => r.service_job_id),
            );
          if (jobErr) throw jobErr;

          const jobById = new Map((jobs ?? []).map((j) => [j.id, j]));

          let merged = rows
            .map((r) => {
              const j = jobById.get(r.service_job_id);
              if (!j || j.is_deleted) return null;
              return {
                request_id: r.id,
                service_job_id: r.service_job_id,
                job_number: j.job_number,
                subject: j.subject,
                customer_code: j.customer_code_snapshot,
                customer_name: j.customer_name_snapshot,
                job_status: j.status,
                priority: j.priority,
                assigned_user_name: j.assigned_user_name_snapshot,
                requested_by_name: r.requested_by_name_snapshot,
                requested_at: r.requested_at,
                reason: r.reason,
                prior_status: r.prior_status,
              };
            })
            .filter((r): r is NonNullable<typeof r> => r !== null);

          if (priority) merged = merged.filter((r) => r.priority === priority);
          if (q) {
            const needle = q.toLowerCase();
            merged = merged.filter((r) =>
              [r.job_number, r.subject, r.customer_name ?? "", r.customer_code]
                .join(" ")
                .toLowerCase()
                .includes(needle),
            );
          }

          const total = merged.length;
          const paged = merged.slice((page - 1) * pageSize, page * pageSize);
          return Response.json({ requests: paged, total, page, pageSize });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/reopen-requests] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
