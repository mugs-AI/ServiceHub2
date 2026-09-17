// GET  /api/workspace/jobs/$jobId/onsite-attendance — WP2C read model
// POST /api/workspace/jobs/$jobId/onsite-attendance — GPS Clock In / Clock Out
//
// Dedicated WP2C surface: the legacy Field Operations endpoint
// (jobs.$jobId.field.ts) is untouched and stays frozen.
//
// Identity is never taken from the request body — tenant and actor come from
// the authenticated N3 session only, so an Admin cannot clock another user
// in or out.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/onsite-attendance")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const {
          loadAttendanceJob,
          loadJobVisits,
          loadActorOpenVisit,
        } = await import("@/lib/qne/service-jobs/onsite-attendance.server");
        const { attendanceBlockedReason, visibleVisits, canViewAllVisits, actorState } =
          await import("@/lib/qne/service-jobs/onsite-attendance");
        try {
          const user = await requireAuthenticatedN3User(request);
          const actorUserId = user.diagnostics.matchedN3UserId ?? user.userCode ?? null;
          const isAdmin = Boolean(user.isAdministrator);
          const job = await loadAttendanceJob(user.tenantCode, params.jobId);

          const rows = await loadJobVisits(user.tenantCode, params.jobId);
          const viewer = { actorUserId, isAdmin, assignedUserId: job.assigned_user_id };
          const visits = visibleVisits(rows, viewer);
          const state = actorState(rows, actorUserId);
          const openElsewhere =
            actorUserId && !state.openVisit
              ? await loadActorOpenVisit(user.tenantCode, actorUserId)
              : null;

          return Response.json({
            jobNumber: job.job_number,
            blockedReason: attendanceBlockedReason(job),
            canAct: !!actorUserId,
            canViewAll: canViewAllVisits(viewer),
            visits,
            openVisit: state.openVisit,
            lastCompleted: state.lastCompleted,
            openOnOtherJob: openElsewhere
              ? { jobNumber: openElsewhere.job_number_snapshot ?? null }
              : null,
            serverNow: new Date().toISOString(),
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          const status = (err as { status?: number }).status;
          if (typeof status === "number" && status !== 500) {
            return Response.json({ error: (err as Error).message }, { status });
          }
          console.error("[onsite-attendance GET] failed", err);
          return Response.json({ error: "Failed to load attendance" }, { status: 500 });
        }
      },

      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { loadAttendanceJob, mutateAttendance } = await import(
          "@/lib/qne/service-jobs/onsite-attendance.server"
        );
        const { attendanceBlockedReason, validateCapture, isLocationCaptured } = await import(
          "@/lib/qne/service-jobs/onsite-attendance"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const actor = {
            tenantCode: user.tenantCode,
            userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName || user.email || null,
            code: user.userCode ?? null,
            email: user.email ?? null,
            isAdmin: Boolean(user.isAdministrator),
          };
          if (!actor.userId) {
            return Response.json({ error: "Your user could not be resolved." }, { status: 401 });
          }

          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const action = String(body.action ?? "");
          if (action !== "clock_in" && action !== "clock_out") {
            return Response.json({ error: "Unknown attendance action." }, { status: 400 });
          }

          const job = await loadAttendanceJob(actor.tenantCode, params.jobId);
          const blocked = attendanceBlockedReason(job);
          if (blocked) return Response.json({ error: blocked }, { status: 409 });

          const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
          const capture = {
            gps_result: String(body.gps_result ?? "unavailable") as never,
            latitude: num(body.latitude),
            longitude: num(body.longitude),
            accuracy: num(body.accuracy),
            exception_reason:
              typeof body.exception_reason === "string"
                ? body.exception_reason.trim().slice(0, 500)
                : "",
          };
          const check = validateCapture(capture);
          if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

          const captured = isLocationCaptured(capture);
          const result = await mutateAttendance(actor, params.jobId, action, {
            gps_result: capture.gps_result,
            latitude: captured ? capture.latitude : null,
            longitude: captured ? capture.longitude : null,
            accuracy: captured ? capture.accuracy : null,
            exception_reason: capture.exception_reason || null,
          });
          if (result.outcome !== "ok") {
            return Response.json(
              {
                error: result.error ?? "Attendance action failed.",
                ...(result.conflict_job_number
                  ? { conflictJobNumber: result.conflict_job_number }
                  : {}),
              },
              { status: result.status ?? 409 },
            );
          }

          return Response.json({
            ok: true,
            action,
            visitId: result.visit_id ?? null,
            at: result.at ?? new Date().toISOString(),
            durationMinutes: result.duration_minutes ?? null,
            gpsResult: result.gps_result ?? capture.gps_result,
            hasGpsException: Boolean(result.has_gps_exception),
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          const status = (err as { status?: number }).status;
          if (typeof status === "number" && status !== 500) {
            return Response.json({ error: (err as Error).message }, { status });
          }
          console.error("[onsite-attendance POST] failed", err);
          return Response.json({ error: "Attendance action failed." }, { status: 500 });
        }
      },
    },
  },
});
