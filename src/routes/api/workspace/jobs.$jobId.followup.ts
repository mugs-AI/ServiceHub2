// GET  /api/workspace/jobs/$jobId/followup — WP3B follow-up read model
// POST /api/workspace/jobs/$jobId/followup — atomic clear (RPC only)
//
// Tenant, actor, role, status and timestamps are resolved server-side from the
// authenticated N3 session and canonical Job data — never from the body. The
// Job stays Completed when a follow-up is cleared; completion evidence is
// immutable and is never read-modified here.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/followup")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } =
          await import("@/lib/qne/session/current-user.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadCompletionRecord } =
          await import("@/lib/qne/service-jobs/wp3-completion.server");
        const { loadFollowupForCycle } = await import("@/lib/qne/service-jobs/wp3b.server");
        const { deriveOutcome, followupView, OUTCOME_LABEL, MAX_FOLLOWUP_NOTE } =
          await import("@/lib/qne/service-jobs/wp3b-followup");
        try {
          const user = await requireAuthenticatedN3User(request);
          const actorUserId = user.diagnostics.matchedN3UserId ?? user.userCode ?? null;
          const isAdmin = Boolean(user.isAdministrator);

          const { data: job, error } = await supabaseAdmin
            .from("service_jobs")
            .select("id, status, is_deleted, assigned_user_id, completion_cycle")
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (error) throw error;
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });

          const cycle =
            typeof job.completion_cycle === "number" && job.completion_cycle > 0
              ? job.completion_cycle
              : 1;

          const [record, followup, pendingReopen] = await Promise.all([
            loadCompletionRecord(user.tenantCode, params.jobId),
            loadFollowupForCycle(user.tenantCode, params.jobId, cycle),
            supabaseAdmin
              .from("service_job_reopen_requests")
              .select("id")
              .eq("tenant_code", user.tenantCode)
              .eq("service_job_id", params.jobId)
              .eq("status", "pending")
              .maybeSingle(),
          ]);

          const jobFacts = {
            status: job.status,
            is_deleted: job.is_deleted === true,
            assigned_user_id: job.assigned_user_id ?? null,
          };
          const outcome = deriveOutcome({
            jobStatus: job.status,
            isDeleted: jobFacts.is_deleted,
            completion: record ? { follow_up_required: record.follow_up_required === true } : null,
            followup,
            hasPendingReopen: Boolean(pendingReopen.data),
          });

          return Response.json({
            completionCycle: cycle,
            outcome,
            outcomeLabel: outcome ? OUTCOME_LABEL[outcome] : null,
            maxNote: MAX_FOLLOWUP_NOTE,
            view: followupView({
              job: jobFacts,
              followup,
              actor: { actorUserId, isAdmin },
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
          console.error("[jobs/followup GET] failed", err);
          return Response.json({ error: "Failed to load follow-up state" }, { status: 500 });
        }
      },

      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } =
          await import("@/lib/qne/session/current-user.server");
        const { clearFollowupAtomic } = await import("@/lib/qne/service-jobs/wp3b.server");
        const { parseFollowupClearInput } = await import("@/lib/qne/service-jobs/wp3b-followup");
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
          const parsed = parseFollowupClearInput(body);
          if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

          // The RPC is the single authoritative readiness/permission/mutation
          // operation. No route-side precheck: it would reject an identical
          // lost-response retry before reaching the idempotent branch.
          const result = await clearFollowupAtomic(actor, params.jobId, parsed.value);
          if (result.outcome !== "ok") {
            return Response.json(
              { error: result.error ?? "Clearing the follow-up failed." },
              { status: result.status ?? 409 },
            );
          }
          return Response.json({
            ok: true,
            idempotent: Boolean(result.idempotent),
            followupId: result.followup_id ?? null,
            resolvedAt: result.resolved_at ?? null,
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          const status = (err as { status?: number }).status;
          if (typeof status === "number" && status !== 500) {
            return Response.json({ error: (err as Error).message }, { status });
          }
          console.error("[jobs/followup POST] failed", err);
          return Response.json({ error: "Failed to clear follow-up" }, { status: 500 });
        }
      },
    },
  },
});
