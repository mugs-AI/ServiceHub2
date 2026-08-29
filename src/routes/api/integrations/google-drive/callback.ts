// GET /api/integrations/google-drive/callback — deterministic Google redirect.
//
// This route is reached by the browser as a Google redirect, so it carries no
// N3 bearer. Authority comes from the single-use, expiring, server-bound state
// created by /api/integrations/google-drive/connect. Authorization codes and
// tokens are never placed in redirect URLs or logs.
//
// WP2A final patch:
//  • Identity FAILS CLOSED: a usable connection requires a successful Drive
//    about.get with a non-empty stable permissionId. Otherwise the new grant is
//    revoked, no tokens are persisted, and a known-good connection survives.
//  • Same-account reconnect REVALIDATES the saved Root Folder and reads the
//    real sharing status from Google before it may report "connected".
//  • Different (or unprovable) account clears folder/drive/sharing/ack.
//  • Every persisted change is atomic with its audit record.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/integrations/google-drive/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { CALLBACK_MESSAGE, validateGrantedScopes } =
          await import("@/lib/qne/storage/google-drive");
        const {
          consumeState,
          exchangeCode,
          fetchDriveAccount,
          applyConnection,
          auditDrive,
          revokeToken,
          loadConnection,
          revalidateFolder,
          readSharing,
          missingDriveEnv,
        } = await import("@/lib/qne/storage/google-drive.server");
        const { encryptSecret } = await import("@/lib/qne/storage/token-crypto.server");

        const url = new URL(request.url);
        const back = (outcome: keyof typeof CALLBACK_MESSAGE) =>
          Response.redirect(`${url.origin}/settings?drive=${outcome}`, 302);

        try {
          if (missingDriveEnv().length) return back("not_configured");
          if (url.searchParams.get("error")) return back("denied");

          const outcome = await consumeState(url.searchParams.get("state"));
          if (!outcome.ok) return back(outcome.reason);

          const code = url.searchParams.get("code");
          if (!code) return back("state_invalid");

          const token = await exchangeCode(code, outcome.verifier);
          if (!token.access_token || !token.refresh_token) return back("exchange_failed");

          // P1-1: reject (and revoke) anything outside the approved scope set.
          const scopes = validateGrantedScopes(token.scope);
          if (!scopes.ok) {
            await revokeToken(token.refresh_token);
            return back("scope_rejected");
          }

          const actor = {
            tenantCode: outcome.tenantCode,
            userId: outcome.actorUserId,
            name: outcome.actorName,
          };

          // ---- 1. Fail closed on Google account identity --------------------
          const account = await fetchDriveAccount(token.access_token);
          if (!account.ok || !account.permissionId) {
            // Revoke the grant we just received; never keep unattributable
            // credentials, and never touch an existing known-good connection.
            await revokeToken(token.refresh_token);
            try {
              await auditDrive(actor, "identity_failed", {
                reason: "Google did not return a stable Drive account identity (about.get).",
              });
            } catch {
              // The audit is best-effort here: nothing was persisted anyway.
            }
            return back("identity_failed");
          }

          const previous = await loadConnection(outcome.tenantCode);
          const previousId = previous?.google_account_permission_id ?? null;
          // Same account can only be claimed when the PREVIOUS identity is known.
          const sameAccount = Boolean(previousId && previousId === account.permissionId);
          const hadFolder = Boolean(previous?.root_folder_id);

          const credentials = {
            google_account_email: account.email,
            google_account_permission_id: account.permissionId,
            access_token_ciphertext: await encryptSecret(token.access_token),
            access_token_expires_at: new Date(
              Date.now() + (token.expires_in ?? 3600) * 1000,
            ).toISOString(),
            refresh_token_ciphertext: await encryptSecret(token.refresh_token),
            cipher_version: 1,
            scopes: scopes.granted,
            connected_by_user_id: outcome.actorUserId,
            connected_by_name: outcome.actorName,
          };

          const CLEARED = {
            root_folder_id: null,
            root_folder_name: null,
            drive_id: null,
            drive_context: null,
            detected_sharing_status: "unknown",
            sharing_detail: null,
            sharing_checked_at: null,
            public_sharing_acknowledged: false,
            sharing_confirmed_by_user_id: null,
            sharing_confirmed_by_name: null,
            sharing_confirmed_at: null,
          };

          // ---- 2a. Different / unprovable account: clear the mapping --------
          if (!sameAccount) {
            const mustClear = hadFolder || Boolean(previous);
            const changed = hadFolder;
            await applyConnection(
              actor,
              {
                ...credentials,
                status: "connected",
                last_error: changed
                  ? "The saved Root Folder was cleared because a different Google account is now connected."
                  : null,
                ...(mustClear ? CLEARED : {}),
              },
              changed ? "account_changed" : "connected",
              {
                account: account.email,
                previousIdentityKnown: Boolean(previousId),
                rootFolderCleared: changed,
              },
            );
            return back(changed ? "account_changed" : "connected");
          }

          // ---- 2b. Same account, no folder yet ------------------------------
          if (!previous?.root_folder_id) {
            await applyConnection(
              actor,
              { ...credentials, status: "connected", last_error: null },
              "connected",
              { account: account.email },
            );
            return back("connected");
          }

          // ---- 2c. Same account WITH a folder: revalidate before success ----
          const folder = await revalidateFolder(token.access_token, previous.root_folder_id);
          if (!folder.ok || !folder.folder) {
            const reason = `${folder.reason ?? "The saved Root Folder could not be confirmed."} ${
              folder.recovery ?? ""
            }`.trim();
            await applyConnection(
              actor,
              {
                ...credentials,
                status: "error",
                last_error: reason,
                detected_sharing_status: "unknown",
                sharing_detail: null,
                sharing_checked_at: null,
              },
              "reconnect_folder_invalid",
              { account: account.email, reason },
            );
            return back("folder_recheck_required");
          }

          const sharing = await readSharing(token.access_token, folder.folder.id);
          if (sharing.status === "error" || sharing.status === "unknown") {
            await applyConnection(
              actor,
              {
                ...credentials,
                status: "error",
                last_error:
                  "Google Drive re-authorised, but the folder's sharing status could not be read, so it is not reported as Restricted.",
                root_folder_name: folder.folder.name,
                drive_id: folder.folder.driveId,
                drive_context: folder.folder.driveContext,
                detected_sharing_status: sharing.status,
                sharing_detail: sharing.detail,
                sharing_checked_at: new Date().toISOString(),
              },
              "reconnect_sharing_unavailable",
              { account: account.email, detectedSharing: sharing.status },
            );
            return back("folder_recheck_required");
          }

          // A prior public-sharing acknowledgement survives ONLY when Google
          // still reports the same public risk right now.
          const keepAck =
            sharing.status === "anyone_with_link" && previous.public_sharing_acknowledged === true;

          await applyConnection(
            actor,
            {
              ...credentials,
              status: "connected",
              last_error: null,
              root_folder_name: folder.folder.name,
              drive_id: folder.folder.driveId,
              drive_context: folder.folder.driveContext,
              detected_sharing_status: sharing.status,
              sharing_detail: sharing.detail,
              sharing_checked_at: new Date().toISOString(),
              ...(keepAck
                ? {}
                : {
                    public_sharing_acknowledged: false,
                    sharing_confirmed_by_user_id: null,
                    sharing_confirmed_by_name: null,
                    sharing_confirmed_at: null,
                  }),
            },
            "reconnected",
            {
              account: account.email,
              detectedSharing: sharing.status,
              acknowledgementPreserved: keepAck,
            },
          );
          return back("connected");
        } catch {
          // Deliberately no error detail: it can contain code/token material.
          console.error("[google-drive callback] connection attempt failed");
          return back("exchange_failed");
        }
      },
    },
  },
});
