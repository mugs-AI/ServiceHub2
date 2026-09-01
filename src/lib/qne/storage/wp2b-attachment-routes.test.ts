// WP2B — route-level security and behaviour evidence.
//
// The real handlers run against in-memory doubles for the database and for
// Google Drive, so these tests exercise the server's own enforcement rather
// than the UI's.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* ---------------- session double ---------------- */

interface FakeUser {
  tenantCode: string;
  isAdministrator: boolean;
  userId: string | null;
  displayName: string;
  email: string;
}

let session: FakeUser | null = null;
class UnauthorizedError extends Error {}

vi.mock("@/lib/qne/session/current-user.server", () => ({
  requireAuthenticatedN3User: async () => {
    if (!session) throw new UnauthorizedError("Authentication required");
    return {
      tenantCode: session.tenantCode,
      isAdministrator: session.isAdministrator,
      displayName: session.displayName,
      email: session.email,
      userCode: null,
      diagnostics: { matchedN3UserId: session.userId },
    };
  },
  guardResponse: (err: unknown) =>
    err instanceof UnauthorizedError
      ? Response.json({ error: "Unauthorized" }, { status: 401 })
      : null,
}));

/* ---------------- supabase double ---------------- */

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let insertFailsFor: string | null = null;

interface Filter {
  col: string;
  value: unknown;
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => row[f.col] === f.value);
}

function query(table: string, op: "select" | "update" | "insert" | "upsert", payload?: Row) {
  const filters: Filter[] = [];
  const rows = () => (db[table] ??= []);

  const run = (): Row[] => {
    if (op === "insert" || op === "upsert") {
      const row = { id: `row-${Math.random().toString(36).slice(2, 10)}`, ...(payload as Row) };
      rows().push(row);
      return [row];
    }
    const hit = rows().filter((r) => matches(r, filters));
    if (op === "update") hit.forEach((r) => Object.assign(r, payload));
    return hit.map((r) => ({ ...r }));
  };

  const fail = (op === "insert" || op === "upsert") && insertFailsFor === table;

  const builder: Record<string, unknown> = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    eq: (col: string, value: unknown) => (filters.push({ col, value }), builder),
    maybeSingle: async () =>
      fail
        ? { data: null, error: { message: "insert refused" } }
        : { data: run()[0] ?? null, error: null },
    single: async () =>
      fail
        ? { data: null, error: { message: "insert refused" } }
        : { data: run()[0] ?? null, error: null },
    then: (resolve: (v: { data: Row[] | null; error: unknown }) => unknown) =>
      Promise.resolve(
        fail ? { data: null, error: { message: "insert refused" } } : { data: run(), error: null },
      ).then(resolve),
  };
  return builder;
}

const signedUrls = vi.fn(async (paths: string[]) => ({
  data: paths.map((p) => ({ path: p, signedUrl: `https://signed.test/${p}` })),
  error: null,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => query(table, "select"),
      update: (patch: Row) => query(table, "update", patch),
      insert: (row: Row) => query(table, "insert", row),
      upsert: (row: Row) => query(table, "upsert", row),
    }),
    storage: { from: () => ({ createSignedUrls: signedUrls }) },
  },
}));

/* ---------------- google drive doubles ---------------- */

let connection: Row | null = null;
let tokenFails = false;

vi.mock("@/lib/qne/storage/google-drive.server", () => ({
  missingDriveEnv: () => [],
  loadConnection: async () => connection,
  accessTokenFor: async () => {
    if (tokenFails) throw new Error("The Google Drive credential could not be refreshed.");
    return "drive-token";
  },
}));

const driveCalls: string[] = [];
let uploadFails = false;
let trashResult: { ok: boolean; reason?: string } = { ok: true };
let streamStatus = 200;

vi.mock("@/lib/qne/storage/drive-files.server", () => ({
  ensureJobFolder: async () => {
    driveCalls.push("ensureJobFolder");
    return "folder-1";
  },
  uploadFileToFolder: async () => {
    driveCalls.push("upload");
    if (uploadFails) throw new Error("Drive rejected the upload.");
    return { id: `drive-${driveCalls.length}`, name: "f" };
  },
  trashDriveFile: async () => {
    driveCalls.push("trash");
    return trashResult;
  },
  fetchDriveFileStream: async () => {
    driveCalls.push("stream");
    if (streamStatus !== 200) {
      return new Response("Google error body with credential detail", { status: streamStatus });
    }
    return new Response("bytes", { status: 200 });
  },
}));

/* ---------------- helpers ---------------- */

type Handler = (arg: { request: Request; params: Record<string, string> }) => Promise<Response>;

async function handlers(path: string): Promise<Record<string, Handler>> {
  const mod = (await import(path)) as {
    Route: { options: { server: { handlers: Record<string, Handler> } } };
  };
  return mod.Route.options.server.handlers;
}

const attachmentsRoute = () => handlers("@/routes/api/workspace/jobs.$jobId.attachments");
const contentRoute = () =>
  handlers("@/routes/api/workspace/jobs.$jobId.attachments.$attachmentId.content");

const JOB_ID = "job-1";

function seedJob(patch: Row = {}) {
  db["service_jobs"] = [
    {
      id: JOB_ID,
      tenant_code: "T1",
      job_number: "JB26010101",
      assigned_user_id: "u-pic",
      is_deleted: false,
      ...patch,
    },
  ];
}

function seedAttachment(patch: Row = {}): Row {
  const row: Row = {
    id: "att-1",
    tenant_code: "T1",
    service_job_id: JOB_ID,
    attachment_type: "document",
    file_name: "report.pdf",
    mime_type: "application/pdf",
    file_size: 1024,
    storage_path: "google-drive:drive-1",
    storage_provider: "google_drive",
    storage_connection_id: "conn-1",
    storage_container: "folder-1",
    external_file_id: "drive-1",
    visibility: "internal",
    availability_status: "available",
    is_deleted: false,
    uploaded_by_user_id: "u-uploader",
    uploaded_by_name_snapshot: "Uploader",
    created_at: "2026-09-01T00:00:00.000Z",
    ...patch,
  };
  db["service_job_attachments"] = [...(db["service_job_attachments"] ?? []), row];
  return row;
}

function upload(file: File): Request {
  const form = new FormData();
  form.append("file", file, file.name);
  return new Request("https://app.test/api", { method: "POST", body: form });
}

const pdf = (name = "report.pdf", size = 1024) =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" });

const log = (type: string) =>
  (db["service_job_activity_log"] ?? []).filter((r) => r.event_type === type);

const attachments = () => db["service_job_attachments"] ?? [];

const HELPER: FakeUser = {
  tenantCode: "T1",
  isAdministrator: false,
  userId: "u-helper",
  displayName: "Helper",
  email: "helper@t1.test",
};

// Warm the route modules once: the first dynamic import compiles the whole
// route graph and can exceed the default per-test timeout under load.
beforeAll(async () => {
  await attachmentsRoute();
  await contentRoute();
}, 60_000);

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  driveCalls.length = 0;
  session = HELPER;
  insertFailsFor = null;
  uploadFails = false;
  tokenFails = false;
  trashResult = { ok: true };
  streamStatus = 200;
  connection = {
    id: "conn-1",
    status: "connected",
    root_folder_id: "root-1",
    google_account_email: "owner@t1.test",
  };
  seedJob();
});

/* ---------------- tenant isolation ---------------- */

describe("WP2B tenant isolation", () => {
  it("returns 404 for a Job that belongs to another company", async () => {
    seedJob({ tenant_code: "T2" });
    const h = await attachmentsRoute();
    const res = await h.GET({
      request: new Request("https://app.test/api"),
      params: { jobId: JOB_ID },
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a Job that does not exist", async () => {
    const h = await attachmentsRoute();
    const res = await h.GET({
      request: new Request("https://app.test/api"),
      params: { jobId: "nope" },
    });
    expect(res.status).toBe(404);
  });

  it("refuses an unauthenticated caller", async () => {
    session = null;
    const h = await attachmentsRoute();
    const res = await h.POST({ request: upload(pdf()), params: { jobId: JOB_ID } });
    expect(res.status).toBe(401);
  });

  it("does not upload to a Job in another company", async () => {
    seedJob({ tenant_code: "T2" });
    const h = await attachmentsRoute();
    const res = await h.POST({ request: upload(pdf()), params: { jobId: JOB_ID } });
    expect(res.status).toBe(404);
    expect(driveCalls).toHaveLength(0);
  });
});

/* ---------------- connection state ---------------- */

describe("WP2B Drive connection requirements", () => {
  it("refuses upload when Google Drive is not connected", async () => {
    connection = null;
    const h = await attachmentsRoute();
    const res = await h.POST({ request: upload(pdf()), params: { jobId: JOB_ID } });
    expect(res.status).toBe(409);
    expect(attachments()).toHaveLength(0);
  });

  it("refuses upload when the connection needs reconnecting", async () => {
    connection = { ...(connection as Row), status: "needs_reconnect" };
    const h = await attachmentsRoute();
    const res = await h.POST({ request: upload(pdf()), params: { jobId: JOB_ID } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/re-authorised/i);
  });

  it("refuses upload when no Root Folder is selected", async () => {
    connection = { ...(connection as Row), root_folder_id: null };
    const h = await attachmentsRoute();
    const res = await h.POST({ request: upload(pdf()), params: { jobId: JOB_ID } });
    expect(res.status).toBe(409);
  });

  it("refuses upload when the credential cannot be refreshed", async () => {
    tokenFails = true;
    const h = await attachmentsRoute();
    const res = await h.POST({ request: upload(pdf()), params: { jobId: JOB_ID } });
    expect(res.status).toBe(409);
    expect(driveCalls).toHaveLength(0);
  });
});

/* ---------------- upload behaviour ---------------- */

describe("WP2B upload", () => {
  it("stores a Drive-backed, internal-only attachment and audits it", async () => {
    const h = await attachmentsRoute();
    const res = await h.POST({ request: upload(pdf()), params: { jobId: JOB_ID } });
    expect(res.status).toBe(200);

    const row = attachments()[0];
    expect(row.storage_provider).toBe("google_drive");
    expect(row.storage_connection_id).toBe("conn-1");
    expect(String(row.external_file_id)).toMatch(/^drive-/);
    expect(row.visibility).toBe("internal");
    expect(row.uploaded_by_user_id).toBe("u-helper");
    expect(log("attachment_uploaded")).toHaveLength(1);
  });

  it("rejects a blocked file type on the server without touching Drive", async () => {
    const h = await attachmentsRoute();
    const exe = new File([new Uint8Array(16)], "setup.exe", { type: "application/octet-stream" });
    const res = await h.POST({ request: upload(exe), params: { jobId: JOB_ID } });
    expect(res.status).toBe(400);
    expect(driveCalls).toHaveLength(0);
    expect(attachments()).toHaveLength(0);
  });

  it("rejects an oversized file on the server", async () => {
    const h = await attachmentsRoute();
    const big = new File([new Uint8Array(21 * 1024 * 1024)], "big.pdf", {
      type: "application/pdf",
    });
    const res = await h.POST({ request: upload(big), params: { jobId: JOB_ID } });
    expect(res.status).toBe(400);
    expect(driveCalls).toHaveLength(0);
  });

  it("enforces the active file count even when the browser does not", async () => {
    for (let i = 0; i < 10; i += 1) seedAttachment({ id: `att-${i}`, file_size: 10 });
    const h = await attachmentsRoute();
    const res = await h.POST({ request: upload(pdf()), params: { jobId: JOB_ID } });
    expect(res.status).toBe(409);
    expect(driveCalls).toHaveLength(0);
  });

  it("enforces the per-Job total size", async () => {
    seedAttachment({ id: "att-big", file_size: 100 * 1024 * 1024 - 10 });
    const h = await attachmentsRoute();
    const res = await h.POST({
      request: upload(pdf("report.pdf", 2048)),
      params: { jobId: JOB_ID },
    });
    expect(res.status).toBe(409);
  });

  it("reports a Drive failure truthfully and stores nothing", async () => {
    uploadFails = true;
    const h = await attachmentsRoute();
    const res = await h.POST({ request: upload(pdf()), params: { jobId: JOB_ID } });
    expect(res.status).toBe(502);
    expect(attachments()).toHaveLength(0);
    expect(log("attachment_upload_failed")).toHaveLength(1);
  });

  it("trashes the orphan file when the metadata row cannot be written", async () => {
    insertFailsFor = "service_job_attachments";
    const h = await attachmentsRoute();
    const res = await h.POST({ request: upload(pdf()), params: { jobId: JOB_ID } });
    expect(res.status).toBe(500);
    expect(driveCalls).toContain("trash");
  });

  it("sanitises a path-like filename before storing it", async () => {
    const h = await attachmentsRoute();
    const sneaky = new File([new Uint8Array(32)], "../../etc/report.pdf", {
      type: "application/pdf",
    });
    const res = await h.POST({ request: upload(sneaky), params: { jobId: JOB_ID } });
    expect(res.status).toBe(200);
    expect(attachments()[0].file_name).toBe("report.pdf");
  });
});

/* ---------------- listing ---------------- */

describe("WP2B listing", () => {
  it("never exposes a Drive URL, token or file id to the browser", async () => {
    seedAttachment();
    const h = await attachmentsRoute();
    const res = await h.GET({
      request: new Request("https://app.test/api"),
      params: { jobId: JOB_ID },
    });
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("drive-token");
    expect(text).not.toContain("googleapis.com");
    expect(text).not.toContain("drive-1");
    expect(text).toContain(`/api/workspace/jobs/${JOB_ID}/attachments/att-1/content`);
  });

  it("keeps legacy Supabase attachments readable", async () => {
    seedAttachment({
      id: "att-legacy",
      storage_provider: "supabase",
      storage_path: "T1/job-1/legacy.pdf",
      external_file_id: null,
    });
    const h = await attachmentsRoute();
    const res = await h.GET({
      request: new Request("https://app.test/api"),
      params: { jobId: JOB_ID },
    });
    const body = (await res.json()) as { attachments: Array<Record<string, unknown>> };
    const legacy = body.attachments.find((a) => a.id === "att-legacy")!;
    expect(legacy.legacyUrl).toContain("https://signed.test/");
  });

  it("reports Delete availability per row from the server's own rule", async () => {
    seedAttachment({ id: "att-mine", uploaded_by_user_id: "u-helper" });
    seedAttachment({ id: "att-theirs", uploaded_by_user_id: "u-someone" });
    const h = await attachmentsRoute();
    const res = await h.GET({
      request: new Request("https://app.test/api"),
      params: { jobId: JOB_ID },
    });
    const body = (await res.json()) as { attachments: Array<Record<string, unknown>> };
    expect(body.attachments.find((a) => a.id === "att-mine")!.canDelete).toBe(true);
    expect(body.attachments.find((a) => a.id === "att-theirs")!.canDelete).toBe(false);
  });
});

/* ---------------- content proxy ---------------- */

describe("WP2B content proxy", () => {
  it("streams an attachment to an authorised teammate and audits the view", async () => {
    seedAttachment();
    const h = await contentRoute();
    const res = await h.GET({
      request: new Request("https://app.test/api"),
      params: { jobId: JOB_ID, attachmentId: "att-1" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(log("attachment_viewed")).toHaveLength(1);
  });

  it("audits a download separately from a preview", async () => {
    seedAttachment();
    const h = await contentRoute();
    await h.GET({
      request: new Request("https://app.test/api?download=1"),
      params: { jobId: JOB_ID, attachmentId: "att-1" },
    });
    expect(log("attachment_downloaded")).toHaveLength(1);
  });

  it("refuses an attachment from another company", async () => {
    seedJob({ tenant_code: "T2" });
    seedAttachment({ tenant_code: "T2" });
    const h = await contentRoute();
    const res = await h.GET({
      request: new Request("https://app.test/api"),
      params: { jobId: JOB_ID, attachmentId: "att-1" },
    });
    expect(res.status).toBe(404);
    expect(driveCalls).not.toContain("stream");
  });
});

/* ---------------- delete ---------------- */

describe("WP2B delete", () => {
  const del = async (id = "att-1") => {
    const h = await attachmentsRoute();
    return h.DELETE({
      request: new Request(`https://app.test/api?id=${id}`, { method: "DELETE" }),
      params: { jobId: JOB_ID },
    });
  };

  it("refuses a teammate who is neither uploader, PIC nor admin", async () => {
    seedAttachment();
    const res = await del();
    expect(res.status).toBe(403);
    expect(attachments()[0].is_deleted).toBe(false);
    expect(driveCalls).not.toContain("trash");
  });

  it("allows the uploader, trashes on Drive first, then soft-deletes and audits", async () => {
    seedAttachment({ uploaded_by_user_id: "u-helper" });
    const res = await del();
    expect(res.status).toBe(200);
    expect(driveCalls).toContain("trash");
    const row = attachments()[0];
    expect(row.is_deleted).toBe(true);
    expect(row.remote_delete_status).toBe("trashed");
    expect(log("attachment_deleted")).toHaveLength(1);
  });

  it("allows the Primary PIC", async () => {
    session = { ...HELPER, userId: "u-pic" };
    seedAttachment();
    expect((await del()).status).toBe(200);
  });

  it("allows an Owner/Admin", async () => {
    session = { ...HELPER, isAdministrator: true };
    seedAttachment();
    expect((await del()).status).toBe(200);
  });

  it("leaves the attachment ACTIVE when Google Drive cannot trash the file", async () => {
    trashResult = { ok: false, reason: "Drive refused." };
    seedAttachment({ uploaded_by_user_id: "u-helper" });
    const res = await del();
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; stillActive: boolean };
    expect(body.stillActive).toBe(true);
    expect(body.error).toMatch(/NOT deleted/);
    const row = attachments()[0];
    expect(row.is_deleted).toBe(false);
    expect(row.remote_delete_status).toBe("failed");
    expect(log("attachment_delete_failed")).toHaveLength(1);
    expect(log("attachment_deleted")).toHaveLength(0);
  });

  it("does not soft-delete when the Drive connection is unusable", async () => {
    connection = null;
    seedAttachment({ uploaded_by_user_id: "u-helper" });
    const res = await del();
    expect(res.status).toBe(409);
    expect(attachments()[0].is_deleted).toBe(false);
  });

  it("returns 404 for an attachment id that is not on this Job", async () => {
    seedAttachment();
    const h = await attachmentsRoute();
    const res = await h.DELETE({
      request: new Request("https://app.test/api?id=att-other", { method: "DELETE" }),
      params: { jobId: JOB_ID },
    });
    expect(res.status).toBe(404);
  });
});

/* ---------------- provider switch guard ---------------- */

describe("WP2B provider / account / root guard", () => {
  it("blocks while active Drive attachments exist", async () => {
    seedAttachment();
    const guard = await import("./attachment-guard.server");
    const verdict = await guard.guardProviderChange("T1", "disconnect");
    expect(verdict.blocked).toBe(true);
    expect(verdict.count).toBe(1);
    expect(verdict.error).toMatch(/disconnect Google Drive/);
  });

  it("does not block once every attachment is deleted", async () => {
    seedAttachment({ is_deleted: true });
    const guard = await import("./attachment-guard.server");
    expect((await guard.guardProviderChange("T1", "change_root_folder")).blocked).toBe(false);
  });

  it("ignores legacy Supabase attachments — they do not depend on Drive", async () => {
    seedAttachment({ storage_provider: "supabase" });
    const guard = await import("./attachment-guard.server");
    expect((await guard.guardProviderChange("T1", "change_account")).blocked).toBe(false);
  });

  it("scopes the count to the caller's company", async () => {
    seedAttachment({ tenant_code: "T2" });
    const guard = await import("./attachment-guard.server");
    expect((await guard.guardProviderChange("T1", "disconnect")).blocked).toBe(false);
  });
});

/* ---------------- correction evidence ---------------- */

describe("WP2B correction — mandatory upload audit is not optional", () => {
  it("rolls the upload back and reports failure when the Job history record cannot be written", async () => {
    insertFailsFor = "service_job_activity_log";
    const h = await attachmentsRoute();
    const res = await h.POST({ request: upload(pdf()), params: { jobId: JOB_ID } });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("was NOT attached");
    // The Drive object is trashed and the row is soft-deleted, so nothing is
    // left that the user can see but ServiceHub cannot account for.
    expect(driveCalls).toContain("trash");
    expect(attachments().every((r) => r.is_deleted === true)).toBe(true);
  });
});

describe("WP2B correction — content route only releases proven bytes", () => {
  it("does not pass a Google error body off as the attachment, and does not audit a view", async () => {
    seedAttachment();
    streamStatus = 500;
    const h = await contentRoute();
    const res = await h.GET({
      request: new Request("https://app.test/api"),
      params: { jobId: JOB_ID, attachmentId: "att-1" },
    });

    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("credential detail");
    expect(log("attachment_viewed")).toHaveLength(0);
    expect(log("attachment_content_failed")).toHaveLength(1);
  });

  it("reports a file that is gone from Drive as unavailable rather than as an empty download", async () => {
    seedAttachment();
    streamStatus = 404;
    const h = await contentRoute();
    const res = await h.GET({
      request: new Request("https://app.test/api"),
      params: { jobId: JOB_ID, attachmentId: "att-1" },
    });
    expect(res.status).toBe(404);
    expect(log("attachment_downloaded")).toHaveLength(0);
  });
});

describe("WP2B correction — delete truthfulness", () => {
  it("audits a retry of a delete that Google Drive previously refused", async () => {
    seedAttachment({ remote_delete_status: "failed", remote_delete_error: "boom" });
    const h = await attachmentsRoute();
    session = { ...HELPER, isAdministrator: true };
    const res = await h.DELETE({
      request: new Request("https://app.test/api?id=att-1", { method: "DELETE" }),
      params: { jobId: JOB_ID },
    });
    expect(res.status).toBe(200);
    expect(log("attachment_delete_retry")).toHaveLength(1);
  });

  it("does not claim a legacy attachment was moved to Google Drive Trash", async () => {
    seedAttachment({
      storage_provider: "supabase",
      external_file_id: null,
      storage_path: "legacy/report.pdf",
    });
    session = { ...HELPER, isAdministrator: true };
    const h = await attachmentsRoute();
    const res = await h.DELETE({
      request: new Request("https://app.test/api?id=att-1", { method: "DELETE" }),
      params: { jobId: JOB_ID },
    });
    expect(res.status).toBe(200);
    // No Drive call at all, and the record must not mention Drive Trash.
    expect(driveCalls).not.toContain("trash");
    const note = String(log("attachment_deleted")[0]?.metadata_json ?? "") + JSON.stringify(log("attachment_deleted")[0] ?? {});
    expect(note).not.toContain("Trash in Google Drive");
    expect(note).toContain("legacy");
  });
});
