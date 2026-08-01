// GET  /api/workspace/jobs/$jobId/work-notes — structured field work notes
// POST /api/workspace/jobs/$jobId/work-notes — append a note (type + visibility)
//
// Work notes are separate from general Comments and are append-only.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/work-notes")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAuthenticatedN3User(request);
          const { data, error } = await supabaseAdmin
            .from("service_job_work_notes")
            .select("*")
            .eq("tenant_code", user.tenantCode)
            .eq("service_job_id", params.jobId)
            .order("created_at", { ascending: false });
          if (error) throw error;
          return Response.json({ notes: data ?? [] });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[work-notes GET] failed", err);
          return Response.json({ error: "Failed to load work notes" }, { status: 500 });
        }
      },

      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadJob, assertFieldPermission, logFieldEvent } = await import(
          "@/lib/qne/service-jobs/field-ops.server"
        );
        const { WORK_NOTE_TYPES, VISIBILITIES, fieldActionsBlocked } = await import(
          "@/lib/qne/service-jobs/field-ops"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const actor = {
            tenantCode: user.tenantCode,
            userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName || user.email || null,
            isAdmin: Boolean(user.isAdministrator),
          };
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const noteType = String(body.note_type ?? "");
          const visibility = String(body.visibility ?? "internal");
          const text = String(body.body ?? "").trim();

          if (!(WORK_NOTE_TYPES as readonly string[]).includes(noteType)) {
            return Response.json({ error: "A valid note type is required." }, { status: 400 });
          }
          if (!(VISIBILITIES as readonly string[]).includes(visibility)) {
            return Response.json({ error: "A valid visibility is required." }, { status: 400 });
          }
          if (!text) return Response.json({ error: "Note body is required." }, { status: 400 });

          const job = await loadJob(actor.tenantCode, params.jobId);
          assertFieldPermission(job, actor);
          const blocked = fieldActionsBlocked({ status: job.status, is_deleted: job.is_deleted });
          if (blocked) return Response.json({ error: blocked }, { status: 400 });

          const { data, error } = await supabaseAdmin
            .from("service_job_work_notes")
            .insert({
              tenant_code: actor.tenantCode,
              service_job_id: job.id,
              author_user_id: actor.userId,
              author_name_snapshot: actor.name,
              note_type: noteType,
              visibility,
              body: text.slice(0, 5000),
            })
            .select("*")
            .single();
          if (error) throw error;

          await logFieldEvent(actor, job.id, "work_note_added", {
            newValue: noteType,
            note: visibility === "visible_to_customer" ? text.slice(0, 200) : null,
          });

          return Response.json({ ok: true, note: data });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          const status = (err as { status?: number }).status;
          if (typeof status === "number") {
            return Response.json({ error: (err as Error).message }, { status });
          }
          console.error("[work-notes POST] failed", err);
          return Response.json({ error: "Failed to save work note" }, { status: 500 });
        }
      },
    },
  },
});
