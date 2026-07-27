// Comments on a Service Job (append-only, tenant-scoped).
// GET  → list comments (newest first)
// POST → add comment { body, visibility? ('internal'|'customer') }

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/comments")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const { data: job } = await supabaseAdmin
            .from("service_jobs")
            .select("id")
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });

          const { data, error } = await supabaseAdmin
            .from("service_job_comments")
            .select("*")
            .eq("tenant_code", user.tenantCode)
            .eq("service_job_id", params.jobId)
            .order("created_at", { ascending: false })
            .limit(500);
          if (error) throw error;
          return Response.json({ comments: data ?? [] });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[jobs/comments GET] failed", err);
          return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
        }
      },

      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const body = typeof raw.body === "string" ? raw.body.trim().slice(0, 5000) : "";
          const visibility = raw.visibility === "customer" ? "customer" : "internal";
          if (!body) return Response.json({ error: "Comment body is required." }, { status: 400 });

          const { data: job } = await supabaseAdmin
            .from("service_jobs")
            .select("id, is_deleted, status")
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
          if (job.is_deleted) return Response.json({ error: "Deleted job cannot be commented on." }, { status: 400 });
          if (job.status === "Pending Approval" && !user.isAdministrator) {
            return Response.json(
              { error: "This Job is waiting for Owner/Admin approval. Comments are locked until approval." },
              { status: 400 },
            );
          }

          const actorId = user.diagnostics.matchedN3UserId ?? user.userCode ?? null;
          const actorName = user.displayName || user.email || null;

          const { data: inserted, error: insErr } = await supabaseAdmin
            .from("service_job_comments")
            .insert({
              tenant_code: user.tenantCode,
              service_job_id: params.jobId,
              visibility,
              body,
              author_user_id: actorId,
              author_name_snapshot: actorName,
            })
            .select("*")
            .single();
          if (insErr) throw insErr;

          await supabaseAdmin.from("service_job_activity_log").insert({
            tenant_code: user.tenantCode,
            service_job_id: params.jobId,
            event_type: "comment_added",
            new_value: visibility,
            note: body.slice(0, 200),
            performed_by_user_id: actorId,
            performed_by_name_snapshot: actorName,
          });

          return Response.json({ comment: inserted }, { status: 201 });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[jobs/comments POST] failed", err);
          return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
        }
      },
    },
  },
});
