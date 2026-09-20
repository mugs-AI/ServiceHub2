// GET  /api/workspace/jobs/$jobId/reopen — WP3A reopen read model
// POST /api/workspace/jobs/$jobId/reopen — create one pending reopen request
//
// A request never reopens the Job. Only an Owner/Admin decision can, through
// the dedicated decision endpoint. Tenant and actor come from the
// authenticated N3 session, never from the request body.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/reopen")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { loadCompletionJob } = await import("@/lib/qne/service-jobs/wp3-completion.server");
        const { loadPendingReopenRequest, loadReopenHistory } = await import(
          "@/lib/qne/service-jobs/wp3a.server"
        );
        const { reopenView, MAX_REOPEN_REASON, MAX_REOPEN_NOTE } = await import(
          "@/lib/qne/service-jobs/wp3a-reopen"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const isAdmin = Boolean(user.isAdministrator);
          const job = await loadCompletionJob(user.tenantCode, params.jobId);
          const [pending, history] = await Promise.all([
            loadPendingReopenRequest(user.tenantCode, params.jobId),
            loadReopenHistory(user.tenantCode, params.jobId),
          ]);
          return Response.json({
            jobStatus: job.status,
            isAdmin,
            maxReason: MAX_REOPEN_REASON,
            maxNote: MAX_REOPEN_NOTE,
            view: reopenView({
              job: { status: job.status, is_deleted: job.is_deleted },
              pending,
              isAdmin,
            }),
            history,
            serverNow: new Date().toISOString(),
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          const status = (err as { status?: number }).status;
          if (typeof status === "number" && status !== 500) {
            return Response.json({ error: (err as Error).message }, { status });
          }
          console.error("[jobs/reopen GET] failed", err);
          return Response.json({ error: "Failed to load reopen state" }, { status: 500 });
        }
      },

      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { requestReopenAtomic } = await import("@/lib/qne/service-jobs/wp3a.server");
        const { parseReopenReason } = await import("@/lib/qne/service-jobs/wp3a-reopen");
        try {
          const user = await requireAuthenticatedN3User(request);
          const actor = {
            tenantCode: user.tenantCode,
            userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName || user.email || null,
            isAdmin: Boolean(user.isAdministrator),
          };
          if (!actor.userId) {
            return Response.json({ error: "Your user could not be resolved." }, { status: 401 });
          }

          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const parsed = parseReopenReason(body);
          if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

          // The RPC is the single authoritative readiness and mutation
          // operation: it locks the Job, rechecks Completed state and rejects
          // a second pending request.
          const result = await requestReopenAtomic(actor, params.jobId, parsed.value);
          if (result.outcome !== "ok") {
            return Response.json(
              { error: result.error ?? "Reopen request failed." },
              { status: result.status ?? 409 },
            );
          }
          return Response.json({ ok: true, requestId: result.request_id ?? null });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          const status = (err as { status?: number }).status;
          if (typeof status === "number" && status !== 500) {
            return Response.json({ error: (err as Error).message }, { status });
          }
          console.error("[jobs/reopen POST] failed", err);
          return Response.json({ error: "Failed to request reopen" }, { status: 500 });
        }
      },
    },
  },
});
