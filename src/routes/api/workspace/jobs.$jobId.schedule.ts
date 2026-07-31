// POST   /api/workspace/jobs/$jobId/schedule  — schedule or reschedule an appointment
// DELETE /api/workspace/jobs/$jobId/schedule  — unschedule (clear the appointment)
//
// Body (POST): { start: ISO, end: ISO, reason?: string, force?: boolean }
// Appointments are stored in UTC; the browser converts Malaysia local input.
// Double-booking of the SAME technician returns 409 with the conflicting jobs
// unless `force: true` (recorded as a `conflict_override` history entry).

import { createFileRoute } from "@tanstack/react-router";

import { canScheduleJob, SCHEDULE_TZ, validateWindow } from "@/lib/qne/service-jobs/scheduling";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/schedule")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAuthenticatedN3User(request);
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const start = typeof body.start === "string" ? body.start : null;
          const end = typeof body.end === "string" ? body.end : null;
          const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;
          const force = body.force === true;

          const check = validateWindow(start, end);
          if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

          const { data: job, error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .select(
              "id, job_number, status, is_deleted, assigned_user_id, assigned_user_name_snapshot, scheduled_start_at, scheduled_end_at",
            )
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (jobErr) throw jobErr;
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });

          if (job.status === "Pending Approval" && !user.isAdministrator) {
            return Response.json(
              {
                error:
                  "This Job is waiting for Owner/Admin approval. Scheduling is locked until approval.",
              },
              { status: 400 },
            );
          }
          const allowed = canScheduleJob(job);
          if (!allowed.ok) return Response.json({ error: allowed.reason }, { status: 400 });
          if (!job.assigned_user_id) {
            return Response.json(
              { error: "Assign a technician before scheduling this job." },
              { status: 400 },
            );
          }

          // Conflict detection — same technician, overlapping window, live jobs only.
          const { data: clash, error: clashErr } = await supabaseAdmin
            .from("service_jobs")
            .select(
              "id, job_number, subject, scheduled_start_at, scheduled_end_at, status, customer_name_snapshot",
            )
            .eq("tenant_code", user.tenantCode)
            .eq("assigned_user_id", job.assigned_user_id)
            .eq("is_deleted", false)
            .neq("id", job.id)
            .not("scheduled_start_at", "is", null)
            .lt("scheduled_start_at", end!)
            .gt("scheduled_end_at", start!)
            .not("status", "in", '("Completed","Cancelled")')
            .order("scheduled_start_at", { ascending: true })
            .limit(20);
          if (clashErr) throw clashErr;

          if ((clash?.length ?? 0) > 0 && !force) {
            return Response.json(
              {
                error: "This technician already has an appointment in that time window.",
                conflicts: clash,
              },
              { status: 409 },
            );
          }

          const nowIso = new Date().toISOString();
          const wasScheduled = Boolean(job.scheduled_start_at);
          const { data: updated, error: upErr } = await supabaseAdmin
            .from("service_jobs")
            .update({
              scheduled_start_at: start,
              scheduled_end_at: end,
              scheduled_timezone: SCHEDULE_TZ,
              schedule_status: "Scheduled",
              scheduled_by_user_id: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
              scheduled_by_name_snapshot: user.displayName || user.email || null,
              scheduled_at: wasScheduled ? undefined : nowIso,
              schedule_updated_at: nowIso,
            })
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .select("*")
            .single();
          if (upErr) throw upErr;

          const action = (clash?.length ?? 0) > 0 && force
            ? "conflict_override"
            : wasScheduled
              ? "rescheduled"
              : "scheduled";

          await supabaseAdmin.from("service_job_schedule_history").insert({
            tenant_code: user.tenantCode,
            service_job_id: params.jobId,
            previous_start_at: job.scheduled_start_at,
            previous_end_at: job.scheduled_end_at,
            new_start_at: start,
            new_end_at: end,
            previous_technician_user_id: job.assigned_user_id,
            new_technician_user_id: job.assigned_user_id,
            action,
            reason,
            changed_by_user_id: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            changed_by_name_snapshot: user.displayName || user.email || null,
          });

          await supabaseAdmin.from("service_job_activity_log").insert({
            tenant_code: user.tenantCode,
            service_job_id: params.jobId,
            event_type: action === "rescheduled" ? "schedule_changed" : "schedule_set",
            old_value: job.scheduled_start_at,
            new_value: start,
            note: reason,
            performed_by_user_id: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            performed_by_name_snapshot: user.displayName || user.email || null,
          });

          return Response.json({
            ok: true,
            job: updated,
            overrode: action === "conflict_override",
            conflicts: clash ?? [],
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/schedule] POST failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },

      DELETE: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAuthenticatedN3User(request);
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;

          const { data: job, error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .select(
              "id, status, is_deleted, assigned_user_id, scheduled_start_at, scheduled_end_at",
            )
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (jobErr) throw jobErr;
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
          if (job.is_deleted) {
            return Response.json({ error: "Deleted job cannot be modified." }, { status: 400 });
          }
          if (!job.scheduled_start_at) {
            return Response.json({ ok: true, noop: true });
          }
          if (job.status === "Pending Approval" && !user.isAdministrator) {
            return Response.json(
              { error: "Scheduling is locked while this job waits for approval." },
              { status: 400 },
            );
          }

          const { data: updated, error: upErr } = await supabaseAdmin
            .from("service_jobs")
            .update({
              scheduled_start_at: null,
              scheduled_end_at: null,
              schedule_status: "Unscheduled",
              schedule_updated_at: new Date().toISOString(),
            })
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .select("*")
            .single();
          if (upErr) throw upErr;

          await supabaseAdmin.from("service_job_schedule_history").insert({
            tenant_code: user.tenantCode,
            service_job_id: params.jobId,
            previous_start_at: job.scheduled_start_at,
            previous_end_at: job.scheduled_end_at,
            new_start_at: null,
            new_end_at: null,
            previous_technician_user_id: job.assigned_user_id,
            new_technician_user_id: job.assigned_user_id,
            action: "unscheduled",
            reason,
            changed_by_user_id: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            changed_by_name_snapshot: user.displayName || user.email || null,
          });

          await supabaseAdmin.from("service_job_activity_log").insert({
            tenant_code: user.tenantCode,
            service_job_id: params.jobId,
            event_type: "schedule_cleared",
            old_value: job.scheduled_start_at,
            new_value: null,
            note: reason,
            performed_by_user_id: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            performed_by_name_snapshot: user.displayName || user.email || null,
          });

          return Response.json({ ok: true, job: updated });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/schedule] DELETE failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
