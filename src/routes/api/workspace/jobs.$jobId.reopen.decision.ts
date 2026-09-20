// POST /api/workspace/jobs/$jobId/reopen/decision — Owner/Admin only.
//
// Approve returns the Job from Completed to In Progress inside one
// transaction, preserves the Primary PIC / assignment, advances the completion
// cycle exactly once and leaves every prior completion evidence row untouched.
// Reject leaves the Job Completed. Administrator authority is resolved from the
// authenticated N3 session and rechecked inside the transaction; the browser
// never supplies tenant or admin claims.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/reopen/decision")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { decideReopenAtomic, loadPendingReopenRequest } = await import(
          "@/lib/qne/service-jobs/wp3a.server"
        );
        const { parseReopenDecision } = await import("@/lib/qne/service-jobs/wp3a-reopen");
        try {
          const user = await requireAdministrator(request);
          const actor = {
            tenantCode: user.tenantCode,
            userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName || user.email || null,
            isAdmin: true,
          };
          if (!actor.userId) {
            return Response.json({ error: "Your user could not be resolved." }, { status: 401 });
          }

          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const parsed = parseReopenDecision(body);
          if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

          const requestId =
            typeof body.requestId === "string" && body.requestId.trim()
              ? body.requestId.trim()
              : ((await loadPendingReopenRequest(user.tenantCode, params.jobId))?.id ?? null);
          if (!requestId) {
            return Response.json(
              { error: "There is no reopen request awaiting a decision." },
              { status: 409 },
            );
          }

          const result = await decideReopenAtomic(actor, requestId, parsed.value);
          if (result.outcome !== "ok") {
            return Response.json(
              { error: result.error ?? "Reopen decision failed." },
              { status: result.status ?? 409 },
            );
          }
          return Response.json({ ok: true, decision: parsed.value.decision, requestId });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          const status = (err as { status?: number }).status;
          if (typeof status === "number" && status !== 500) {
            return Response.json({ error: (err as Error).message }, { status });
          }
          console.error("[jobs/reopen decision POST] failed", err);
          return Response.json({ error: "Failed to decide reopen request" }, { status: 500 });
        }
      },
    },
  },
});
