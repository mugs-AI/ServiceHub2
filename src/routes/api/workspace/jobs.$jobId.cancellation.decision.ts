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
        const {
          fetchJobForCancellation,
          fetchActiveRequest,
          decidePendingRequest,
          finalizeJobCancellation,
          appendCancellationActivity,
        } = await import("@/lib/qne/service-jobs/cancellation.server");
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

          const claimed = await decidePendingRequest({
            tenantCode: user.tenantCode,
            requestId: active.id,
            decision: decision === "approve" ? "approved" : "rejected",
            note,
            actor,
          });
          if (!claimed) {
            return Response.json(
              { error: "This cancellation request has already been decided." },
              { status: 409 },
            );
          }

          if (decision === "reject") {
            await appendCancellationActivity({
              tenantCode: user.tenantCode,
              jobId: params.jobId,
              eventType: "cancellation_rejected",
              oldValue: active.prior_status,
              newValue: job.status,
              note,
              actor,
            });
            return Response.json({ ok: true, decision: "rejected", request: claimed, job });
          }

          const result = await finalizeJobCancellation({
            tenantCode: user.tenantCode,
            jobId: params.jobId,
            reason: active.reason,
            actor,
          });
          if (!result.finalized) {
            return Response.json(
              { error: "This Job is no longer in a cancellable state." },
              { status: 409 },
            );
          }
          await appendCancellationActivity({
            tenantCode: user.tenantCode,
            jobId: params.jobId,
            eventType: "job_cancelled",
            oldValue: active.prior_status,
            newValue: "Cancelled",
            note: `Approved cancellation requested by ${
              active.requested_by_name_snapshot ?? "a support user"
            }: ${active.reason}`,
            actor,
          });
          return Response.json({
            ok: true,
            decision: "approved",
            request: claimed,
            job: result.job,
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
