// WP2B — the provider guard must hold on EVERY server mutation path, not only
// on the Google Drive connection route. This exercises the Owner storage
// settings endpoint, which can also disable Google Drive or repoint its Root
// Folder, and proves it refuses while live Drive attachments exist.

import { beforeEach, describe, expect, it, vi } from "vitest";

let isAdministrator = true;
class UnauthorizedError extends Error {}

vi.mock("@/lib/qne/session/current-user.server", () => ({
  requireAuthenticatedN3User: async () => ({
    tenantCode: "T1",
    isAdministrator,
    displayName: "Owner",
    email: "owner@t1.test",
    userCode: "u-owner",
    diagnostics: { matchedN3UserId: "u-owner" },
  }),
  guardResponse: (err: unknown) =>
    err instanceof UnauthorizedError
      ? Response.json({ error: "Unauthorized" }, { status: 401 })
      : null,
}));

// Every write this route can perform is recorded so the test can prove that
// a blocked change wrote nothing at all.
const writes: Array<{ table: string; op: string }> = [];
let currentRootFolderName: string | null = "ServiceHub Root";

function builder(table: string, op: string) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: async () => ({
      data: op === "select" ? { root_folder_name: currentRootFolderName } : null,
      error: null,
    }),
    single: async () => ({ data: null, error: null }),
    then: (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };
  if (op !== "select") writes.push({ table, op });
  return b;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => builder(table, "select"),
      insert: () => builder(table, "insert"),
      update: () => builder(table, "update"),
      upsert: () => builder(table, "upsert"),
    }),
  },
}));

const savedSettings: unknown[] = [];
vi.mock("@/lib/qne/service-jobs/tenant-settings.server", () => ({
  loadTenantSettings: async () => ({
    attachments: { storageMode: "google_drive", maxFileMb: 20, allowedMimeTypes: [] },
  }),
  saveTenantSettings: async (_t: string, patch: unknown) => {
    savedSettings.push(patch);
    return { attachments: { storageMode: "disabled" } };
  },
  auditSettings: async () => undefined,
}));

vi.mock("@/lib/qne/storage/provider.server", () => ({
  getAdapter: () => ({ id: "google_drive" }),
  googleDriveConfigured: () => true,
  GOOGLE_DRIVE_REQUIREMENT: "req",
  S3_REQUIREMENT: "req",
  GCS_REQUIREMENT: "req",
  STORAGE_RESPONSIBILITY_TEXT: "text",
  STORAGE_RESPONSIBILITY_VERSION: 1,
}));

let activeAttachments = 3;
vi.mock("@/lib/qne/storage/attachment-guard.server", () => ({
  guardProviderChange: async () =>
    activeAttachments > 0
      ? {
          blocked: true,
          count: activeAttachments,
          error: `${activeAttachments} attachments are stored in the connected Google Drive folder.`,
          recovery: "Delete or move those attachments first.",
        }
      : { blocked: false, count: 0 },
}));

type Handler = (arg: { request: Request }) => Promise<Response>;

async function post(body: unknown): Promise<Response> {
  const mod = (await import("@/routes/api/settings/storage")) as unknown as {
    Route: { options: { server: { handlers: Record<string, Handler> } } };
  };
  return mod.Route.options.server.handlers.POST({
    request: new Request("https://app.test/api/settings/storage", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  });
}

beforeEach(() => {
  writes.length = 0;
  savedSettings.length = 0;
  activeAttachments = 3;
  isAdministrator = true;
  currentRootFolderName = "ServiceHub Root";
});

describe("WP2B guard — Owner storage settings endpoint", () => {
  it("refuses to disconnect the provider while active Drive attachments exist, and writes nothing", async () => {
    const res = await post({ action: "disconnect", confirmation: true });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { activeAttachments: number; recovery: string };
    expect(body.activeAttachments).toBe(3);
    expect(body.recovery).toBeTruthy();
    // No change log, no availability flip, no connection deactivation.
    expect(writes).toHaveLength(0);
    expect(savedSettings).toHaveLength(0);
  });

  it("refuses to switch away from Google Drive while active Drive attachments exist", async () => {
    const res = await post({ action: "set_mode", storageMode: "disabled", confirmation: true });
    expect(res.status).toBe(409);
    expect(writes).toHaveLength(0);
  });

  it("refuses to repoint the Root Folder while active Drive attachments exist", async () => {
    const res = await post({
      action: "set_root_folder",
      provider: "google_drive",
      root_folder_name: "Somewhere Else",
    });
    expect(res.status).toBe(409);
    expect(writes).toHaveLength(0);
  });

  it("fails closed on a SAME-NAME Root Folder request: names are not identities", async () => {
    // Two distinct Drive folders can share a name and this legacy endpoint has
    // no immutable folder ID, so name equality must not act as a bypass.
    const res = await post({
      action: "set_root_folder",
      provider: "google_drive",
      root_folder_name: "ServiceHub Root",
    });
    expect(res.status).toBe(409);
    expect(writes).toHaveLength(0);
  });

  it("allows a Root Folder change once no active Drive attachments remain", async () => {
    activeAttachments = 0;
    const res = await post({
      action: "set_root_folder",
      provider: "google_drive",
      root_folder_name: "ServiceHub Root",
    });
    expect(res.status).toBe(200);
  });

  it("keeps exact same-root revalidation on the canonical connection route, which compares folderId", async () => {
    // Source evidence: the canonical route addresses the immutable Drive
    // folder ID, so it can safely allow an identical re-selection.
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/routes/api/integrations/google-drive/connection.ts", "utf8");
    expect(src).toContain("folderId");
    // The legacy settings endpoint must not compare names to decide.
    const legacy = await fs.readFile("src/routes/api/settings/storage.ts", "utf8");
    expect(legacy).not.toContain("currentRoot !== nextRoot");
  });

  it("allows the change once no active Drive attachments remain", async () => {
    activeAttachments = 0;
    const res = await post({ action: "disconnect", confirmation: true });
    // The guard no longer stops it: the request proceeds past the block and
    // reaches the real write path (this double does not model that path fully,
    // so only the absence of the 409 refusal is asserted here).
    expect(res.status).not.toBe(409);
    expect(writes.length).toBeGreaterThan(0);
  });

  it("still refuses a non-Owner before any guard or write is considered", async () => {
    isAdministrator = false;
    const res = await post({ action: "disconnect", confirmation: true });
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });
});
