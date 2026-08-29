// GET /api/integrations/google-drive/callback — deterministic Google redirect.
//
// This route is reached by the browser as a Google redirect, so it carries no
// N3 bearer. Authority comes from the single-use, expiring, server-bound state
// created by /api/integrations/google-drive/connect. Authorization codes and
// tokens are never placed in redirect URLs or logs.
//
// WP2A correction: the granted scope set must be exactly the approved
// drive.file scope, the account identity comes from Drive about.get, and a
// different Google account clears the previously saved Root Folder.

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
          revokeToken,
          loadConnection,
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

          const account = await fetchDriveAccount(token.access_token);
          const actor = {
            tenantCode: outcome.tenantCode,
            userId: outcome.actorUserId,
            name: outcome.actorName,
          };

          // P1-3: a different Google account may not inherit the old folder.
          const previous = await loadConnection(outcome.tenantCode);
          const previousId = previous?.google_account_permission_id ?? null;
          const accountChanged = Boolean(
            previous?.root_folder_id &&
            previousId &&
            account.permissionId &&
            previousId !== account.permissionId,
          );

          await applyConnection(
            actor,
            {
              status: "connected",
              google_account_email: account.email,
              google_account_permission_id: account.permissionId,
              access_token_ciphertext: await encryptSecret(token.access_token),
              access_token_expires_at: new Date(
                Date.now() + (token.expires_in ?? 3600) * 1000,
              ).toISOString(),
              refresh_token_ciphertext: await encryptSecret(token.refresh_token),
              cipher_version: 1,
              scopes: scopes.granted,
              last_error: null,
              connected_by_user_id: outcome.actorUserId,
              connected_by_name: outcome.actorName,
              ...(accountChanged
                ? {
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
                  }
                : {}),
            },
            accountChanged ? "account_changed" : "connected",
            { account: account.email },
          );
          return back(accountChanged ? "account_changed" : "connected");
        } catch {
          // Deliberately no error detail: it can contain code/token material.
          console.error("[google-drive callback] connection attempt failed");
          return back("exchange_failed");
        }
      },
    },
  },
});
