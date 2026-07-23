// POST /api/workspace/jobs/$jobId/purge — Admin/Owner permanent deletion.
// Body: { confirm: string } — must exactly equal the job's job_number.
// Cascades removal of activity log, comments and assignment history.
// This IS irreversible. Job numbers are still never reused because the
// per-tenant date sequence never rolls back.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/purge")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAdministrator(request);
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const confirm = typeof body.confirm === "string" ? body.confirm.trim() : "";

          const { data: job, error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .select("id, job_number")
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (jobErr) throw jobErr;
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });

          if (confirm !== job.job_number) {
            return Response.json(
              { error: "Confirmation text does not match the job number." },
              { status: 400 },
            );
          }

          // Remove children first (no FK ON DELETE CASCADE assumed).
          const scope = { tenant_code: user.tenantCode };
          for (const table of [
            "service_job_activity_log",
            "service_job_comments",
            "service_job_assignment_history",
          ] as const) {
            const { error } = await supabaseAdmin
              .from(table)
              .delete()
              .match({ ...scope, service_job_id: params.jobId });
            if (error) throw error;
          }
          const { error: delErr } = await supabaseAdmin
            .from("service_jobs")
            .delete()
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId);
          if (delErr) throw delErr;

          return Response.json({ ok: true, purged_job_number: job.job_number });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/purge] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
