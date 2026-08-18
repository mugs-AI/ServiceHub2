// POST /api/workspace/jobs/$jobId/cancellation/decision — Owner/Admin only.
// Approves or rejects the active cancellation request.
//
// Approve: claim the pending request atomically, then finalize the Job exactly
// once. Reject: mark the request decided and leave the prior operational state
// untouched. Both paths append audit and are safe under retries and competing
// Admin clicks — the conditional UPDATEs are the concurrency boundary.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/cancellation/decision")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { fetchJobForCancellation, fetchActiveRequest, decideCancellationAtomic } =
          await import("@/lib/qne/service-jobs/cancellation.server");
        const { normalizeReason } = await import("@/lib/qne/service-jobs/cancellation");
        try {
          const user = await requireAdministrator(request);
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const decision = String(body.decision ?? "").trim();
          if (decision !== "approve" && decision !== "reject") {
            return Response.json({ error: "Invalid decision." }, { status: 400 });
          }
          const note = normalizeReason(body.note);

          const job = await fetchJobForCancellation(user.tenantCode, params.jobId);
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });

          const active = await fetchActiveRequest(user.tenantCode, params.jobId);
          if (!active) {
            return Response.json(
              { error: "There is no cancellation request awaiting a decision." },
              { status: 409 },
            );
          }

          const actor = {
            userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName || user.email || null,
          };

          // One transaction: claim the request, cancel the Job when approved,
          // and append audit. Partial outcomes cannot be committed.
          const result = await decideCancellationAtomic({
            tenantCode: user.tenantCode,
            requestId: active.id,
            decision: decision === "approve" ? "approved" : "rejected",
            note,
            actor,
          });

          if (result.outcome === "already_decided" || result.outcome === "request_not_found") {
            return Response.json(
              { error: "This cancellation request has already been decided." },
              { status: 409 },
            );
          }
          if (result.outcome === "job_not_found") {
            return Response.json({ error: "Job not found." }, { status: 404 });
          }
          if (result.outcome === "job_not_cancellable") {
            return Response.json(
              { error: "This Job is no longer in a cancellable state." },
              { status: 409 },
            );
          }
          if (result.outcome !== "approved" && result.outcome !== "rejected") {
            return Response.json({ error: "Invalid decision." }, { status: 400 });
          }

          return Response.json({
            ok: true,
            decision: result.outcome,
            request: result.request,
            job: result.job ?? job,
          });

        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/cancellation decision] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
