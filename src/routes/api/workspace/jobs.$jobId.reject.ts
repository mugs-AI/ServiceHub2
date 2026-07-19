// POST /api/workspace/jobs/$jobId/reject — Admin/Owner only.
// Moves Pending Approval → Cancelled. Reason required.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/reject")({
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
          const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : "";
          if (!reason) return Response.json({ error: "Rejection reason is required." }, { status: 400 });

          const { data: job, error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .select("id, status, is_deleted")
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (jobErr) throw jobErr;
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
          if (job.is_deleted) return Response.json({ error: "Deleted job cannot be modified." }, { status: 400 });
          if (job.status !== "Pending Approval") {
            return Response.json({ error: "Only Pending Approval jobs can be rejected." }, { status: 400 });
          }

          const now = new Date().toISOString();
          const actor = {
            id: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName || user.email || null,
          };
          const { data: updated, error: upErr } = await supabaseAdmin
            .from("service_jobs")
            .update({
              status: "Cancelled",
              rejected_at: now,
              rejected_by_user_id: actor.id,
              rejected_by_name_snapshot: actor.name,
              rejection_reason: reason,
              cancelled_at: now,
              cancelled_by_user_id: actor.id,
              cancelled_by_name_snapshot: actor.name,
              cancellation_reason: reason,
            })
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .select("*")
            .single();
          if (upErr) throw upErr;

          await supabaseAdmin.from("service_job_activity_log").insert({
            tenant_code: user.tenantCode,
            service_job_id: params.jobId,
            event_type: "approval_rejected",
            old_value: "Pending Approval",
            new_value: "Cancelled",
            note: reason,
            performed_by_user_id: actor.id,
            performed_by_name_snapshot: actor.name,
          });

          return Response.json({ ok: true, job: updated });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/reject] failed", err);
          return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
        }
      },
    },
  },
});
