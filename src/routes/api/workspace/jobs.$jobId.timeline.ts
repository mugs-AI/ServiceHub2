// GET /api/workspace/jobs/$jobId/timeline
// Aggregates activity log + assignment history + comments into a unified
// timeline. Newest first by default; ?order=asc for oldest first.

import { createFileRoute } from "@tanstack/react-router";

interface TimelineItem {
  id: string;
  kind: "activity" | "assignment" | "comment";
  event: string;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
  performed_by_name: string | null;
  performed_at: string;
  extra?: Record<string, unknown>;
}

export const Route = createFileRoute("/api/workspace/jobs/$jobId/timeline")({
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
          const url = new URL(request.url);
          const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";

          const { data: job } = await supabaseAdmin
            .from("service_jobs")
            .select("id")
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });

          const [actR, asnR, comR] = await Promise.all([
            supabaseAdmin
              .from("service_job_activity_log")
              .select("*")
              .eq("tenant_code", user.tenantCode)
              .eq("service_job_id", params.jobId)
              // Exclude comment_added: comments are rendered from
              // service_job_comments to keep one canonical source.
              .neq("event_type", "comment_added")
              .limit(500),
            supabaseAdmin
              .from("service_job_assignment_history")
              .select("*")
              .eq("tenant_code", user.tenantCode)
              .eq("service_job_id", params.jobId)
              .limit(500),
            supabaseAdmin
              .from("service_job_comments")
              .select("*")
              .eq("tenant_code", user.tenantCode)
              .eq("service_job_id", params.jobId)
              .limit(500),
          ]);
          for (const r of [actR, asnR, comR]) if (r.error) throw r.error;


          const items: TimelineItem[] = [];

          for (const a of actR.data ?? []) {
            items.push({
              id: `act:${a.id}`,
              kind: "activity",
              event: a.event_type,
              old_value: a.old_value ?? null,
              new_value: a.new_value ?? null,
              note: a.note ?? null,
              performed_by_name: a.performed_by_name_snapshot ?? null,
              performed_at: a.created_at,
            });
          }
          for (const h of asnR.data ?? []) {
            const event =
              h.action === "assigned"
                ? "technician_assigned"
                : h.action === "reassigned"
                  ? "technician_reassigned"
                  : "technician_unassigned";
            items.push({
              id: `asn:${h.id}`,
              kind: "assignment",
              event,
              old_value: h.previous_assigned_user_name_snapshot ?? null,
              new_value: h.assigned_user_name_snapshot ?? null,
              note: null,
              performed_by_name: h.performed_by_name_snapshot ?? null,
              performed_at: h.performed_at,
            });
          }
          for (const c of comR.data ?? []) {
            items.push({
              id: `cm:${c.id}`,
              kind: "comment",
              event: "comment_added",
              old_value: null,
              new_value: c.visibility,
              note: c.body,
              performed_by_name: c.author_name_snapshot ?? null,
              performed_at: c.created_at,
            });
          }

          items.sort((a, b) =>
            order === "asc"
              ? a.performed_at.localeCompare(b.performed_at)
              : b.performed_at.localeCompare(a.performed_at),
          );

          return Response.json({ timeline: items });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[jobs/timeline] failed", err);
          return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
        }
      },
    },
  },
});
