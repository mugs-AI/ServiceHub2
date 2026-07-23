// POST /api/workspace/jobs/$jobId/internal-note — creator-only edit of the
// internal note. Records `internal_note_updated` in the activity log.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/internal-note")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const raw = typeof body.internal_note === "string" ? body.internal_note : "";
          const note = raw.trim().slice(0, 5000);

          const { data: job, error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .select("id, is_deleted, created_by_user_id, internal_note")
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (jobErr) throw jobErr;
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
          if (job.is_deleted) {
            return Response.json({ error: "Deleted job cannot be modified." }, { status: 400 });
          }

          const actorId = user.diagnostics.matchedN3UserId ?? user.userCode ?? null;
          const actorName = user.displayName || user.email || null;
          if (!job.created_by_user_id || job.created_by_user_id !== actorId) {
            return Response.json(
              { error: "Only the job creator can edit the internal note." },
              { status: 403 },
            );
          }

          const { data: updated, error: upErr } = await supabaseAdmin
            .from("service_jobs")
            .update({ internal_note: note || null })
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .select("*")
            .single();
          if (upErr) throw upErr;

          await supabaseAdmin.from("service_job_activity_log").insert({
            tenant_code: user.tenantCode,
            service_job_id: params.jobId,
            event_type: "internal_note_updated",
            old_value: null,
            new_value: null,
            note: null,
            performed_by_user_id: actorId,
            performed_by_name_snapshot: actorName,
          });

          return Response.json({ ok: true, job: updated });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/internal-note] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
