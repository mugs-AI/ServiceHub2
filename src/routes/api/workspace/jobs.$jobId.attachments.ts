// GET    /api/workspace/jobs/$jobId/attachments — list with short-lived signed URLs
// POST   /api/workspace/jobs/$jobId/attachments — multipart upload (private bucket)
// DELETE /api/workspace/jobs/$jobId/attachments?id=... — audited soft delete
//
// Files live in the PRIVATE `job-attachments` bucket under
// <tenant_code>/<job_id>/<uuid>-<safe name>, so access is tenant-scoped and
// only ever handed out as a signed URL.

import { createFileRoute } from "@tanstack/react-router";

const BUCKET = "job-attachments";
const SIGNED_URL_TTL = 300; // seconds

function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(-120);
}

export const Route = createFileRoute("/api/workspace/jobs/$jobId/attachments")({
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
            .from("service_job_attachments")
            .select("*")
            .eq("tenant_code", user.tenantCode)
            .eq("service_job_id", params.jobId)
            .eq("is_deleted", false)
            .order("created_at", { ascending: false });
          if (error) throw error;

          const rows = data ?? [];
          // One batch signing call — never one request per attachment.
          let signed: Record<string, string> = {};
          if (rows.length > 0) {
            const { data: urls } = await supabaseAdmin.storage
              .from(BUCKET)
              .createSignedUrls(
                rows.map((r) => r.storage_path),
                SIGNED_URL_TTL,
              );
            signed = Object.fromEntries(
              (urls ?? [])
                .filter((u) => u.signedUrl && u.path)
                .map((u) => [u.path as string, u.signedUrl]),
            );
          }

          return Response.json({
            attachments: rows.map((r) => ({ ...r, url: signed[r.storage_path] ?? null })),
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[attachments GET] failed", err);
          return Response.json({ error: "Failed to load attachments" }, { status: 500 });
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
        const { validateAttachment, ATTACHMENT_TYPES, VISIBILITIES, fieldActionsBlocked } =
          await import("@/lib/qne/service-jobs/field-ops");
        try {
          const user = await requireAuthenticatedN3User(request);
          const actor = {
            tenantCode: user.tenantCode,
            userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName || user.email || null,
            isAdmin: Boolean(user.isAdministrator),
          };
          const job = await loadJob(actor.tenantCode, params.jobId);
          assertFieldPermission(job, actor);
          const blocked = fieldActionsBlocked({ status: job.status, is_deleted: job.is_deleted });
          if (blocked) return Response.json({ error: blocked }, { status: 400 });

          const form = await request.formData();
          const file = form.get("file");
          if (!(file instanceof File)) {
            return Response.json({ error: "A file is required." }, { status: 400 });
          }
          const attachmentType = String(form.get("attachment_type") ?? "document");
          const visibility = String(form.get("visibility") ?? "internal");
          if (!(ATTACHMENT_TYPES as readonly string[]).includes(attachmentType)) {
            return Response.json({ error: "Invalid attachment type." }, { status: 400 });
          }
          if (!(VISIBILITIES as readonly string[]).includes(visibility)) {
            return Response.json({ error: "Invalid visibility." }, { status: 400 });
          }

          const check = validateAttachment({
            name: file.name,
            type: file.type,
            size: file.size,
          });
          if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

          const path = `${actor.tenantCode}/${job.id}/${crypto.randomUUID()}-${safeName(file.name)}`;
          const { error: upErr } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(path, await file.arrayBuffer(), {
              contentType: file.type,
              upsert: false,
            });
          if (upErr) {
            console.error("[attachments upload] storage failed", upErr);
            return Response.json(
              { error: `Upload failed: ${upErr.message}` },
              { status: 502 },
            );
          }

          const { data, error } = await supabaseAdmin
            .from("service_job_attachments")
            .insert({
              tenant_code: actor.tenantCode,
              service_job_id: job.id,
              attachment_type: attachmentType,
              file_name: safeName(file.name),
              mime_type: file.type,
              file_size: file.size,
              storage_path: path,
              visibility,
              uploaded_by_user_id: actor.userId,
              uploaded_by_name_snapshot: actor.name,
            })
            .select("*")
            .single();
          if (error) throw error;

          await logFieldEvent(actor, job.id, "attachment_added", {
            newValue: attachmentType,
            note: data.file_name,
          });

          return Response.json({ ok: true, attachment: data });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          const status = (err as { status?: number }).status;
          if (typeof status === "number") {
            return Response.json({ error: (err as Error).message }, { status });
          }
          console.error("[attachments POST] failed", err);
          return Response.json({ error: "Failed to upload attachment" }, { status: 500 });
        }
      },

      DELETE: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadJob, assertFieldPermission, logFieldEvent } = await import(
          "@/lib/qne/service-jobs/field-ops.server"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const actor = {
            tenantCode: user.tenantCode,
            userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName || user.email || null,
            isAdmin: Boolean(user.isAdministrator),
          };
          const id = new URL(request.url).searchParams.get("id");
          if (!id) return Response.json({ error: "Attachment id required." }, { status: 400 });

          const job = await loadJob(actor.tenantCode, params.jobId);
          assertFieldPermission(job, actor);

          const { data, error } = await supabaseAdmin
            .from("service_job_attachments")
            .update({
              is_deleted: true,
              deleted_at: new Date().toISOString(),
              deleted_by_user_id: actor.userId,
              deleted_by_name_snapshot: actor.name,
            })
            .eq("tenant_code", actor.tenantCode)
            .eq("service_job_id", job.id)
            .eq("id", id)
            .select("file_name")
            .maybeSingle();
          if (error) throw error;
          if (!data) return Response.json({ error: "Attachment not found." }, { status: 404 });

          await logFieldEvent(actor, job.id, "attachment_deleted", { note: data.file_name });
          return Response.json({ ok: true });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          const status = (err as { status?: number }).status;
          if (typeof status === "number") {
            return Response.json({ error: (err as Error).message }, { status });
          }
          console.error("[attachments DELETE] failed", err);
          return Response.json({ error: "Failed to delete attachment" }, { status: 500 });
        }
      },
    },
  },
});
