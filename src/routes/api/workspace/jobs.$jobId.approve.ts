// POST /api/workspace/jobs/$jobId/approve — Admin/Owner only.
// Moves Pending Approval → Open. Records approver identity.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/approve")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAdministrator(request);
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const asText = (v: unknown): string | null => {
            if (typeof v !== "string") return null;
            const s = v.trim();
            return s ? s.slice(0, 2000) : null;
          };
          // Backwards compatible: accept legacy `note` as public remark.
          const remarkPublic =
            asText(body.remark_public) ?? asText(body.approval_remark_public) ?? asText(body.note);
          const remarkPrivate =
            asText(body.remark_private) ?? asText(body.approval_remark_private);

          const { data: job, error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .select("id, status, is_deleted")
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (jobErr) throw jobErr;
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
          if (job.is_deleted) return Response.json({ error: "Deleted job cannot be modified." }, { status: 400 });
          if (job.status !== "Pending Approval") {
            return Response.json(
              { error: "Only Pending Approval jobs can be approved." },
              { status: 400 },
            );
          }

          const now = new Date().toISOString();
          const performer = {
            approved_by_user_id: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            approved_by_name_snapshot: user.displayName || user.email || null,
          };
          const { data: updated, error: upErr } = await supabaseAdmin
            .from("service_jobs")
            .update({
              status: "Open",
              requires_approval: false,
              approved_at: now,
              approval_note: remarkPublic, // legacy column kept in sync
              approval_remark_public: remarkPublic,
              approval_remark_private: remarkPrivate,
              ...performer,
            })
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .select("*")
            .single();
          if (upErr) throw upErr;

          // Timeline records the public remark only. Private remark is stored
          // on the row and surfaced to admins on Job Detail — never in the
          // shared timeline.
          await supabaseAdmin.from("service_job_activity_log").insert({
            tenant_code: user.tenantCode,
            service_job_id: params.jobId,
            event_type: "approval_granted",
            old_value: "Pending Approval",
            new_value: "Open",
            note: remarkPublic,
            performed_by_user_id: performer.approved_by_user_id,
            performed_by_name_snapshot: performer.approved_by_name_snapshot,
          });
          if (remarkPrivate) {
            await supabaseAdmin.from("service_job_activity_log").insert({
              tenant_code: user.tenantCode,
              service_job_id: params.jobId,
              event_type: "approval_remark_private",
              old_value: null,
              new_value: null,
              note: null, // stored on the job row, admin-only
              performed_by_user_id: performer.approved_by_user_id,
              performed_by_name_snapshot: performer.approved_by_name_snapshot,
            });
          }

          return Response.json({ ok: true, job: updated });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/approve] failed", err);
          return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
        }
      },
    },
  },
});
