// WP2B — Job Attachments API (Google Drive vertical).
//
// GET    /api/workspace/jobs/$jobId/attachments        — list active attachments
// POST   /api/workspace/jobs/$jobId/attachments        — multipart upload to Drive
// DELETE /api/workspace/jobs/$jobId/attachments?id=... — trash on Drive, then soft delete
//
// Rules enforced here, on the server, independently of the UI:
//   • tenant is derived from the N3 session; a Job outside the tenant is 404
//   • extension + MIME allow/deny, 20 MiB per file, 10 active files and
//     100 MiB total per Job — re-checked per file inside the request
//   • NEW bytes only ever go to the tenant's accepted Google Drive connection;
//     there is no fallback to the legacy Supabase bucket
//   • no Drive token, folder id or privileged Drive URL reaches the browser
//   • delete trashes the Drive file FIRST; metadata is soft-deleted only after
//     the provider confirms. A failed trash leaves the attachment ACTIVE.
//   • upload / delete / failure are audited; a lost audit fails the request

import { createFileRoute } from "@tanstack/react-router";

const LEGACY_BUCKET = "job-attachments";
const SIGNED_URL_TTL = 300; // seconds

export const Route = createFileRoute("/api/workspace/jobs/$jobId/attachments")({
  server: {
    handlers: {
      // ---------------------------------------------------------------- GET
      GET: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const svc = await import("@/lib/qne/storage/job-attachments.server");
        const policy = await import("@/lib/qne/storage/attachment-policy");
        try {
          const user = await requireAuthenticatedN3User(request);
          const job = await svc.loadJobForAttachments(user.tenantCode, params.jobId);
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });

          const rows = await svc.loadActiveAttachments(user.tenantCode, params.jobId);

          // Legacy Supabase-backed rows stay readable via a short-lived signed
          // URL. Drive-backed rows are served only through the authorised
          // server content route — never a raw provider URL.
          const legacy = rows.filter((r) => r.storage_provider !== svc.GOOGLE_DRIVE_PROVIDER);
          let signed: Record<string, string> = {};
          if (legacy.length > 0) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: urls } = await supabaseAdmin.storage
              .from(LEGACY_BUCKET)
              .createSignedUrls(
                legacy.map((r) => r.storage_path),
                SIGNED_URL_TTL,
              );
            signed = Object.fromEntries(
              (urls ?? [])
                .filter((u) => u.signedUrl && u.path)
                .map((u) => [String(u.path), String(u.signedUrl)]),
            );
          }

          const canDeleteFor = (uploaderId: string | null) =>
            policy.canDeleteAttachment({
              actorUserId: user.userId ?? null,
              isAdministrator: Boolean(user.isAdministrator),
              uploaderUserId: uploaderId,
              primaryPicUserId: job.assigned_user_id,
            });

          const quota = {
            activeCount: rows.length,
            activeBytes: rows.reduce((n, r) => n + (Number(r.file_size) || 0), 0),
            maxFiles: policy.MAX_ACTIVE_FILES,
            maxTotalBytes: policy.MAX_TOTAL_BYTES,
            maxFileBytes: policy.MAX_FILE_BYTES,
          };

          return Response.json({
            attachments: rows.map((r) => ({
              id: r.id,
              fileName: r.file_name,
              mimeType: r.mime_type,
              fileSize: r.file_size,
              visibility: r.visibility,
              provider: r.storage_provider,
              uploadedByName: r.uploaded_by_name_snapshot,
              uploadedAt: r.created_at,
              previewable: policy.isPreviewableMime(r.mime_type, r.file_name),
              canDelete: canDeleteFor(r.uploaded_by_user_id),
              remoteDeleteStatus: r.remote_delete_status ?? null,
              remoteDeleteError: r.remote_delete_error ?? null,
              contentPath:
                r.storage_provider === svc.GOOGLE_DRIVE_PROVIDER
                  ? `/api/workspace/jobs/${params.jobId}/attachments/${r.id}/content`
                  : null,
              legacyUrl:
                r.storage_provider === svc.GOOGLE_DRIVE_PROVIDER
                  ? null
                  : (signed[r.storage_path] ?? null),
            })),
            quota,
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[attachments GET] failed", err);
          return Response.json({ error: "Attachments could not be loaded." }, { status: 500 });
        }
      },

      // --------------------------------------------------------------- POST
      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const svc = await import("@/lib/qne/storage/job-attachments.server");
        const policy = await import("@/lib/qne/storage/attachment-policy");
        try {
          const user = await requireAuthenticatedN3User(request);
          const job = await svc.loadJobForAttachments(user.tenantCode, params.jobId);
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });

          const form = await request.formData();
          const file = form.get("file");
          if (!(file instanceof File)) {
            return Response.json({ error: "No file was received." }, { status: 400 });
          }

          const displayName = policy.sanitizeDisplayName(file.name);
          const mime = policy.effectiveMime(file.type, displayName);

          const verdict = policy.validateCandidate({
            fileName: displayName,
            mimeType: mime,
            size: file.size,
          });
          if (!verdict.ok) {
            return Response.json({ error: verdict.error }, { status: 400 });
          }

          // Server-side quota, re-read inside the request so a stale browser
          // count cannot be used to exceed the limits.
          const { activeCount, activeBytes } = await svc.quotaFor(user.tenantCode, params.jobId);
          const quotaVerdict = policy.validateQuota({
            activeCount,
            activeBytes,
            incomingBytes: file.size,
          });
          if (!quotaVerdict.ok) {
            return Response.json({ error: quotaVerdict.error }, { status: 409 });
          }

          const drive = await svc.resolveDriveContext(user.tenantCode);
          if (!drive.ok) {
            return Response.json(
              { error: drive.error, recovery: drive.recovery },
              { status: drive.status },
            );
          }

          const files = await import("@/lib/qne/storage/drive-files.server");
          const actor: svc.AttachmentActor = {
            tenantCode: user.tenantCode,
            userId: user.userId ?? null,
            name: user.displayName ?? null,
            isAdmin: Boolean(user.isAdministrator),
          };

          let folderId: string;
          let uploaded: { id: string };
          try {
            folderId = await files.ensureJobFolder({
              tenantCode: user.tenantCode,
              jobId: job.id,
              jobNumber: job.job_number,
              connectionId: drive.context.connectionId,
              rootFolderId: drive.context.rootFolderId,
              accessToken: drive.context.accessToken,
            });
            uploaded = await files.uploadFileToFolder({
              accessToken: drive.context.accessToken,
              folderId,
              name: displayName,
              mimeType: mime,
              body: await file.arrayBuffer(),
            });
          } catch (e) {
            const detail = e instanceof Error ? e.message : "Unknown Google Drive error.";
            await svc
              .logAttachmentEvent(actor, job.id, "attachment_upload_failed", {
                note: `Upload of "${displayName}" to Google Drive failed: ${detail}`,
                metadata: { file_name: displayName, size: file.size },
              })
              .catch(() => undefined);
            return Response.json(
              {
                error: `"${displayName}" was not uploaded. Google Drive rejected the file: ${detail}`,
                recovery: "You can retry the upload. Nothing was saved.",
              },
              { status: 502 },
            );
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: inserted, error: insertError } = await supabaseAdmin
            .from("service_job_attachments")
            .insert({
              tenant_code: user.tenantCode,
              service_job_id: job.id,
              attachment_type: "document",
              file_name: displayName,
              mime_type: mime,
              file_size: file.size,
              // Addressing is by provider file id; the human-readable path is
              // descriptive only and is never used for authorisation.
              storage_path: `google-drive:${uploaded.id}`,
              storage_provider: svc.GOOGLE_DRIVE_PROVIDER,
              storage_connection_id: drive.context.connectionId,
              storage_container: folderId,
              external_file_id: uploaded.id,
              visibility: policy.FORCED_VISIBILITY,
              availability_status: "available",
              uploaded_by_user_id: user.userId ?? null,
              uploaded_by_name_snapshot: user.displayName ?? null,
            })
            .select("id")
            .maybeSingle();

          if (insertError || !inserted) {
            // The bytes exist but ServiceHub cannot track them — trash the
            // orphan rather than leaving an untracked file in the customer's
            // Drive, and report the failure truthfully.
            await files
              .trashDriveFile(drive.context.accessToken, uploaded.id)
              .catch(() => undefined);
            return Response.json(
              {
                error: `"${displayName}" could not be recorded, so it was not attached.`,
                recovery: "Please retry the upload.",
              },
              { status: 500 },
            );
          }

          await svc.logAttachmentEvent(actor, job.id, "attachment_uploaded", {
            newValue: displayName,
            note: `Attached "${displayName}" (${policy.formatBytes(file.size)}) to Google Drive.`,
            metadata: { attachment_id: inserted.id, size: file.size, mime_type: mime },
          });

          return Response.json({ ok: true, id: inserted.id, fileName: displayName });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[attachments POST] failed", err);
          const message =
            err instanceof Error && err.name === "AttachmentAuditError"
              ? err.message
              : "The file could not be attached.";
          return Response.json({ error: message }, { status: 500 });
        }
      },

      // ------------------------------------------------------------- DELETE
      DELETE: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const svc = await import("@/lib/qne/storage/job-attachments.server");
        const policy = await import("@/lib/qne/storage/attachment-policy");
        try {
          const user = await requireAuthenticatedN3User(request);
          const job = await svc.loadJobForAttachments(user.tenantCode, params.jobId);
          if (!job) return Response.json({ error: "Job not found." }, { status: 404 });

          const attachmentId = new URL(request.url).searchParams.get("id") ?? "";
          const row = await svc.loadAttachment(user.tenantCode, params.jobId, attachmentId);
          if (!row) return Response.json({ error: "Attachment not found." }, { status: 404 });

          const actor: svc.AttachmentActor = {
            tenantCode: user.tenantCode,
            userId: user.userId ?? null,
            name: user.displayName ?? null,
            isAdmin: Boolean(user.isAdministrator),
          };

          // Independent server-side authority check — the UI hiding the button
          // is convenience, this is the control.
          const allowed = policy.canDeleteAttachment({
            actorUserId: actor.userId,
            isAdministrator: actor.isAdmin,
            uploaderUserId: row.uploaded_by_user_id,
            primaryPicUserId: job.assigned_user_id,
          });
          if (!allowed) {
            return Response.json(
              {
                error:
                  "Only the person who uploaded this file, the Primary PIC, or an Owner/Admin can delete it.",
              },
              { status: 403 },
            );
          }

          if (row.storage_provider === svc.GOOGLE_DRIVE_PROVIDER) {
            const drive = await svc.resolveDriveContext(user.tenantCode);
            if (!drive.ok) {
              await svc.setRemoteDeleteState(user.tenantCode, row.id, {
                status: "failed",
                error: drive.error,
              });
              return Response.json(
                {
                  error: `"${row.file_name}" was NOT deleted: ${drive.error}`,
                  recovery: drive.recovery,
                  stillActive: true,
                },
                { status: drive.status },
              );
            }
            const files = await import("@/lib/qne/storage/drive-files.server");
            try {
              await files.trashDriveFile(
                drive.context.accessToken,
                row.external_file_id ?? "",
              );
            } catch (e) {
              const detail = e instanceof Error ? e.message : "Unknown Google Drive error.";
              await svc.setRemoteDeleteState(user.tenantCode, row.id, {
                status: "failed",
                error: detail,
              });
              await svc
                .logAttachmentEvent(actor, job.id, "attachment_delete_failed", {
                  note: `Deleting "${row.file_name}" failed because Google Drive could not move it to Trash: ${detail}`,
                  metadata: { attachment_id: row.id },
                })
                .catch(() => undefined);
              return Response.json(
                {
                  error: `"${row.file_name}" was NOT deleted. Google Drive could not move it to Trash: ${detail}`,
                  recovery: "The attachment is still active. You can retry the delete.",
                  stillActive: true,
                },
                { status: 502 },
              );
            }
            await svc.setRemoteDeleteState(user.tenantCode, row.id, {
              status: "trashed",
              deletedAt: new Date().toISOString(),
            });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error: updateError } = await supabaseAdmin
            .from("service_job_attachments")
            .update({
              is_deleted: true,
              deleted_at: new Date().toISOString(),
              deleted_by_user_id: actor.userId,
              deleted_by_name_snapshot: actor.name,
            })
            .eq("tenant_code", user.tenantCode)
            .eq("id", row.id);
          if (updateError) throw updateError;

          await svc.logAttachmentEvent(actor, job.id, "attachment_deleted", {
            newValue: row.file_name,
            note: `Deleted attachment "${row.file_name}" (${policy.formatBytes(row.file_size)}). The file was moved to Trash in Google Drive.`,
            metadata: { attachment_id: row.id },
          });

          return Response.json({ ok: true });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[attachments DELETE] failed", err);
          const message =
            err instanceof Error && err.name === "AttachmentAuditError"
              ? err.message
              : "The attachment could not be deleted.";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
