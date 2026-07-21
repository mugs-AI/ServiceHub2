// POST /api/workspace/jobs/$jobId/status — transition workflow status.
// Body: { to: JobStatus, note?: string, reason?: string }
// - Validates transition against workflow.server rules.
// - Cancellation requires `reason`.
// - Records service_job_activity_log entry.
// - Deleted jobs cannot be transitioned.
// - Approve/Reject use dedicated endpoints (not /status).

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/status")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { canTransition, ALL_STATUSES } = await import(
          "@/lib/qne/service-jobs/workflow.server"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const to = String(body.to ?? "").trim();
          const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null;
          const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : null;
          if (!ALL_STATUSES.includes(to as (typeof ALL_STATUSES)[number])) {
            return Response.json({ error: "Invalid target status." }, { status: 400 });
          }

          const { data: job, error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .select("id, tenant_code, status, is_deleted, requires_approval, assigned_user_id")
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (jobErr) throw jobErr;
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
          if (job.is_deleted) {
            return Response.json({ error: "Deleted job cannot be modified." }, { status: 400 });
          }

          // Pending Approval cannot advance except via approve/reject.
          if (job.status === "Pending Approval" && to !== "Cancelled") {
            return Response.json(
              { error: "Pending Approval jobs must be approved or rejected." },
              { status: 400 },
            );
          }
          // Draft → Open requires no active approval flag; but /status is
          // fine because approval status is decided at job create time.
          if (job.status === "Draft" && to === "Open" && job.requires_approval) {
            return Response.json(
              { error: "This draft still requires approval." },
              { status: 400 },
            );
          }
          // Coordinate: a Draft with a technician must move to Assigned, not Open.
          let effectiveTo = to;
          if (job.status === "Draft" && to === "Open" && job.assigned_user_id) {
            effectiveTo = "Assigned";
          }
          // A Draft without a technician cannot go directly to Assigned.
          if (job.status === "Draft" && effectiveTo === "Assigned" && !job.assigned_user_id) {
            return Response.json(
              { error: "Assign a technician before moving this draft to Assigned." },
              { status: 400 },
            );
          }
          if (!canTransition(job.status, effectiveTo)) {
            return Response.json(
              { error: `Cannot transition from ${job.status} to ${effectiveTo}.` },
              { status: 400 },
            );
          }
          if (effectiveTo === "Cancelled" && !reason) {
            return Response.json(
              { error: "Cancellation reason is required." },
              { status: 400 },
            );
          }

          const now = new Date().toISOString();
          const performer = {
            performed_by_user_id:
              user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            performed_by_name_snapshot: user.displayName || user.email || null,
          };

          const patch: {
            status: string;
            started_at?: string;
            completed_at?: string;
            cancelled_at?: string;
            cancellation_reason?: string;
            cancelled_by_user_id?: string | null;
            cancelled_by_name_snapshot?: string | null;
          } = { status: effectiveTo };
          if (effectiveTo === "In Progress") patch.started_at = now;
          if (effectiveTo === "Completed") patch.completed_at = now;
          if (effectiveTo === "Cancelled") {
            patch.cancelled_at = now;
            patch.cancellation_reason = reason ?? undefined;
            patch.cancelled_by_user_id = performer.performed_by_user_id;
            patch.cancelled_by_name_snapshot = performer.performed_by_name_snapshot;
          }

          const { data: updated, error: upErr } = await supabaseAdmin
            .from("service_jobs")
            .update(patch)
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .select("*")
            .single();
          if (upErr) throw upErr;

          await supabaseAdmin.from("service_job_activity_log").insert({
            tenant_code: user.tenantCode,
            service_job_id: params.jobId,
            event_type: effectiveTo === "Cancelled" ? "job_cancelled" : "status_changed",
            old_value: job.status,
            new_value: effectiveTo,
            note: reason ?? note,
            ...performer,
          });

          return Response.json({ ok: true, job: updated });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/status] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
