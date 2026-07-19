// GET /api/workspace/jobs/$jobId/history — append-only assignment history.
// Any authenticated tenant user may view (read-only visibility for the job).

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/history")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          // Tenant-scope check: ensure the job belongs to this tenant.
          const { data: job, error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .select("id")
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (jobErr) throw jobErr;
          if (!job) {
            return Response.json({ error: "Job not found." }, { status: 404 });
          }

          const { data, error } = await supabaseAdmin
            .from("service_job_assignment_history")
            .select("*")
            .eq("tenant_code", user.tenantCode)
            .eq("service_job_id", params.jobId)
            .order("performed_at", { ascending: false })
            .limit(200);
          if (error) throw error;
          return Response.json({ history: data ?? [] });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/history GET] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
