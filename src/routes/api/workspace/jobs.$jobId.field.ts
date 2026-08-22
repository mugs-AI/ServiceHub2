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

      // Every state-sensitive field mutation is executed inside one
      // transactional RPC that locks the Job row, so competing actions on the
      // same Job are serialized and a conflict leaves no partial state and no
      // success audit. This route only authenticates, validates request shape
      // and tenant GPS policy, then maps RPC outcomes to HTTP statuses.
      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadJob, assertFieldPermission, sanitizeLocation, FieldOpsError } = await import(
          "@/lib/qne/service-jobs/field-ops.server"
        );
        const { FIELD_EVENTS } = await import("@/lib/qne/service-jobs/field-ops");
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

          // Read-only pre-checks. The RPC re-validates everything under the
          // Job row lock; these only give fast, friendly failures.
          const job = await loadJob(actor.tenantCode, params.jobId);
          assertFieldPermission(job, actor);

          const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null;
          const meta: Record<string, unknown> = {};
          const payload: Record<string, unknown> = { note };

          if (isSupportModeSet) {
            const next = String(body.support_mode ?? "");
            if (!isSupportMode(next)) {
              return Response.json({ error: "Invalid support mode." }, { status: 400 });
            }
            payload.support_mode = next;
            payload.mode_note = `Support mode set to ${SUPPORT_MODE_LABEL[next]}`;
          } else {
            const location = sanitizeLocation(body.location);
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

            // Request-shape validation for waiting periods (business fields).
            const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
            if (action === "waiting_customer_started" || action === "waiting_vendor_started") {
              if (!str(body.reason)) throw new FieldOpsError("Reason is required.");
              if (action === "waiting_customer_started" && !str(body.requested_action)) {
                throw new FieldOpsError("Requested action or information is required.");
              }
              if (action === "waiting_vendor_started") {
                if (!str(body.vendor_name)) {
                  throw new FieldOpsError("Vendor / Principal name is required.");
                }
                if (!str(body.vendor_ticket_number)) {
                  throw new FieldOpsError("Vendor Ticket Number is required.");
                }
              }
              Object.assign(payload, {
                reason: str(body.reason),
                requested_action: str(body.requested_action),
                contact_method: str(body.contact_method),
                follow_up_date: str(body.follow_up_date),
                vendor_name: str(body.vendor_name),
                vendor_ticket_number: str(body.vendor_ticket_number),
                vendor_contact: str(body.vendor_contact),
                vendor_reference: str(body.vendor_reference),
                expected_response_date: str(body.expected_response_date),
                visibility:
                  body.visibility === "visible_to_customer" ? "visible_to_customer" : "internal",
              });
            }
            if (action === "waiting_customer_resolved" || action === "waiting_vendor_resolved") {
              if (!str(body.resolution_note)) {
                throw new FieldOpsError("Resolution note is required.");
              }
              if (action === "waiting_vendor_resolved" && !str(body.vendor_response)) {
                throw new FieldOpsError("Vendor response is required.");
              }
              payload.resolution_note = str(body.resolution_note);
              payload.vendor_response = str(body.vendor_response);
            }
          }

          if (Object.keys(meta).length) payload.meta = meta;

          // Atomic, Job-serialized mutation. Tenant, actor and Admin authority
          // are server-resolved facts — never browser input.
          const { data, error } = await supabaseAdmin.rpc("sh_field_mutate", {
            p_tenant_code: actor.tenantCode,
            p_job_id: params.jobId,
            p_action: action,
            p_actor_user_id: actor.userId,
            p_actor_name: actor.name,
            p_is_admin: actor.isAdmin,
            p_payload: payload as never,
          });
          if (error) throw error;
          const result = (data ?? {}) as {
            outcome?: string;
            status?: number;
            error?: string;
            at?: string;
            support_mode?: string;
            total_work_minutes?: number;
          };
          if (result.outcome !== "ok") {
            return Response.json(
              { error: result.error ?? "Field action failed." },
              { status: result.status ?? 409 },
            );
          }

          return Response.json({
            ok: true,
            at: result.at ?? new Date().toISOString(),
            ...(result.support_mode ? { support_mode: result.support_mode } : {}),
            ...(typeof result.total_work_minutes === "number"
              ? { totalWorkMinutes: result.total_work_minutes }
              : {}),
          });
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

