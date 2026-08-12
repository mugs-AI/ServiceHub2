// POST /api/workspace/jobs/$jobId/claim — Self-claim / reassign-to-me.
//
// A support person may claim a job for themselves without going through an
// administrator. The identity is derived from the validated N3 session —
// never trusted from the browser.
//
// Eligible source jobs (per spec):
//   Open · Unassigned | Assigned to another technician
//   Waiting Customer  | Waiting Vendor
//
// Forbidden: Draft, Pending Approval, Completed, Cancelled, Deleted.
//
// Status transitions:
//   Open  -> Assigned
//   Assigned/Waiting Customer/Waiting Vendor -> unchanged
//
// Writes:
//   service_jobs (assignee snapshot)
//   service_job_assignment_history (append-only)
//   service_job_activity_log ("assigned"/"reassigned"; auto-status if any)

import { createFileRoute } from "@tanstack/react-router";

import { evaluateClaim } from "@/lib/qne/service-jobs/permissions";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/claim")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } =
          await import("@/lib/qne/session/current-user.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAuthenticatedN3User(request);
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const takeoverReason =
            typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : null;
          const myUserId = user.diagnostics.matchedN3UserId;
          if (!myUserId) {
            return Response.json(
              {
                error:
                  "Your account is not linked to an N3 user. Ask an administrator to grant access before claiming jobs.",
              },
              { status: 403 },
            );
          }

          const { data: job, error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .select(
              "id, tenant_code, status, is_deleted, assigned_user_id, assigned_user_name_snapshot",
            )
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (jobErr) throw jobErr;
          if (!job) {
            return Response.json({ error: "Job not found." }, { status: 404 });
          }
          if (job.assigned_user_id === myUserId) {
            return Response.json({
              ok: true,
              noop: true,
              message: "This job is already assigned to you.",
              job,
            });
          }

          // WP0E — takeover policy: eligible statuses only, and replacing
          // another Primary PIC requires an explicit reason. The new PIC is
          // always the authenticated user; no target id is accepted.
          const decision = evaluateClaim({
            status: job.status,
            isDeleted: job.is_deleted,
            assignedUserId: job.assigned_user_id ?? null,
            actorUserId: myUserId,
            reason: takeoverReason,
          });
          if (!decision.ok) {
            return Response.json({ error: decision.error }, { status: 400 });
          }

          const nameSnap = user.displayName || user.email || myUserId;
          const emailSnap = user.email || null;
          const userNameSnap = user.userCode || null;

          const previousUserId = job.assigned_user_id ?? null;
          const previousName = job.assigned_user_name_snapshot ?? null;
          const action = decision.action;

          const now = new Date().toISOString();
          const oldStatus = job.status as string;
          const nextStatus = oldStatus === "Open" ? "Assigned" : oldStatus;

          const { data: updated, error: upErr } = await supabaseAdmin
            .from("service_jobs")
            .update({
              status: nextStatus,
              assigned_user_id: myUserId,
              assigned_user_name_snapshot: nameSnap,
              assigned_user_code_snapshot: userNameSnap,
              assigned_user_email_snapshot: emailSnap,
              assigned_at: now,
              assigned_by_user_id: myUserId,
              assigned_by_name_snapshot: nameSnap,
            })
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .select("*")
            .single();
          if (upErr) throw upErr;

          const { error: hErr } = await supabaseAdmin
            .from("service_job_assignment_history")
            .insert({
              tenant_code: user.tenantCode,
              service_job_id: params.jobId,
              action,
              assigned_user_id: myUserId,
              assigned_user_name_snapshot: nameSnap,
              assigned_user_code_snapshot: userNameSnap,
              assigned_user_email_snapshot: emailSnap,
              previous_assigned_user_id: previousUserId,
              previous_assigned_user_name_snapshot: previousName,
              performed_by_user_id: myUserId,
              performed_by_name_snapshot: nameSnap,
              performed_at: now,
            });
          if (hErr) throw hErr;

          if (action === "reassigned") {
            await supabaseAdmin.from("service_job_activity_log").insert({
              tenant_code: user.tenantCode,
              service_job_id: params.jobId,
              event_type: "reassigned",
              old_value: previousName ?? previousUserId,
              new_value: nameSnap,
              note: `Primary PIC takeover: ${takeoverReason}`,
              performed_by_user_id: myUserId,
              performed_by_name_snapshot: nameSnap,
            });
          }

          if (nextStatus !== oldStatus) {
            await supabaseAdmin.from("service_job_activity_log").insert({
              tenant_code: user.tenantCode,
              service_job_id: params.jobId,
              event_type: "status_changed",
              old_value: oldStatus,
              new_value: nextStatus,
              note: "Auto-advanced on self-claim.",
              performed_by_user_id: myUserId,
              performed_by_name_snapshot: nameSnap,
            });
          }

          return Response.json({ ok: true, action, job: updated });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/claim] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
