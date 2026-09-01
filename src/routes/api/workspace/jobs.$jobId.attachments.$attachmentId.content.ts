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
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const svc = await import("@/lib/qne/storage/job-attachments.server");
        const policy = await import("@/lib/qne/storage/attachment-policy");
        try {
          const user = await requireAuthenticatedN3User(request);
          const job = await svc.loadJobForAttachments(user.tenantCode, params.jobId);
          if (!job) return new Response("Not found", { status: 404 });

          const row = await svc.loadAttachment(
            user.tenantCode,
            params.jobId,
            params.attachmentId,
          );
          if (!row || row.storage_provider !== svc.GOOGLE_DRIVE_PROVIDER) {
            return new Response("Not found", { status: 404 });
          }

          const drive = await svc.resolveDriveContext(user.tenantCode);
          if (!drive.ok) return new Response(drive.error, { status: drive.status });

          const disposition =
            new URL(request.url).searchParams.get("download") === "1" ||
            !policy.isPreviewableMime(row.mime_type, row.file_name)
              ? "attachment"
              : "inline";

          const files = await import("@/lib/qne/storage/drive-files.server");
          const upstream = await files.fetchDriveFileStream(
            drive.context.accessToken,
            row.external_file_id ?? "",
          );

          await svc.logAttachmentEvent(
            {
              tenantCode: user.tenantCode,
              userId: user.userId ?? null,
              name: user.displayName ?? null,
              isAdmin: Boolean(user.isAdministrator),
            },
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
