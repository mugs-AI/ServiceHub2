// GET/POST /api/workspace/jobs/$jobId/cancellation — WP0E-R dedicated
// cancellation process. This is the ONLY server path that can move a Service
// Job to Cancelled; the generic /status route rejects `to = Cancelled`.
//
// GET  → tenant policy, requester eligibility, active request, history.
// POST → initiate cancellation. Under `direct` the Job is cancelled at once;
//        under `admin_approval_required` a durable pending request is written
//        and the Job keeps its current operational state.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/cancellation")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { loadTenantSettings } = await import(
          "@/lib/qne/service-jobs/tenant-settings.server"
        );
        const { fetchJobForCancellation, fetchActiveRequest, listRequests } = await import(
          "@/lib/qne/service-jobs/cancellation.server"
        );
        const { canRequestCancellation, isCancellableStatus } = await import(
          "@/lib/qne/service-jobs/cancellation"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const job = await fetchJobForCancellation(user.tenantCode, params.jobId);
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });

          const settings = (await loadTenantSettings(user.tenantCode)).cancellation;
          const actorUserId = user.diagnostics.matchedN3UserId ?? user.userCode ?? null;
          const eligible =
            !job.is_deleted &&
            isCancellableStatus(job.status) &&
            canRequestCancellation(
              settings.requesterPolicy,
              { isAdministrator: !!user.isAdministrator, actorUserId },
              {
                status: job.status,
                isDeleted: job.is_deleted,
                createdByUserId: job.created_by_user_id,
                assignedUserId: job.assigned_user_id,
              },
            );

          return Response.json({
            settings,
            canRequest: eligible,
            isAdmin: !!user.isAdministrator,
            activeRequest: await fetchActiveRequest(user.tenantCode, params.jobId),
            history: await listRequests(user.tenantCode, params.jobId),
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/cancellation GET] failed", err);
          return Response.json({ error: "Failed to load cancellation state" }, { status: 500 });
        }
      },

      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { loadTenantSettings } = await import(
          "@/lib/qne/service-jobs/tenant-settings.server"
        );
        const {
          fetchJobForCancellation,
          fetchActiveRequest,
          createCancellationRequestAtomic,
          cancelJobDirectAtomic,
        } = await import("@/lib/qne/service-jobs/cancellation.server");
        const { evaluateCancellationRequest, normalizeReason } = await import(
          "@/lib/qne/service-jobs/cancellation"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const reason = normalizeReason(body.reason);

          const job = await fetchJobForCancellation(user.tenantCode, params.jobId);
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });

          const settings = (await loadTenantSettings(user.tenantCode)).cancellation;
          const actorUserId = user.diagnostics.matchedN3UserId ?? user.userCode ?? null;
          const actor = {
            userId: actorUserId,
            name: user.displayName || user.email || null,
          };
          const active = await fetchActiveRequest(user.tenantCode, params.jobId);

          const decision = evaluateCancellationRequest({
            settings,
            actor: { isAdministrator: !!user.isAdministrator, actorUserId },
            job: {
              status: job.status,
              isDeleted: job.is_deleted,
              createdByUserId: job.created_by_user_id,
              assignedUserId: job.assigned_user_id,
            },
            reason,
            hasActiveRequest: !!active,
          });
          if (!decision.ok) {
            return Response.json({ error: decision.error }, { status: decision.status });
          }

          // From here the database routine owns the whole effect: state row and
          // audit row commit together, or nothing commits at all.
          if (decision.effect === "cancel_now") {
            const result = await cancelJobDirectAtomic({
              tenantCode: user.tenantCode,
              jobId: params.jobId,
              reason: reason as string,
              actor,
            });
            if (result.outcome === "job_not_found") {
              return Response.json({ error: "Job not found." }, { status: 404 });
            }
            if (result.outcome === "reason_required") {
              return Response.json({ error: "A cancellation reason is required." }, { status: 400 });
            }
            if (result.outcome !== "cancelled") {
              return Response.json(
                { error: "This Job is no longer in a cancellable state." },
                { status: 409 },
              );
            }
            return Response.json({ ok: true, mode: "direct", cancelled: true, job: result.job });
          }

          const created = await createCancellationRequestAtomic({
            tenantCode: user.tenantCode,
            jobId: params.jobId,
            reason: reason as string,
            requesterPolicy: settings.requesterPolicy,
            approvalMode: settings.approvalMode,
            actor,
          });
          if (created.outcome === "job_not_found") {
            return Response.json({ error: "Job not found." }, { status: 404 });
          }
          if (created.outcome === "reason_required") {
            return Response.json({ error: "A cancellation reason is required." }, { status: 400 });
          }
          if (created.outcome === "duplicate_active_request") {
            return Response.json(
              { error: "A cancellation request is already awaiting an Owner/Admin decision." },
              { status: 409 },
            );
          }
          if (created.outcome !== "created") {
            return Response.json(
              { error: "This Job is no longer in a cancellable state." },
              { status: 409 },
            );
          }
          return Response.json({
            ok: true,
            mode: "admin_approval_required",
            cancelled: false,
            request: created.request,
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/cancellation POST] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },

    },
  },
});
