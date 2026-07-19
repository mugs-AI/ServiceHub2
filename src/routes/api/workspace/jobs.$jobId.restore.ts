// POST /api/workspace/jobs/$jobId/restore — Admin/Owner only.
// Reverses a soft delete. Records job_restored activity. Prior status
// remains unchanged (we never rewrote it on delete).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/restore")({
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
          const { data: job, error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .select("id, is_deleted, status")
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (jobErr) throw jobErr;
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
          if (!job.is_deleted) return Response.json({ ok: true, noop: true });

          const actorId = user.diagnostics.matchedN3UserId ?? user.userCode ?? null;
          const actorName = user.displayName || user.email || null;

          const { data: updated, error: upErr } = await supabaseAdmin
            .from("service_jobs")
            .update({
              is_deleted: false,
              deleted_at: null,
              deleted_by_user_id: null,
              deleted_by_name_snapshot: null,
              deletion_reason: null,
            })
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .select("*")
            .single();
          if (upErr) throw upErr;

          await supabaseAdmin.from("service_job_activity_log").insert({
            tenant_code: user.tenantCode,
            service_job_id: params.jobId,
            event_type: "job_restored",
            old_value: null,
            new_value: job.status,
            performed_by_user_id: actorId,
            performed_by_name_snapshot: actorName,
          });

          return Response.json({ ok: true, job: updated });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/restore] failed", err);
          return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
        }
      },
    },
  },
});
