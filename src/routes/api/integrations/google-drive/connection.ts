// GET/POST /api/integrations/google-drive/connection — Owner/Admin only.
//
// GET  → truthful connection status for the server-resolved tenant.
// POST → actions: test | create_folder | select_folder | picker_token
//                 | refresh_sharing | acknowledge_public_sharing | disconnect
//
// No response ever contains a refresh token, the Client Secret or ciphertext.
// The only token that can reach the browser is a short-lived drive.file access
// token requested explicitly for the Google Picker.
//
// WP2A correction: sharing status is read from Google (permissions.list) and
// never set by ServiceHub; every persisted change is atomic with its audit.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/integrations/google-drive/connection")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAdministrator, guardResponse } =
          await import("@/lib/qne/session/current-user.server");
        const gd = await import("@/lib/qne/storage/google-drive.server");
        const {
          toPublicConnection,
          NOT_CONNECTED,
          ATTACHMENTS_NOT_IMPLEMENTED_NOTICE,
          PUBLIC_SHARING_WARNING,
          PUBLIC_SHARING_CONFIRMATION,
          SHARING_READ_ONLY_NOTICE,
          SHARING_UNKNOWN_RECOVERY,
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
            attachmentsNotice: ATTACHMENTS_NOT_IMPLEMENTED_NOTICE,
            sharingWarning: PUBLIC_SHARING_WARNING,
            sharingConfirmationText: PUBLIC_SHARING_CONFIRMATION,
            sharingReadOnlyNotice: SHARING_READ_ONLY_NOTICE,
            sharingUnknownRecovery: SHARING_UNKNOWN_RECOVERY,
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
        const { requireAdministrator, guardResponse } =
          await import("@/lib/qne/session/current-user.server");
        const gd = await import("@/lib/qne/storage/google-drive.server");
        const { sanitizeFolderName, toPublicConnection, PUBLIC_SHARING_CONFIRMATION } =
          await import("@/lib/qne/storage/google-drive");
        const { decryptSecret } = await import("@/lib/qne/storage/token-crypto.server");

        try {
          const user = await requireAdministrator(request);
          // Tenant and actor are ALWAYS server-resolved; the body cannot choose them.
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

          // --- disconnect: revoke externally, then atomically wipe + audit --
          if (action === "disconnect") {
            if (body.confirm !== true) {
              return Response.json({ error: "Disconnect must be confirmed." }, { status: 400 });
            }
            let revoked = false;
            let revokeError: string | null = null;
            try {
              const refresh = await decryptSecret(row.refresh_token_ciphertext);
              if (!refresh) {
                revokeError = "No stored Google credential was available to revoke.";
              } else {
                revoked = await gd.revokeToken(refresh);
                if (!revoked) revokeError = "Google did not confirm the revoke request.";
              }
            } catch {
              revokeError = "The stored Google credential could not be read for revoke.";
            }
            // Local credentials are wiped whether or not Google confirmed.
            await gd.applyConnection(
              actor,
              {
                status: "disconnected",
                access_token_ciphertext: null,
                access_token_expires_at: null,
                refresh_token_ciphertext: null,
                last_error: revokeError,
                last_test_result: null,
                detected_sharing_status: "unknown",
                sharing_detail: null,
                sharing_checked_at: null,
              },
              "disconnected",
              { revoked, revokeError },
            );
            return Response.json({
              ok: true,
              revoked,
              revokeError,
              message: revoked
                ? "Google Drive disconnected and access revoked at Google. Your Drive folder and files were NOT deleted."
                : `Stored credentials were removed, but Google did not confirm the revoke (${revokeError ?? "unknown reason"}). Remove ServiceHub access in your Google Account security settings. Your Drive folder and files were NOT deleted.`,
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

          if (action === "test" || action === "refresh_sharing") {
            const about = await gd.driveAbout(accessToken);
            let ok = about.ok;
            let message = about.message;
            const patch: Record<string, unknown> = {};

            // P1-3: reconnect truth — the live account decides folder validity.
            const sameAccount =
              !about.account.permissionId ||
              !row.google_account_permission_id ||
              about.account.permissionId === row.google_account_permission_id;
            if (ok && !sameAccount) {
              ok = false;
              message =
                "Google Drive is now authorised by a different Google account. The saved Root Folder no longer applies — select a Root Folder again.";
              Object.assign(patch, {
                root_folder_id: null,
                root_folder_name: null,
                drive_id: null,
                drive_context: null,
                detected_sharing_status: "unknown",
                sharing_detail: null,
                sharing_checked_at: null,
                public_sharing_acknowledged: false,
              });
            } else if (ok) {
              patch.google_account_email = about.account.email;
              patch.google_account_permission_id = about.account.permissionId;
              if (row.root_folder_id) {
                const folder = await gd.revalidateFolder(accessToken, row.root_folder_id);
                if (!folder.ok) {
                  ok = false;
                  message = `${folder.reason} ${folder.recovery}`;
                } else {
                  const sharing = await gd.readSharing(accessToken, row.root_folder_id);
                  Object.assign(patch, {
                    root_folder_name: folder.folder!.name,
                    drive_id: folder.folder!.driveId,
                    drive_context: folder.folder!.driveContext,
                    detected_sharing_status: sharing.status,
                    sharing_detail: sharing.detail,
                    sharing_checked_at: new Date().toISOString(),
                  });
                  message = `${about.message} Root folder "${folder.folder!.name}" is usable. Sharing: ${sharing.detail}`;
                }
              } else {
                message = `${about.message} No Root Folder is selected yet.`;
              }
            }

            Object.assign(patch, {
              status: ok ? "connected" : "error",
              last_tested_at: new Date().toISOString(),
              last_test_result: message,
              last_error: ok ? null : message,
            });
            const saved = await gd.applyConnection(
              actor,
              patch,
              action === "test" ? "tested" : "sharing_checked",
              { ok },
            );
            return Response.json({
              ok,
              message,
              connection: toPublicConnection(saved),
            });
          }

          if (action === "picker_token") {
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
            // The token is only released once its issuance is recorded.
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
              await gd.applyConnection(
                actor,
                { last_error: validated.reason },
                `${action}_failed`,
                { reason: validated.reason },
              );
              return Response.json(
                { error: validated.reason, recovery: validated.recovery },
                { status: 400 },
              );
            }
            const sharing = await gd.readSharing(accessToken, validated.folder.id);
            const saved = await gd.applyConnection(
              actor,
              {
                root_folder_id: validated.folder.id,
                root_folder_name: validated.folder.name,
                drive_id: validated.folder.driveId,
                drive_context: validated.folder.driveContext,
                detected_sharing_status: sharing.status,
                sharing_detail: sharing.detail,
                sharing_checked_at: new Date().toISOString(),
                public_sharing_acknowledged: false,
                sharing_confirmed_by_user_id: null,
                sharing_confirmed_by_name: null,
                sharing_confirmed_at: null,
                status: "connected",
                last_error: null,
              },
              action,
              {
                folderName: validated.folder.name,
                driveContext: validated.folder.driveContext,
                detectedSharing: sharing.status,
              },
            );
            return Response.json({
              ok: true,
              connection: toPublicConnection(saved),
              sharing: { status: sharing.status, detail: sharing.detail },
            });
          }

          if (action === "acknowledge_public_sharing") {
            // Only meaningful when Google ACTUALLY reports public sharing now.
            const sharing = await gd.readSharing(accessToken, row.root_folder_id ?? "");
            if (sharing.status !== "anyone_with_link") {
              const saved = await gd.applyConnection(
                actor,
                {
                  detected_sharing_status: sharing.status,
                  sharing_detail: sharing.detail,
                  sharing_checked_at: new Date().toISOString(),
                  public_sharing_acknowledged: false,
                },
                "sharing_checked",
                { detectedSharing: sharing.status },
              );
              return Response.json(
                {
                  error:
                    "Google does not currently report public link sharing on this folder, so there is nothing to confirm.",
                  connection: toPublicConnection(saved),
                },
                { status: 409 },
              );
            }
            if (body.confirm !== true) {
              return Response.json(
                {
                  error: "Public sharing requires an explicit risk confirmation.",
                  confirmationText: PUBLIC_SHARING_CONFIRMATION,
                },
                { status: 400 },
              );
            }
            const saved = await gd.applyConnection(
              actor,
              {
                detected_sharing_status: sharing.status,
                sharing_detail: sharing.detail,
                sharing_checked_at: new Date().toISOString(),
                public_sharing_acknowledged: true,
                sharing_confirmed_by_user_id: actor.userId,
                sharing_confirmed_by_name: actor.name,
                sharing_confirmed_at: new Date().toISOString(),
              },
              "public_sharing_acknowledged",
              { detectedSharing: sharing.status, detail: sharing.detail },
            );
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
