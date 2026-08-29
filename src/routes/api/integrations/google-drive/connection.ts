// GET/POST /api/integrations/google-drive/connection — Owner/Admin only.
//
// GET  → truthful connection status for the server-resolved tenant.
// POST → actions: test | create_folder | select_folder | picker_token
//                 | set_sharing | disconnect
//
// No response ever contains a refresh token, the Client Secret or ciphertext.
// The only token that can reach the browser is a short-lived drive.file access
// token requested explicitly for the Google Picker.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/integrations/google-drive/connection")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const gd = await import("@/lib/qne/storage/google-drive.server");
        const {
          toPublicConnection,
          NOT_CONNECTED,
          ATTACHMENTS_NOT_IMPLEMENTED_NOTICE,
          PUBLIC_SHARING_WARNING,
          PUBLIC_SHARING_CONFIRMATION,
          redirectUriFor,
          REQUIRED_ENV,
          OPTIONAL_ENV,
          GOOGLE_DRIVE_SCOPE,
          DEFAULT_ROOT_FOLDER_NAME,
        } = await import("@/lib/qne/storage/google-drive");
        try {
          const user = await requireAdministrator(request);
          const row = await gd.loadConnection(user.tenantCode);
          const missing = gd.missingDriveEnv();
          const { data: audit } = await (
            await import("@/integrations/supabase/client.server")
          ).supabaseAdmin
            .from("google_drive_audit_log")
            .select("action, detail, actor_name, created_at")
            .eq("tenant_code", user.tenantCode)
            .order("created_at", { ascending: false })
            .limit(10);

          return Response.json({
            tenantCode: user.tenantCode,
            connection: row ? toPublicConnection(row) : NOT_CONNECTED,
            configured: missing.length === 0,
            missingEnv: missing,
            requiredEnv: REQUIRED_ENV,
            optionalEnv: OPTIONAL_ENV,
            scope: GOOGLE_DRIVE_SCOPE,
            defaultFolderName: DEFAULT_ROOT_FOLDER_NAME,
            redirectUri:
              process.env["GOOGLE_DRIVE_REDIRECT_URI"] ??
              redirectUriFor(new URL(request.url).origin),
            pickerApiKeyConfigured: Boolean(gd.pickerApiKey()),
            pickerClientId: process.env["GOOGLE_DRIVE_CLIENT_ID"] ?? null,
            pickerApiKey: gd.pickerApiKey(),
            attachmentsNotice: ATTACHMENTS_NOT_IMPLEMENTED_NOTICE,
            sharingWarning: PUBLIC_SHARING_WARNING,
            sharingConfirmationText: PUBLIC_SHARING_CONFIRMATION,
            audit: audit ?? [],
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[google-drive connection GET] failed");
          return Response.json({ error: "Failed to load Google Drive settings" }, { status: 500 });
        }
      },

      POST: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const gd = await import("@/lib/qne/storage/google-drive.server");
        const {
          sanitizeFolderName,
          toPublicConnection,
          PUBLIC_SHARING_CONFIRMATION,
        } = await import("@/lib/qne/storage/google-drive");
        const { decryptSecret } = await import("@/lib/qne/storage/token-crypto.server");

        try {
          const user = await requireAdministrator(request);
          const actor = {
            tenantCode: user.tenantCode,
            userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName || user.email || null,
          };
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const action = String(body.action ?? "");

          if (gd.missingDriveEnv().length) {
            return Response.json(
              {
                error: "Google Drive is not configured for this deployment yet.",
                missingEnv: gd.missingDriveEnv(),
              },
              { status: 503 },
            );
          }

          const row = await gd.loadConnection(actor.tenantCode);
          if (!row) {
            return Response.json(
              {
                error: "Google Drive is not connected for this company.",
                recovery: "Use Connect Google Drive first.",
              },
              { status: 409 },
            );
          }

          // --- disconnect: revoke + wipe token material, keep metadata -----
          if (action === "disconnect") {
            if (body.confirm !== true) {
              return Response.json(
                { error: "Disconnect must be confirmed." },
                { status: 400 },
              );
            }
            let revoked = false;
            try {
              const refresh = await decryptSecret(row.refresh_token_ciphertext);
              if (refresh) revoked = await gd.revokeToken(refresh);
            } catch {
              revoked = false;
            }
            await gd.upsertConnection(actor.tenantCode, {
              status: "disconnected",
              access_token_ciphertext: null,
              access_token_expires_at: null,
              refresh_token_ciphertext: null,
              last_error: null,
              last_test_result: null,
            });
            await gd.auditDrive(actor, "disconnected", { revoked });
            return Response.json({
              ok: true,
              revoked,
              message:
                "Google Drive disconnected. Stored credentials were removed; your Drive folder and files were NOT deleted.",
            });
          }

          // Every remaining action needs a live Google credential.
          let accessToken: string;
          try {
            accessToken = await gd.accessTokenFor(row);
          } catch (e) {
            const recovery =
              e instanceof gd.DriveAuthError ? e.recovery : "Reconnect Google Drive from Settings.";
            return Response.json(
              {
                error: e instanceof Error ? e.message : "Google Drive credential unavailable.",
                recovery,
                status: "needs_reconnect",
              },
              { status: 409 },
            );
          }

          if (action === "test") {
            const about = await gd.driveAbout(accessToken);
            let message = about.message;
            let ok = about.ok;
            if (ok && row.root_folder_id) {
              const folder = await gd.revalidateFolder(accessToken, row.root_folder_id);
              ok = folder.ok;
              message = folder.ok
                ? `${about.message} Root folder "${folder.folder!.name}" is usable.`
                : `${folder.reason} ${folder.recovery}`;
            } else if (ok) {
              message = `${about.message} No Root Folder is selected yet.`;
            }
            await gd.upsertConnection(actor.tenantCode, {
              status: ok ? "connected" : "error",
              last_tested_at: new Date().toISOString(),
              last_test_result: message,
              last_error: ok ? null : message,
            });
            await gd.auditDrive(actor, "tested", { ok });
            return Response.json({ ok, message });
          }

          if (action === "picker_token") {
            // Short-lived drive.file token for the Google Picker only. It is
            // held in browser memory by the caller and never persisted.
            const apiKey = gd.pickerApiKey();
            if (!apiKey) {
              return Response.json(
                {
                  error: "GOOGLE_PICKER_API_KEY is not configured for this deployment.",
                  recovery: "Add the server-only GOOGLE_PICKER_API_KEY, or use Create New Folder.",
                },
                { status: 503 },
              );
            }
            await gd.auditDrive(actor, "picker_token_issued", {});
            return Response.json({
              accessToken,
              apiKey,
              appId: (process.env["GOOGLE_DRIVE_CLIENT_ID"] ?? "").split("-")[0] || null,
            });
          }

          if (action === "create_folder" || action === "select_folder") {
            const validated =
              action === "create_folder"
                ? await gd.createRootFolder(
                    accessToken,
                    sanitizeFolderName(body.name),
                    body.parentId ? String(body.parentId) : null,
                  )
                : await gd.revalidateFolder(accessToken, String(body.folderId ?? ""));

            if (!validated.ok || !validated.folder) {
              await gd.upsertConnection(actor.tenantCode, {
                last_error: validated.reason,
              });
              return Response.json(
                { error: validated.reason, recovery: validated.recovery },
                { status: 400 },
              );
            }
            const saved = await gd.upsertConnection(actor.tenantCode, {
              root_folder_id: validated.folder.id,
              root_folder_name: validated.folder.name,
              drive_id: validated.folder.driveId,
              drive_context: validated.folder.driveContext,
              status: "connected",
              last_error: null,
            });
            await gd.auditDrive(actor, action, {
              folderName: validated.folder.name,
              driveContext: validated.folder.driveContext,
            });
            return Response.json({ ok: true, connection: toPublicConnection(saved) });
          }

          if (action === "set_sharing") {
            const policy = String(body.sharingPolicy ?? "restricted");
            if (policy !== "restricted" && policy !== "anyone_with_link") {
              return Response.json({ error: "Unknown sharing policy." }, { status: 400 });
            }
            if (policy === "anyone_with_link" && body.confirm !== true) {
              return Response.json(
                {
                  error: "Public sharing requires an explicit risk confirmation.",
                  confirmationText: PUBLIC_SHARING_CONFIRMATION,
                },
                { status: 400 },
              );
            }
            const saved = await gd.upsertConnection(actor.tenantCode, {
              sharing_policy: policy,
              sharing_confirmed_by_user_id: policy === "anyone_with_link" ? actor.userId : null,
              sharing_confirmed_by_name: policy === "anyone_with_link" ? actor.name : null,
              sharing_confirmed_at:
                policy === "anyone_with_link" ? new Date().toISOString() : null,
            });
            await gd.auditDrive(actor, "sharing_policy_set", { policy });
            return Response.json({ ok: true, connection: toPublicConnection(saved) });
          }

          return Response.json({ error: "Unknown action." }, { status: 400 });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[google-drive connection POST] failed");
          return Response.json({ error: "Google Drive request failed" }, { status: 500 });
        }
      },
    },
  },
});
