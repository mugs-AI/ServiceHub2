// GET/POST /api/settings/storage — tenant storage provider connections.
//
// Secrets are never returned to the browser. Changing or disconnecting a
// provider requires the client-responsibility confirmation, which is recorded.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/settings/storage")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadTenantSettings } = await import(
          "@/lib/qne/service-jobs/tenant-settings.server"
        );
        const {
          googleDriveConfigured,
          GOOGLE_DRIVE_REQUIREMENT,
          S3_REQUIREMENT,
          GCS_REQUIREMENT,
          STORAGE_RESPONSIBILITY_TEXT,
        } = await import("@/lib/qne/storage/provider.server");
        try {
          const user = await requireAuthenticatedN3User(request);
          if (!user.isAdministrator) {
            return Response.json({ error: "Owner access required." }, { status: 403 });
          }
          const settings = await loadTenantSettings(user.tenantCode);
          const { data, error } = await supabaseAdmin
            .from("tenant_storage_connections")
            .select(
              "id, provider, display_name, is_active, status, root_folder_id, root_folder_name, last_tested_at, last_test_result, updated_at",
            )
            .eq("tenant_code", user.tenantCode);
          if (error) throw error;

          const { data: changes } = await supabaseAdmin
            .from("storage_change_log")
            .select("*")
            .eq("tenant_code", user.tenantCode)
            .order("created_at", { ascending: false })
            .limit(10);

          // Usage figure the Owner can act on (bytes stored for this tenant).
          const { data: usage } = await supabaseAdmin
            .from("service_job_attachments")
            .select("file_size")
            .eq("tenant_code", user.tenantCode)
            .eq("is_deleted", false);
          const usedBytes = (usage ?? []).reduce((n, r) => n + (r.file_size ?? 0), 0);

          return Response.json({
            settings: settings.attachments,
            connections: data ?? [],
            changes: changes ?? [],
            usedBytes,
            responsibilityText: STORAGE_RESPONSIBILITY_TEXT,
            providerReadiness: {
              google_drive: googleDriveConfigured()
                ? { ready: true, requirement: null }
                : { ready: false, requirement: GOOGLE_DRIVE_REQUIREMENT },
              s3: { ready: false, requirement: S3_REQUIREMENT },
              gcs: { ready: false, requirement: GCS_REQUIREMENT },
              supabase: { ready: true, requirement: null },
              disabled: { ready: true, requirement: null },
            },
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/storage GET] failed", err);
          return Response.json({ error: "Failed to load storage settings" }, { status: 500 });
        }
      },

      POST: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadTenantSettings, saveTenantSettings, auditSettings } = await import(
          "@/lib/qne/service-jobs/tenant-settings.server"
        );
        const { STORAGE_MODES } = await import("@/lib/qne/service-jobs/tenant-settings");
        const {
          getAdapter,
          googleDriveConfigured,
          GOOGLE_DRIVE_REQUIREMENT,
          STORAGE_RESPONSIBILITY_TEXT,
          STORAGE_RESPONSIBILITY_VERSION,
        } = await import("@/lib/qne/storage/provider.server");
        try {
          const user = await requireAuthenticatedN3User(request);
          if (!user.isAdministrator) {
            return Response.json({ error: "Owner access required." }, { status: 403 });
          }
          const actor = {
            userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName || user.email || null,
          };
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const action = String(body.action ?? "");
          const settings = await loadTenantSettings(user.tenantCode);

          if (action === "test") {
            const provider = String(body.provider ?? settings.attachments.storageMode);
            const result = await getAdapter(provider as never).testConnection();
            await supabaseAdmin
              .from("tenant_storage_connections")
              .upsert(
                {
                  tenant_code: user.tenantCode,
                  provider,
                  status: result.ok ? "connected" : "not_connected",
                  last_tested_at: new Date().toISOString(),
                  last_test_result: result.message,
                },
                { onConflict: "tenant_code,provider" },
              );
            return Response.json(result);
          }

          if (action === "connect_google_drive") {
            if (!googleDriveConfigured()) {
              return Response.json(
                {
                  ok: false,
                  error: "Google Drive OAuth is not configured for this deployment.",
                  requirement: GOOGLE_DRIVE_REQUIREMENT,
                },
                { status: 400 },
              );
            }
            // Credentials exist: hand back the consent URL for the Owner.
            const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
            url.searchParams.set("client_id", process.env["GOOGLE_DRIVE_CLIENT_ID"]!);
            url.searchParams.set("redirect_uri", process.env["GOOGLE_DRIVE_REDIRECT_URI"]!);
            url.searchParams.set("response_type", "code");
            url.searchParams.set("access_type", "offline");
            url.searchParams.set("prompt", "consent");
            url.searchParams.set("scope", "https://www.googleapis.com/auth/drive.file");
            url.searchParams.set("state", user.tenantCode);
            return Response.json({ ok: true, authorizationUrl: url.toString() });
          }

          // WP2B — this endpoint can disable/leave Google Drive or repoint its
          // Root Folder, so it carries the SAME guard as the Google Drive
          // connection and OAuth callback routes. It runs before any
          // storage_change_log write, availability change, connection status
          // change or settings mutation.
          const guard = await import("@/lib/qne/storage/attachment-guard.server");
          const blockIfActiveDriveAttachments = async (
            guardedAction: Parameters<typeof guard.guardProviderChange>[1],
          ) => {
            const outcome = await guard.guardProviderChange(user.tenantCode, guardedAction);
            if (!outcome.blocked) return null;
            return Response.json(
              {
                error: outcome.error,
                recovery: outcome.recovery,
                activeAttachments: outcome.count,
              },
              { status: 409 },
            );
          };

          if (action === "set_mode" || action === "disconnect") {
            const nextMode =
              action === "disconnect" ? "disabled" : String(body.storageMode ?? "disabled");
            if (!(STORAGE_MODES as readonly string[]).includes(nextMode)) {
              return Response.json({ error: "Unknown storage mode." }, { status: 400 });
            }
            const oldMode = settings.attachments.storageMode;
            // Leaving Google Drive orphans live attachment metadata from its
            // bytes. A same-mode no-op changes no addressing and is allowed.
            if (oldMode === "google_drive" && nextMode !== oldMode) {
              const blocked = await blockIfActiveDriveAttachments(
                action === "disconnect" ? "disconnect" : "change_storage_provider",
              );
              if (blocked) return blocked;
            }
            if (nextMode !== oldMode) {
              if (body.confirmation !== true) {
                return Response.json(
                  {
                    error: "Client responsibility confirmation is required.",
                    responsibilityText: STORAGE_RESPONSIBILITY_TEXT,
                  },
                  { status: 400 },
                );
              }
              await supabaseAdmin.from("storage_change_log").insert({
                tenant_code: user.tenantCode,
                old_provider: oldMode,
                new_provider: nextMode,
                confirmed_by_user_id: actor.userId,
                confirmed_by_name: actor.name,
                confirmation_text: STORAGE_RESPONSIBILITY_TEXT,
                confirmation_text_version: STORAGE_RESPONSIBILITY_VERSION,
              });
              // Old attachment metadata is preserved; objects stored with the
              // previous provider are simply marked unavailable.
              await supabaseAdmin
                .from("service_job_attachments")
                .update({ availability_status: "unavailable" })
                .eq("tenant_code", user.tenantCode)
                .eq("storage_provider", oldMode)
                .neq("storage_provider", nextMode);
              await supabaseAdmin
                .from("tenant_storage_connections")
                .upsert(
                  {
                    tenant_code: user.tenantCode,
                    provider: oldMode,
                    is_active: false,
                    status: "disconnected",
                  },
                  { onConflict: "tenant_code,provider" },
                );
            }
            const saved = await saveTenantSettings(
              user.tenantCode,
              {
                ...settings,
                attachments: { ...settings.attachments, storageMode: nextMode as never },
              },
              actor,
              "attachments_storage",
            );
            return Response.json({ ok: true, settings: saved.attachments });
          }

          if (action === "save_limits") {
            const saved = await saveTenantSettings(
              user.tenantCode,
              {
                ...settings,
                attachments: {
                  ...settings.attachments,
                  ...((body.attachments ?? {}) as Record<string, never>),
                  storageMode: settings.attachments.storageMode,
                },
              },
              actor,
              "attachments_limits",
            );
            return Response.json({ ok: true, settings: saved.attachments });
          }

          if (action === "set_root_folder") {
            const provider = String(body.provider ?? "google_drive");
            await supabaseAdmin.from("tenant_storage_connections").upsert(
              {
                tenant_code: user.tenantCode,
                provider,
                root_folder_name: String(body.root_folder_name ?? "").slice(0, 200) || null,
              },
              { onConflict: "tenant_code,provider" },
            );
            await auditSettings(
              user.tenantCode,
              "attachments_storage",
              "root_folder",
              null,
              { provider, root_folder_name: body.root_folder_name },
              actor,
            );
            return Response.json({ ok: true });
          }

          return Response.json({ error: "Unknown action." }, { status: 400 });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/storage POST] failed", err);
          return Response.json({ error: "Failed to update storage settings" }, { status: 500 });
        }
      },
    },
  },
});
