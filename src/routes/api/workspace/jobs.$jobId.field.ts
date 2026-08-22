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

          const {
            computeWorkMinutes,
            availableFieldActions,
            canMutateField,
            canSetSupportMode,
            fieldActionsBlocked,
          } = await import("@/lib/qne/service-jobs/field-ops");
          const totalMinutes = computeWorkMinutes((sessions.data ?? []) as never);


          const { loadTenantSettings } = await import(
            "@/lib/qne/service-jobs/tenant-settings.server"
          );
          const settings = await loadTenantSettings(user.tenantCode);

          const actorUserId = user.diagnostics.matchedN3UserId ?? user.userCode ?? null;
          const isAdmin = Boolean(user.isAdministrator);
          const canMutate = canMutateField(
            { assigned_user_id: job.assigned_user_id },
            { isAdmin, actorUserId },
          );
          const supportModeGate = canSetSupportMode(
            { assigned_user_id: job.assigned_user_id, support_mode: job.support_mode },
            { isAdmin, actorUserId },
            {
              sessionCount: state.sessionCount,
              waitingCount: state.waitingCount,
              workNoteCount: state.workNoteCount ?? 0,
              travelStartedAt: job.travel_started_at,
              arrivedAt: job.arrived_on_site_at,
            },
          );

          return Response.json({
            jobStatus: job.status,
            isDeleted: job.is_deleted,
            job: {
              support_mode: job.support_mode,
              travel_started_at: job.travel_started_at,
              arrived_on_site_at: job.arrived_on_site_at,
              left_site_at: job.left_site_at,
              ready_for_completion_at: job.ready_for_completion_at,
              assigned_user_name_snapshot: job.assigned_user_name_snapshot,
              scheduled_start_at: job.scheduled_start_at,
              scheduled_end_at: job.scheduled_end_at,
              assigned_user_id: job.assigned_user_id,
            },
            gps: settings.travelGps,
            attachmentSettings: settings.attachments,
            state: {
              status: state.status,
              is_deleted: state.is_deleted,
              supportMode: state.supportMode,
              activeSession: state.activeSession,
              openWaiting: state.openWaiting,
              workNoteCount: state.workNoteCount,
              travelStartedAt: state.travelStartedAt,
              arrivedAt: state.arrivedAt,
              leftAt: state.leftAt,
            },
            permissions: {
              canMutate,
              canSetSupportMode: supportModeGate.ok,
              supportModeLockReason: supportModeGate.ok ? null : supportModeGate.reason,
            },
            blockedReason: fieldActionsBlocked({
              status: state.status,
              is_deleted: state.is_deleted,
              supportMode: state.supportMode,
            }),
            availableActions: availableFieldActions(state),
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
        const {
          fieldActionsBlocked,
          canReadyForCompletion,
          canSetSupportMode,
          actionAllowedForMode,
          FIELD_EVENTS,
        } = await import("@/lib/qne/service-jobs/field-ops");
        const { isSupportMode, SUPPORT_MODE_LABEL } = await import(
          "@/lib/qne/service-jobs/support-mode"
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
          const isSupportModeSet = action === "support_mode_set";
          if (!isSupportModeSet && !(FIELD_EVENTS as readonly string[]).includes(action)) {
            return Response.json({ error: "Unknown field action." }, { status: 400 });
          }

          const job = await loadJob(actor.tenantCode, params.jobId);
          assertFieldPermission(job, actor);
          const state = await loadFieldState(actor.tenantCode, params.jobId, job);

          // Support mode repair path — Primary PIC / Admin only, audited, and
          // locked once material field evidence exists.
          if (isSupportModeSet) {
            const lifecycleBlocked = fieldActionsBlocked({
              status: job.status,
              is_deleted: job.is_deleted,
            });
            if (lifecycleBlocked) {
              return Response.json({ error: lifecycleBlocked }, { status: 400 });
            }
            const next = String(body.support_mode ?? "");
            if (!isSupportMode(next)) {
              return Response.json({ error: "Invalid support mode." }, { status: 400 });
            }
            const gate = canSetSupportMode(
              { assigned_user_id: job.assigned_user_id, support_mode: job.support_mode },
              { isAdmin: actor.isAdmin, actorUserId: actor.userId },
              {
                sessionCount: state.sessionCount,
                waitingCount: state.waitingCount,
                workNoteCount: state.workNoteCount ?? 0,
                travelStartedAt: job.travel_started_at,
                arrivedAt: job.arrived_on_site_at,
              },
            );
            if (!gate.ok) {
              return Response.json({ error: gate.reason }, { status: 409 });
            }
            const { error: updErr } = await supabaseAdmin
              .from("service_jobs")
              .update({ support_mode: next })
              .eq("tenant_code", actor.tenantCode)
              .eq("id", job.id);
            if (updErr) throw updErr;
            await logFieldEvent(actor, job.id, "support_mode_set" as never, {
              oldValue: job.support_mode,
              newValue: next,
              note: `Support mode set to ${SUPPORT_MODE_LABEL[next]}`,
            });
            return Response.json({ ok: true, support_mode: next });
          }

          const blocked = fieldActionsBlocked({
            status: job.status,
            is_deleted: job.is_deleted,
            supportMode: job.support_mode ?? null,
          });
          if (blocked) return Response.json({ error: blocked }, { status: 400 });

          // Remote / onsite applicability is decided from the STORED mode.
          const modeError = actionAllowedForMode(action as never, job.support_mode);
          if (modeError) return Response.json({ error: modeError }, { status: 400 });


          const now = new Date().toISOString();
          const location = sanitizeLocation(body.location);
          const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null;
          const meta: Record<string, unknown> = {};
          if (location) meta.location = location;

          // Tenant Travel & GPS policy — never silently collect, never block
          // remote work, and require an exception reason when mandated.
          const { loadTenantSettings } = await import(
            "@/lib/qne/service-jobs/tenant-settings.server"
          );
          const { gpsRequestFor } = await import("@/lib/qne/service-jobs/tenant-settings");
          const tenantSettings = await loadTenantSettings(actor.tenantCode);
          const gpsNeed = gpsRequestFor(tenantSettings.travelGps, action, job.support_mode);
          const gpsException =
            typeof body.gps_exception_reason === "string"
              ? body.gps_exception_reason.trim().slice(0, 500)
              : "";
          if (gpsNeed === "required" && !location) {
            if (!gpsException) {
              return Response.json(
                {
                  error:
                    "Location is required for this action. Allow location access or provide an exception reason.",
                  code: "gps_required",
                },
                { status: 400 },
              );
            }
            meta.gps_exception_reason = gpsException;
          }
          if (tenantSettings.travelGps.mode === "off") delete meta.location;

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

          // Close the currently open work segment and record its minutes.
          // The write is conditioned on the exact persisted row state; a
          // zero-row result means another request already moved the segment
          // and this one is stale.
          async function closeActiveSegment(
            finalStatus: "paused" | "completed",
            reason: string | null,
          ) {
            const open = state.openSession;
            if (!open) throw new FieldOpsError("No active work session.", 409);
            const minutes = Math.max(
              0,
              Math.round((Date.parse(now) - Date.parse(open.started_at)) / 60000),
            );
            const { data, error } = await supabaseAdmin
              .from("service_job_work_sessions")
              .update({
                status: finalStatus,
                ended_at: now,
                duration_minutes: minutes,
                pause_reason: finalStatus === "paused" ? reason : null,
              })
              .eq("tenant_code", actor.tenantCode)
              .eq("service_job_id", job.id)
              .eq("id", open.id)
              .eq("status", "active")
              .is("ended_at", null)
              .select("id");
            if (error) throw error;
            if (!data || data.length === 0) {
              throw new FieldOpsError(
                "The work session changed in another session. Refresh and try again.",
                409,
              );
            }
            return minutes;
          }

          // Close ONLY the current/latest paused state marker. Historical
          // paused rows stay untouched as field evidence.
          async function closeCurrentPausedSegment() {
            const pausedId = state.pausedSessionId;
            if (!pausedId) {
              throw new FieldOpsError("No paused work session.", 409);
            }
            const { data, error } = await supabaseAdmin
              .from("service_job_work_sessions")
              .update({ status: "completed" })
              .eq("tenant_code", actor.tenantCode)
              .eq("service_job_id", job.id)
              .eq("id", pausedId)
              .eq("status", "paused")
              .select("id");
            if (error) throw error;
            if (!data || data.length === 0) {
              throw new FieldOpsError(
                "The work session changed in another session. Refresh and try again.",
                409,
              );
            }
          }

          // A unique-index violation means another request already opened the
          // single allowed active segment for this Job.
          function asConflict(error: { code?: string } | null) {
            if (error && error.code === "23505") {
              return new FieldOpsError(
                "A work session is already open for this job.",
                409,
              );
            }
            return error as unknown as Error | null;
          }

          switch (action) {
            case "travel_started": {
              if (job.travel_started_at) {
                throw new FieldOpsError("Travel has already been recorded for this Job.", 409);
              }
              await jobPatch({ travel_started_at: now, travel_note: note });
              break;
            }
            case "arrived_on_site": {
              if (job.arrived_on_site_at) {
                throw new FieldOpsError("Arrival has already been recorded for this Job.", 409);
              }
              await jobPatch({ arrived_on_site_at: now, arrival_note: note });
              if (job.travel_started_at) {
                meta.travel_minutes = Math.max(
                  0,
                  Math.round((Date.parse(now) - Date.parse(job.travel_started_at)) / 60000),
                );
              }
              break;
            }
            case "leave_site": {
              if (!job.arrived_on_site_at) {
                throw new FieldOpsError("Record Arrived On Site before leaving.", 409);
              }
              if (job.left_site_at) {
                throw new FieldOpsError("Leaving site has already been recorded.", 409);
              }
              await jobPatch({ left_site_at: now, leave_note: note });
              meta.onsite_minutes = Math.max(
                0,
                Math.round((Date.parse(now) - Date.parse(job.arrived_on_site_at)) / 60000),
              );
              break;
            }
            case "work_started": {
              if (state.activeSession) {
                throw new FieldOpsError(
                  state.activeSession.status === "paused"
                    ? "Work is paused — resume it instead of starting new work."
                    : "A work session is already open for this job.",
                  409,
                );
              }
              const { error } = await supabaseAdmin.from("service_job_work_sessions").insert({
                tenant_code: actor.tenantCode,
                service_job_id: job.id,
                ...tech,
                started_at: now,
                status: "active",
              });
              if (error) throw asConflict(error);
              if (job.status !== "In Progress") {
                await jobPatch({ status: "In Progress", started_at: now });
              }
              break;
            }
            case "work_paused": {
              if (state.activeSession?.status !== "active" || !state.openSession) {
                throw new FieldOpsError("No active work session to pause.", 409);
              }
              // Pause closes the billable segment; the paused interval itself
              // is never stored and therefore can never be billed.
              meta.segment_minutes = await closeActiveSegment("paused", note);
              break;
            }
            case "work_resumed": {
              if (state.activeSession?.status !== "paused") {
                throw new FieldOpsError("No paused work session to resume.", 409);
              }
              const { error } = await supabaseAdmin.from("service_job_work_sessions").insert({
                tenant_code: actor.tenantCode,
                service_job_id: job.id,
                ...tech,
                started_at: now,
                status: "active",
              });
              if (error) throw asConflict(error);
              break;
            }
            case "work_stopped": {
              if (!state.activeSession) {
                throw new FieldOpsError("No open work session to stop.", 409);
              }
              if (state.openSession) {
                meta.segment_minutes = await closeActiveSegment("completed", null);
              } else {
                // Already paused: the billable segment is already closed, so
                // only the current paused state marker is completed.
                await closeCurrentPausedSegment();
              }
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
              if (type === "vendor") {
                if (!String(body.vendor_name ?? "").trim()) {
                  throw new FieldOpsError("Vendor / Principal name is required.");
                }
                if (!String(body.vendor_ticket_number ?? "").trim()) {
                  throw new FieldOpsError("Vendor Ticket Number is required.");
                }
              }
              const visibility =
                body.visibility === "visible_to_customer" ? "visible_to_customer" : "internal";
              const str = (v: unknown, n = 300) =>
                typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;
              const dateOnly = (v: unknown) =>
                typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

              // Waiting must stop billable work: close the active segment and
              // leave no paused segment behind.
              if (state.openSession) {
                await closeActiveSegment("completed", null);
              } else if (state.activeSession?.status === "paused") {
                await closeCurrentPausedSegment();
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
                vendor_ticket_number: str(body.vendor_ticket_number, 120),
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
              if (type === "vendor" && !String(body.vendor_response ?? "").trim()) {
                throw new FieldOpsError("Vendor response is required.");
              }
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
                  ...(type === "vendor"
                    ? {
                        vendor_response:
                          typeof body.vendor_response === "string"
                            ? body.vendor_response.trim().slice(0, 2000)
                            : null,
                      }
                    : {}),
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
