// GET  /api/workspace/jobs/$jobId/complete — WP3 simple completion read model
// POST /api/workspace/jobs/$jobId/complete — atomic completion (RPC only)
//
// WP3 replaces the previous multi-step completion write. The POST handler
// performs exactly one mutation: the transactional RPC. Identity, role,
// assignment and timestamps are resolved server-side from the authenticated
// N3 session and canonical Job data — never from the request body.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/complete")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } =
          await import("@/lib/qne/session/current-user.server");
        const { loadCompletionJob, loadCompletionRecord, countOpenAttendance } =
          await import("@/lib/qne/service-jobs/wp3-completion.server");
        const { canCompleteJob, completionBlockedReason, completionView, MAX_RESOLUTION_SUMMARY } =
          await import("@/lib/qne/service-jobs/wp3-completion");
        try {
          const user = await requireAuthenticatedN3User(request);
          const actorUserId = user.diagnostics.matchedN3UserId ?? user.userCode ?? null;
          const isAdmin = Boolean(user.isAdministrator);
          const job = await loadCompletionJob(user.tenantCode, params.jobId);

          const [record, openAttendance] = await Promise.all([
            loadCompletionRecord(user.tenantCode, params.jobId),
            countOpenAttendance(user.tenantCode, params.jobId),
          ]);
          const blockedReason = completionBlockedReason(job, openAttendance);

          return Response.json({
            jobNumber: job.job_number,
            jobStatus: job.status,
            canComplete: canCompleteJob({ actorUserId, isAdmin }, job),
            blockedReason,
            maxSummary: MAX_RESOLUTION_SUMMARY,
            view: completionView({
              status: job.status,
              is_deleted: job.is_deleted,
              record,
              blockedReason,
            }),
            serverNow: new Date().toISOString(),
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          const status = (err as { status?: number }).status;
          if (typeof status === "number" && status !== 500) {
            return Response.json({ error: (err as Error).message }, { status });
          }
          console.error("[complete GET] failed", err);
          return Response.json({ error: "Failed to load completion" }, { status: 500 });
        }
      },

      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } =
          await import("@/lib/qne/session/current-user.server");
        const { loadCompletionJob, countOpenAttendance, completeJobAtomic } =
          await import("@/lib/qne/service-jobs/wp3-completion.server");
        const { canCompleteJob, completionBlockedReason, parseCompletionInput } =
          await import("@/lib/qne/service-jobs/wp3-completion");
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
          const parsed = parseCompletionInput(body);
          if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

          const job = await loadCompletionJob(actor.tenantCode, params.jobId);
          if (!canCompleteJob({ actorUserId: actor.userId, isAdmin: actor.isAdmin }, job)) {
            return Response.json(
              { error: "Only the assigned technician or an administrator can complete this Job." },
              { status: 403 },
            );
          }
          const openAttendance = await countOpenAttendance(actor.tenantCode, params.jobId);
          const blocked = completionBlockedReason(job, openAttendance);
          if (blocked) return Response.json({ error: blocked }, { status: 409 });

          const result = await completeJobAtomic(actor, params.jobId, parsed.value);
          if (result.outcome !== "ok") {
            return Response.json(
              { error: result.error ?? "Completion failed." },
              { status: result.status ?? 409 },
            );
          }

          return Response.json({
            ok: true,
            idempotent: Boolean(result.idempotent),
            completionId: result.completion_id ?? null,
            completedAt: result.completed_at ?? null,
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          const status = (err as { status?: number }).status;
          if (typeof status === "number" && status !== 500) {
            return Response.json({ error: (err as Error).message }, { status });
          }
          console.error("[complete POST] failed", err);
          return Response.json({ error: "Failed to complete job" }, { status: 500 });
        }
      },
    },
  },
});
