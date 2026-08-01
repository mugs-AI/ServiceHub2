// GET  /api/workspace/jobs/$jobId/field — current field-operations state
// POST /api/workspace/jobs/$jobId/field — perform an append-only field action
//
// Every action is server-authorized. Pending Approval, Completed, Cancelled and
// deleted jobs are blocked. Work-session duration is server-calculated; the
// browser timer is display only.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/field")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadJob, loadFieldState } = await import(
          "@/lib/qne/service-jobs/field-ops.server"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const job = await loadJob(user.tenantCode, params.jobId);
          const state = await loadFieldState(user.tenantCode, params.jobId, job);

          const [sessions, waiting, notes] = await Promise.all([
            supabaseAdmin
              .from("service_job_work_sessions")
              .select(
                "id, technician_user_id, technician_name_snapshot, started_at, ended_at, status, pause_reason, duration_minutes",
              )
              .eq("tenant_code", user.tenantCode)
              .eq("service_job_id", params.jobId)
              .order("started_at", { ascending: false }),
            supabaseAdmin
              .from("service_job_waiting_periods")
              .select("*")
              .eq("tenant_code", user.tenantCode)
              .eq("service_job_id", params.jobId)
              .order("started_at", { ascending: false }),
            supabaseAdmin
              .from("service_job_work_notes")
              .select("*")
              .eq("tenant_code", user.tenantCode)
              .eq("service_job_id", params.jobId)
              .order("created_at", { ascending: false }),
          ]);
          if (sessions.error) throw sessions.error;
          if (waiting.error) throw waiting.error;
          if (notes.error) throw notes.error;

          const totalMinutes = (sessions.data ?? []).reduce((n, s) => {
            if (s.status === "cancelled") return n;
            if (typeof s.duration_minutes === "number") return n + s.duration_minutes;
            if (s.started_at && s.ended_at) {
              return (
                n +
                Math.max(
                  0,
                  Math.round(
                    (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000,
                  ),
                )
              );
            }
            return n;
          }, 0);

          return Response.json({
            jobStatus: job.status,
            isDeleted: job.is_deleted,
            state: {
              status: state.status,
              is_deleted: state.is_deleted,
              activeSession: state.activeSession,
              openWaiting: state.openWaiting,
              workNoteCount: state.workNoteCount,
            },
            openSession: state.openSession,
            sessions: sessions.data ?? [],
            waiting: waiting.data ?? [],
            notes: notes.data ?? [],
            totalWorkMinutes: totalMinutes,
            serverNow: new Date().toISOString(),
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          const status = (err as { status?: number }).status ?? 500;
          if (status !== 500) {
            return Response.json({ error: (err as Error).message }, { status });
          }
          console.error("[workspace/jobs/field GET] failed", err);
          return Response.json({ error: "Failed to load field state" }, { status: 500 });
        }
      },

      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const {
          loadJob,
          loadFieldState,
          assertFieldPermission,
          logFieldEvent,
          recomputeWorkMinutes,
          sanitizeLocation,
          FieldOpsError,
        } = await import("@/lib/qne/service-jobs/field-ops.server");
        const { fieldActionsBlocked, canReadyForCompletion, FIELD_EVENTS } = await import(
          "@/lib/qne/service-jobs/field-ops"
        );

        try {
          const user = await requireAuthenticatedN3User(request);
          const actor = {
            tenantCode: user.tenantCode,
            userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName || user.email || null,
            isAdmin: Boolean(user.isAdministrator),
          };
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const action = String(body.action ?? "");
          if (!(FIELD_EVENTS as readonly string[]).includes(action)) {
            return Response.json({ error: "Unknown field action." }, { status: 400 });
          }

          const job = await loadJob(actor.tenantCode, params.jobId);
          assertFieldPermission(job, actor);
          const blocked = fieldActionsBlocked({ status: job.status, is_deleted: job.is_deleted });
          if (blocked) return Response.json({ error: blocked }, { status: 400 });

          const state = await loadFieldState(actor.tenantCode, params.jobId, job);
          const now = new Date().toISOString();
          const location = sanitizeLocation(body.location);
          const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null;
          const meta: Record<string, unknown> = {};
          if (location) meta.location = location;

          const tech = {
            technician_user_id: actor.userId ?? "unknown",
            technician_name_snapshot: actor.name,
          };

          async function jobPatch(patch: Record<string, unknown>) {
            const { error } = await supabaseAdmin
              .from("service_jobs")
              .update(patch as never)
              .eq("tenant_code", actor.tenantCode)
              .eq("id", job.id);
            if (error) throw error;
          }

          switch (action) {
            case "travel_started": {
              await jobPatch({ travel_started_at: now });
              break;
            }
            case "arrived_on_site": {
              await jobPatch({ arrived_on_site_at: now });
              break;
            }
            case "work_started": {
              if (state.openSession) {
                throw new FieldOpsError("A work session is already open for this job.", 409);
              }
              const { error } = await supabaseAdmin.from("service_job_work_sessions").insert({
                tenant_code: actor.tenantCode,
                service_job_id: job.id,
                ...tech,
                started_at: now,
                status: "active",
              });
              if (error) {
                throw error.code === "23505"
                  ? new FieldOpsError("You already have an open session on this job.", 409)
                  : error;
              }
              if (job.status !== "In Progress") {
                await jobPatch({ status: "In Progress", started_at: now });
              }
              break;
            }
            case "work_paused": {
              const open = state.openSession;
              if (!open || open.status !== "active") {
                throw new FieldOpsError("No active work session to pause.", 409);
              }
              const { error } = await supabaseAdmin
                .from("service_job_work_sessions")
                .update({ status: "paused", pause_reason: note })
                .eq("tenant_code", actor.tenantCode)
                .eq("id", open.id);
              if (error) throw error;
              break;
            }
            case "work_resumed": {
              const open = state.openSession;
              if (!open || open.status !== "paused") {
                throw new FieldOpsError("No paused work session to resume.", 409);
              }
              const { error } = await supabaseAdmin
                .from("service_job_work_sessions")
                .update({ status: "active", pause_reason: null })
                .eq("tenant_code", actor.tenantCode)
                .eq("id", open.id);
              if (error) throw error;
              break;
            }
            case "waiting_customer_started":
            case "waiting_vendor_started": {
              const type = action === "waiting_customer_started" ? "customer" : "vendor";
              if (state.openWaiting?.[type]) {
                throw new FieldOpsError(`A Waiting ${type} period is already open.`, 409);
              }
              const reason = String(body.reason ?? "").trim();
              if (!reason) throw new FieldOpsError("Reason is required.");
              if (type === "customer" && !String(body.requested_action ?? "").trim()) {
                throw new FieldOpsError("Requested action or information is required.");
              }
              if (type === "vendor" && !String(body.vendor_name ?? "").trim()) {
                throw new FieldOpsError("Vendor name is required.");
              }
              const visibility =
                body.visibility === "visible_to_customer" ? "visible_to_customer" : "internal";
              const str = (v: unknown, n = 300) =>
                typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;
              const dateOnly = (v: unknown) =>
                typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

              // Close any open work session so waiting time is not billed as work.
              if (state.openSession) {
                const started = new Date(state.openSession.started_at).getTime();
                await supabaseAdmin
                  .from("service_job_work_sessions")
                  .update({
                    status: "completed",
                    ended_at: now,
                    duration_minutes: Math.max(
                      0,
                      Math.round((Date.parse(now) - started) / 60000),
                    ),
                  })
                  .eq("tenant_code", actor.tenantCode)
                  .eq("id", state.openSession.id);
              }

              const { error } = await supabaseAdmin.from("service_job_waiting_periods").insert({
                tenant_code: actor.tenantCode,
                service_job_id: job.id,
                waiting_type: type,
                reason: reason.slice(0, 2000),
                requested_action: str(body.requested_action, 2000),
                contact_method: str(body.contact_method, 100),
                follow_up_date: dateOnly(body.follow_up_date),
                vendor_name: str(body.vendor_name),
                vendor_contact: str(body.vendor_contact),
                vendor_reference: str(body.vendor_reference),
                expected_response_date: dateOnly(body.expected_response_date),
                visibility,
                started_at: now,
                started_by_user_id: actor.userId,
                started_by_name_snapshot: actor.name,
              });
              if (error) throw error;
              await jobPatch({
                status: type === "customer" ? "Waiting Customer" : "Waiting Vendor",
              });
              meta.waiting_type = type;
              break;
            }
            case "waiting_customer_resolved":
            case "waiting_vendor_resolved": {
              const type = action === "waiting_customer_resolved" ? "customer" : "vendor";
              const resolution = String(body.resolution_note ?? "").trim();
              if (!resolution) throw new FieldOpsError("Resolution note is required.");
              const { data: open, error: findErr } = await supabaseAdmin
                .from("service_job_waiting_periods")
                .select("id")
                .eq("tenant_code", actor.tenantCode)
                .eq("service_job_id", job.id)
                .eq("waiting_type", type)
                .is("resolved_at", null)
                .maybeSingle();
              if (findErr) throw findErr;
              if (!open) throw new FieldOpsError(`No open Waiting ${type} period.`, 409);
              const { error } = await supabaseAdmin
                .from("service_job_waiting_periods")
                .update({
                  resolved_at: now,
                  resolved_by_user_id: actor.userId,
                  resolved_by_name_snapshot: actor.name,
                  resolution_note: resolution.slice(0, 2000),
                })
                .eq("tenant_code", actor.tenantCode)
                .eq("id", open.id);
              if (error) throw error;
              await jobPatch({ status: "In Progress" });
              meta.waiting_type = type;
              break;
            }
            case "ready_for_completion": {
              const gate = canReadyForCompletion(state);
              if (!gate.ok) throw new FieldOpsError(gate.reason ?? "Not ready for completion.");
              await jobPatch({ ready_for_completion_at: now });
              break;
            }
            default:
              throw new FieldOpsError("Unsupported action.");
          }

          await recomputeWorkMinutes(actor.tenantCode, job.id);
          await logFieldEvent(actor, job.id, action as never, {
            note,
            metadata: Object.keys(meta).length ? meta : null,
          });

          return Response.json({ ok: true, at: now });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          const status = (err as { status?: number }).status;
          if (typeof status === "number") {
            return Response.json({ error: (err as Error).message }, { status });
          }
          console.error("[workspace/jobs/field POST] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
