// POST   /api/workspace/jobs/$jobId/assign — assign or reassign a technician
// DELETE /api/workspace/jobs/$jobId/assign — unassign the current technician
//
// - Admin-only (Milestone 2.0.2). Server-side enforcement.
// - Tenant-scoped: the job must belong to the caller's tenant.
// - The technician (user_id) must be a currently-active N3 user in the same
//   tenant (verified against /api/Users on every write — no client trust).
// - Every action writes an append-only row to
//   service_job_assignment_history. History is never overwritten.
// - Status is NEVER changed — assignment does not move workflow.

import { createFileRoute } from "@tanstack/react-router";

type Action = "assigned" | "reassigned" | "unassigned";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/assign")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { n3Get } = await import("@/lib/qne/sync/n3.server");
        const { isUserActive } = await import(
          "@/lib/qne/session/role-resolution"
        );
        try {
          const user = await requireAdministrator(request);
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          const targetUserId = String(body.user_id ?? "").trim();
          if (!targetUserId) {
            return Response.json(
              { error: "user_id is required." },
              { status: 400 },
            );
          }

          // Load the job (tenant-scoped).
          const { data: job, error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .select(
              "id, tenant_code, assigned_user_id, assigned_user_name_snapshot",
            )
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (jobErr) throw jobErr;
          if (!job) {
            return Response.json({ error: "Job not found." }, { status: 404 });
          }

          // Verify the technician against N3 Users for this tenant.
          const raw = await n3Get<unknown>(user.token, "main", "/api/Users");
          const list = Array.isArray(raw)
            ? (raw as Array<Record<string, unknown>>)
            : Array.isArray((raw as { value?: unknown[] })?.value)
              ? ((raw as { value: Array<Record<string, unknown>> }).value)
              : Array.isArray((raw as { data?: unknown[] })?.data)
                ? ((raw as { data: Array<Record<string, unknown>> }).data)
                : [];
          const tech = list.find(
            (u) => String(u.userId ?? "").trim() === targetUserId,
          );
          if (!tech) {
            return Response.json(
              { error: "Technician not found in this tenant." },
              { status: 404 },
            );
          }
          if (!isUserActive(tech)) {
            return Response.json(
              { error: "Technician is inactive and cannot be assigned." },
              { status: 400 },
            );
          }

          const nameSnap =
            (String(tech.displayName ?? "").trim() ||
              String(tech.userName ?? "").trim() ||
              String(tech.email ?? "").trim() ||
              targetUserId) ?? targetUserId;
          const userNameSnap = String(tech.userName ?? "").trim() || null;
          const emailSnap = String(tech.email ?? "").trim() || null;

          const previousUserId = job.assigned_user_id ?? null;
          const previousName = job.assigned_user_name_snapshot ?? null;

          if (previousUserId === targetUserId) {
            return Response.json({
              ok: true,
              noop: true,
              message: "Technician already assigned.",
            });
          }

          const action: Action = previousUserId ? "reassigned" : "assigned";
          const now = new Date().toISOString();

          const { data: updated, error: upErr } = await supabaseAdmin
            .from("service_jobs")
            .update({
              assigned_user_id: targetUserId,
              assigned_user_name_snapshot: nameSnap,
              assigned_user_code_snapshot: userNameSnap,
              assigned_user_email_snapshot: emailSnap,
              assigned_at: now,
              assigned_by_user_id:
                user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
              assigned_by_name_snapshot: user.displayName || user.email || null,
            })
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .select("*")
            .single();
          if (upErr) throw upErr;

          const { error: hErr } = await supabaseAdmin
            .from("service_job_assignment_history")
            .insert({
              tenant_code: user.tenantCode,
              service_job_id: params.jobId,
              action,
              assigned_user_id: targetUserId,
              assigned_user_name_snapshot: nameSnap,
              assigned_user_code_snapshot: userNameSnap,
              assigned_user_email_snapshot: emailSnap,
              previous_assigned_user_id: previousUserId,
              previous_assigned_user_name_snapshot: previousName,
              performed_by_user_id:
                user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
              performed_by_name_snapshot: user.displayName || user.email || null,
              performed_at: now,
            });
          if (hErr) throw hErr;

          return Response.json({ ok: true, action, job: updated });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/assign POST] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },

      DELETE: async ({ request, params }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAdministrator(request);
          const { data: job, error: jobErr } = await supabaseAdmin
            .from("service_jobs")
            .select(
              "id, tenant_code, assigned_user_id, assigned_user_name_snapshot",
            )
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .maybeSingle();
          if (jobErr) throw jobErr;
          if (!job) {
            return Response.json({ error: "Job not found." }, { status: 404 });
          }
          if (!job.assigned_user_id) {
            return Response.json({
              ok: true,
              noop: true,
              message: "Job is already unassigned.",
            });
          }

          const previousUserId = job.assigned_user_id;
          const previousName = job.assigned_user_name_snapshot ?? null;
          const now = new Date().toISOString();

          const { data: updated, error: upErr } = await supabaseAdmin
            .from("service_jobs")
            .update({
              assigned_user_id: null,
              assigned_user_name_snapshot: null,
              assigned_user_code_snapshot: null,
              assigned_user_email_snapshot: null,
              assigned_at: null,
              assigned_by_user_id: null,
              assigned_by_name_snapshot: null,
            })
            .eq("tenant_code", user.tenantCode)
            .eq("id", params.jobId)
            .select("*")
            .single();
          if (upErr) throw upErr;

          const { error: hErr } = await supabaseAdmin
            .from("service_job_assignment_history")
            .insert({
              tenant_code: user.tenantCode,
              service_job_id: params.jobId,
              action: "unassigned",
              assigned_user_id: null,
              assigned_user_name_snapshot: null,
              previous_assigned_user_id: previousUserId,
              previous_assigned_user_name_snapshot: previousName,
              performed_by_user_id:
                user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
              performed_by_name_snapshot: user.displayName || user.email || null,
              performed_at: now,
            });
          if (hErr) throw hErr;

          return Response.json({ ok: true, action: "unassigned", job: updated });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/assign DELETE] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
