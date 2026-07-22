// POST /api/workspace/jobs/$jobId/priority — change a job's priority.
// Body: { priority: "High" | "Medium" | "Low" }
// - Any authenticated tenant user may change priority.
// - Blocked on deleted, Completed or Cancelled jobs.
// - Records a `priority_changed` activity log entry so the Timeline shows
//   "Priority changed from X to Y".

import { createFileRoute } from "@tanstack/react-router";

const ALLOWED = ["High", "Medium", "Low"] as const;
type Priority = (typeof ALLOWED)[number];

export const Route = createFileRoute("/api/workspace/jobs/$jobId/priority")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const next = String(body.priority ?? "").trim() as Priority;
          if (!ALLOWED.includes(next)) {
            return Response.json({ error: "Invalid priority." }, { status: 400 });
          }

          const { data: job, error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .select("id, status, priority, is_deleted")
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (jobErr) throw jobErr;
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
          if (job.is_deleted) {
            return Response.json({ error: "Deleted job cannot be modified." }, { status: 400 });
          }
          if (job.status === "Completed" || job.status === "Cancelled") {
            return Response.json(
              { error: `Priority is locked on ${job.status} jobs.` },
              { status: 400 },
            );
          }
          if (job.priority === next) {
            return Response.json({ ok: true, noop: true, job });
          }

          const { data: updated, error: upErr } = await supabaseAdmin
            .from("service_jobs")
            .update({ priority: next })
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .select("*")
            .single();
          if (upErr) throw upErr;

          await supabaseAdmin.from("service_job_activity_log").insert({
            tenant_code: user.tenantCode,
            service_job_id: params.jobId,
            event_type: "priority_changed",
            old_value: job.priority,
            new_value: next,
            note: null,
            performed_by_user_id:
              user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            performed_by_name_snapshot: user.displayName || user.email || null,
          });

          return Response.json({ ok: true, job: updated });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/priority] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
