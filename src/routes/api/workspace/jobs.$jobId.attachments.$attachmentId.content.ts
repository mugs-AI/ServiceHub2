// WP2B — authorised content proxy for Google Drive Job attachments.
//
// The browser never receives a Drive URL, a Drive file id it can address
// directly, or an access token. It asks ServiceHub for an attachment it is
// allowed to see, and ServiceHub streams the bytes back after proving:
//   • the caller has an authenticated N3 session
//   • the Job belongs to the caller's tenant (otherwise 404)
//   • the attachment belongs to that Job and is not deleted
// Every view/download is audited before the bytes are released.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/api/workspace/jobs/$jobId/attachments/$attachmentId/content",
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } =
          await import("@/lib/qne/session/current-user.server");
        const svc = await import("@/lib/qne/storage/job-attachments.server");
        const policy = await import("@/lib/qne/storage/attachment-policy");
        try {
          const user = await requireAuthenticatedN3User(request);
          const job = await svc.loadJobForAttachments(user.tenantCode, params.jobId);
          if (!job) return new Response("Not found", { status: 404 });

          const row = await svc.loadAttachment(user.tenantCode, params.jobId, params.attachmentId);
          if (!row || row.storage_provider !== svc.GOOGLE_DRIVE_PROVIDER) {
            return new Response("Not found", { status: 404 });
          }

          const drive = await svc.resolveDriveContext(user.tenantCode);
          if (!drive.ok) return new Response(drive.error, { status: drive.status });

          const disposition =
            new URL(request.url).searchParams.get("download") === "1" ||
            !policy.isPreviewableMime(row.mime_type)
              ? "attachment"
              : "inline";

          const files = await import("@/lib/qne/storage/drive-files.server");
          const actor = {
            tenantCode: user.tenantCode,
            userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName ?? null,
            isAdmin: Boolean(user.isAdministrator),
          };

          let upstream: Response;
          try {
            upstream = await files.fetchDriveFileStream(
              drive.context.accessToken,
              row.external_file_id ?? "",
            );
          } catch {
            upstream = new Response(null, { status: 502 });
          }

          // Provider success must be ESTABLISHED before anything is audited or
          // released. Google's own error body is never handed back as if it
          // were the attachment, and its text (which can carry provider and
          // credential detail) is never forwarded to the browser or logged.
          if (!upstream.ok || !upstream.body) {
            await upstream.body?.cancel().catch(() => undefined);
            await svc
              .logAttachmentEvent(actor, job.id, "attachment_content_failed", {
                newValue: row.file_name,
                note: `"${row.file_name}" could not be opened: the storage provider did not return the file (HTTP ${upstream.status}).`,
                metadata: { attachment_id: row.id, upstream_status: upstream.status },
              })
              .catch(() => undefined);
            const status = upstream.status === 404 ? 404 : upstream.status >= 500 ? 502 : 409;
            return new Response(
              status === 404
                ? "This file is no longer available in the connected Google Drive account."
                : "ServiceHub could not open this file from the connected Google Drive account. Nothing was changed — please try again.",
              {
                status,
                headers: {
                  "Content-Type": "text/plain; charset=utf-8",
                  "Cache-Control": "private, no-store",
                  "X-Content-Type-Options": "nosniff",
                },
              },
            );
          }

          // Only now — provider success proven — is the access audited. A lost
          // audit throws, and the bytes are not released.
          await svc.logAttachmentEvent(
            actor,
            job.id,
            disposition === "attachment" ? "attachment_downloaded" : "attachment_viewed",
            {
              newValue: row.file_name,
              note: `${disposition === "attachment" ? "Downloaded" : "Viewed"} attachment "${row.file_name}".`,
              metadata: { attachment_id: row.id },
            },
          );

          // Session-scoped bytes: never cacheable by a shared cache.
          return new Response(upstream.body, {
            status: 200,
            headers: {
              "Content-Type": row.mime_type || "application/octet-stream",
              "Content-Disposition": `${disposition}; filename="${policy.sanitizeDisplayName(row.file_name)}"`,
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[attachment content] failed", err);
          return new Response("The file could not be opened.", { status: 502 });
        }
      },
    },
  },
});
