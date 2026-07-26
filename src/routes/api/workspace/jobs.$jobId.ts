// GET    /api/workspace/jobs/$jobId — fetch a Service Job (tenant-scoped).
// DELETE /api/workspace/jobs/$jobId — Admin/Owner soft-delete.
//        Body: { reason: string }. Records job_deleted activity.
//        Non-admin viewers see 404 for deleted jobs; Admin/Owner see the row
//        with is_deleted=true. Job number is never reused.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId")({
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
          const { data, error } = await supabaseAdmin
            .from("service_jobs")
            .select("*")
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (error) throw error;
          if (!data) return Response.json({ error: "Job not found." }, { status: 404 });
          // Non-admin viewers cannot see deleted jobs.
          if (data.is_deleted && !user.isAdministrator) {
            return Response.json({ error: "Job not found." }, { status: 404 });
          }
          // Private approval remark is Owner/Admin only.
          const row = user.isAdministrator
            ? data
            : { ...data, approval_remark_private: null };
          return Response.json({ job: row });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/$jobId GET] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },

      DELETE: async ({ request, params }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAdministrator(request);
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : "";
          if (!reason) {
            return Response.json({ error: "Deletion reason is required." }, { status: 400 });
          }

          const { data: job, error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .select("id, is_deleted, status")
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (jobErr) throw jobErr;
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
          if (job.is_deleted) return Response.json({ ok: true, noop: true });

          const now = new Date().toISOString();
          const actorId = user.diagnostics.matchedN3UserId ?? user.userCode ?? null;
          const actorName = user.displayName || user.email || null;

          const { data: updated, error: upErr } = await supabaseAdmin
            .from("service_jobs")
            .update({
              is_deleted: true,
              deleted_at: now,
              deleted_by_user_id: actorId,
              deleted_by_name_snapshot: actorName,
              deletion_reason: reason,
            })
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .select("*")
            .single();
          if (upErr) throw upErr;

          await supabaseAdmin.from("service_job_activity_log").insert({
            tenant_code: user.tenantCode,
            service_job_id: params.jobId,
            event_type: "job_deleted",
            old_value: job.status,
            new_value: null,
            note: reason,
            performed_by_user_id: actorId,
            performed_by_name_snapshot: actorName,
          });

          return Response.json({ ok: true, job: updated });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/$jobId DELETE] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
