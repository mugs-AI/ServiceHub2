// GET /api/integrations/google-drive/callback — deterministic Google redirect.
//
// This route is reached by the browser as a Google redirect, so it carries no
// N3 bearer. Authority comes from the single-use, expiring, server-bound state
// created by /api/integrations/google-drive/connect. Authorization codes and
// tokens are never placed in redirect URLs or logs.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/integrations/google-drive/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { CALLBACK_MESSAGE } = await import("@/lib/qne/storage/google-drive");
        const {
          consumeState,
          exchangeCode,
          fetchAccountEmail,
          upsertConnection,
          auditDrive,
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

          const email = await fetchAccountEmail(token.access_token);
          const actor = {
            tenantCode: outcome.tenantCode,
            userId: outcome.actorUserId,
            name: outcome.actorName,
          };

          await upsertConnection(outcome.tenantCode, {
            status: "connected",
            google_account_email: email,
            access_token_ciphertext: await encryptSecret(token.access_token),
            access_token_expires_at: new Date(
              Date.now() + (token.expires_in ?? 3600) * 1000,
            ).toISOString(),
            refresh_token_ciphertext: await encryptSecret(token.refresh_token),
            cipher_version: 1,
            scopes: (token.scope ?? "").split(" ").filter(Boolean),
            last_error: null,
            connected_by_user_id: outcome.actorUserId,
            connected_by_name: outcome.actorName,
          });
          await auditDrive(actor, "connected", { account: email });
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
