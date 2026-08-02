// POST /api/workspace/jobs/$jobId/complete — final software-service completion
// GET  /api/workspace/jobs/$jobId/complete — completion record + tenant ack rule
//
// Completion is validated server-side against the tenant's Completion &
// Acknowledgement settings, writes an immutable snapshot and is idempotent:
// a second attempt on a Completed Job is rejected.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/complete")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadJob } = await import("@/lib/qne/service-jobs/field-ops.server");
        const { loadTenantSettings } = await import(
          "@/lib/qne/service-jobs/tenant-settings.server"
        );
        const { ackRequirement } = await import("@/lib/qne/service-jobs/tenant-settings");
        try {
          const user = await requireAuthenticatedN3User(request);
          const job = await loadJob(user.tenantCode, params.jobId);
          const settings = await loadTenantSettings(user.tenantCode);
          const rule = ackRequirement(
            settings.completion,
            job.support_mode,
            job.subscription_category_snapshot,
          );
          const { data, error } = await supabaseAdmin
            .from("service_job_completions")
            .select("*")
            .eq("tenant_code", user.tenantCode)
            .eq("service_job_id", params.jobId)
            .order("created_at", { ascending: false })
            .limit(1);
          if (error) throw error;
          return Response.json({
            completion: data?.[0] ?? null,
            settings: settings.completion,
            requirement: rule,
            canWaive: Boolean(user.isAdministrator) && settings.completion.allowAdminWaiver,
            jobStatus: job.status,
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[complete GET] failed", err);
          return Response.json({ error: "Failed to load completion" }, { status: 500 });
        }
      },

      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadJob, loadFieldState, assertFieldPermission, logFieldEvent } = await import(
          "@/lib/qne/service-jobs/field-ops.server"
        );
        const { validateCompletion } = await import("@/lib/qne/service-jobs/field-ops");
        const { loadTenantSettings } = await import(
          "@/lib/qne/service-jobs/tenant-settings.server"
        );
        const { ackRequirement } = await import("@/lib/qne/service-jobs/tenant-settings");

        try {
          const user = await requireAuthenticatedN3User(request);
          const actor = {
            tenantCode: user.tenantCode,
            userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName || user.email || null,
            isAdmin: Boolean(user.isAdministrator),
          };
          const job = await loadJob(actor.tenantCode, params.jobId);
          assertFieldPermission(job, actor);

          if (job.is_deleted) {
            return Response.json({ error: "Deleted jobs cannot be completed." }, { status: 400 });
          }
          if (job.status === "Completed") {
            return Response.json({ error: "This Job is already completed." }, { status: 409 });
          }
          if (job.status === "Cancelled" || job.status === "Pending Approval") {
            return Response.json(
              { error: `${job.status} jobs cannot be completed.` },
              { status: 400 },
            );
          }

          const draft = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const state = await loadFieldState(actor.tenantCode, params.jobId, job);
          const settings = await loadTenantSettings(actor.tenantCode);
          const rule = ackRequirement(
            settings.completion,
            job.support_mode,
            job.subscription_category_snapshot,
          );

          const check = validateCompletion(draft as never, state, {
            required: rule.required,
            reason: rule.reason,
            allowedMethods: settings.completion.allowedMethods,
            allowWaiver: settings.completion.allowAdminWaiver,
            actorCanWaive: actor.isAdmin,
          });
          if (!check.ok) {
            return Response.json({ error: check.errors.join(" "), errors: check.errors }, {
              status: 400,
            });
          }

          const now = new Date().toISOString();
          const text = (v: unknown, n = 4000) =>
            typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;
          const waived =
            draft.ack_method === "admin_waiver" || draft.signature_waived === true;

          // Gather everything the immutable report needs.
          const [notes, sessions, waiting, attachments] = await Promise.all([
            supabaseAdmin
              .from("service_job_work_notes")
              .select("*")
              .eq("tenant_code", actor.tenantCode)
              .eq("service_job_id", job.id)
              .order("created_at", { ascending: true }),
            supabaseAdmin
              .from("service_job_work_sessions")
              .select("*")
              .eq("tenant_code", actor.tenantCode)
              .eq("service_job_id", job.id)
              .order("started_at", { ascending: true }),
            supabaseAdmin
              .from("service_job_waiting_periods")
              .select("*")
              .eq("tenant_code", actor.tenantCode)
              .eq("service_job_id", job.id)
              .order("started_at", { ascending: true }),
            supabaseAdmin
              .from("service_job_attachments")
              .select("id, file_name, attachment_type, mime_type, file_size, visibility, created_at")
              .eq("tenant_code", actor.tenantCode)
              .eq("service_job_id", job.id)
              .eq("is_deleted", false)
              .order("created_at", { ascending: true }),
          ]);

          const completionRow = {
            tenant_code: actor.tenantCode,
            service_job_id: job.id,
            checklist: (draft.checklist ?? []) as never,
            diagnosis: text(draft.diagnosis),
            resolution_summary: text(draft.resolution_summary),
            work_performed: text(draft.work_performed),
            action_taken: text(draft.work_performed),
            test_result: text(draft.test_result),
            software_module: text(draft.software_module, 300),
            version_after: text(draft.version_after, 120),
            internal_completion_note: text(draft.internal_completion_note),
            outstanding_issue: text(draft.outstanding_issue),
            follow_up_required: Boolean(draft.follow_up_required),
            follow_up_date:
              typeof draft.follow_up_date === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(draft.follow_up_date)
                ? draft.follow_up_date
                : null,
            ack_method: waived ? "admin_waiver" : text(draft.ack_method, 60),
            ack_evidence_reference: text(draft.ack_evidence_reference, 300),
            ack_customer_name: text(draft.ack_customer_name, 200),
            ack_customer_role: text(draft.ack_customer_role, 200),
            ack_remark: text(draft.ack_remark),
            ack_confirmed: Boolean(draft.ack_confirmed) && !waived,
            ack_at: draft.ack_confirmed && !waived ? now : null,
            signature_data_url: waived ? null : text(draft.signature_data_url, 400000),
            signature_signed_at: !waived && draft.signature_data_url ? now : null,
            signature_waived: waived,
            signature_waiver_reason: waived ? text(draft.signature_waiver_reason) : null,
            signature_waived_by_user_id: waived ? actor.userId : null,
            signature_waived_by_name_snapshot: waived ? actor.name : null,
            is_final: true,
          };

          const { data: saved, error: saveErr } = await supabaseAdmin
            .from("service_job_completions")
            .insert(completionRow as never)
            .select("*")
            .single();
          if (saveErr) throw saveErr;

          const snapshot = {
            version: 1,
            captured_at: now,
            job: {
              id: job.id,
              job_number: job.job_number,
              support_mode: job.support_mode,
              travel_started_at: job.travel_started_at,
              arrived_on_site_at: job.arrived_on_site_at,
              left_site_at: job.left_site_at,
              scheduled_start_at: job.scheduled_start_at,
              scheduled_end_at: job.scheduled_end_at,
              assigned_user_name_snapshot: job.assigned_user_name_snapshot,
            },
            completion: saved,
            work_notes: notes.data ?? [],
            work_sessions: sessions.data ?? [],
            waiting_periods: waiting.data ?? [],
            attachments: attachments.data ?? [],
            completed_by_user_id: actor.userId,
            completed_by_name_snapshot: actor.name,
            completed_at: now,
          };

          const { error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .update({
              status: "Completed",
              completed_at: now,
              completion_snapshot: snapshot as never,
            })
            .eq("tenant_code", actor.tenantCode)
            .eq("id", job.id)
            .neq("status", "Completed");
          if (jobErr) throw jobErr;

          await logFieldEvent(actor, job.id, "job_completed", {
            oldValue: job.status,
            newValue: "Completed",
            note: completionRow.resolution_summary,
            metadata: { ack_method: completionRow.ack_method, waived },
          });

          return Response.json({ ok: true, completedAt: now });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          const status = (err as { status?: number }).status;
          if (typeof status === "number") {
            return Response.json({ error: (err as Error).message }, { status });
          }
          console.error("[complete POST] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed to complete job" },
            { status: 500 },
          );
        }
      },
    },
  },
});
