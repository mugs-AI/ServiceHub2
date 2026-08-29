// WP2A SECURITY CORRECTION — focused security/route coverage.
//
// The real route handlers and the real server engine are exercised. Only the
// two external boundaries are replaced: the Postgres tables (an in-memory
// double that reproduces the WP2A invariants, including the atomic
// connection+audit RPC and the single-use state claim) and Google's HTTP API.
//
// No live Google credentials are used or implied anywhere in this file.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  APPROVED_SCOPES,
  CALLBACK_MESSAGE,
  GOOGLE_DRIVE_SCOPE,
  SAFE_CALLBACK_CODES,
  classifySharing,
  validateFolderMeta,
  validateGrantedScopes,
} from "./google-drive";

/* ------------------------------------------------------------------ db --- */

const H = vi.hoisted(() => {
  interface Row {
    [k: string]: unknown;
  }
  const db = {
    connections: [] as Row[],
    states: [] as Row[],
    audit: [] as Row[],
    failAudit: false,
    reset() {
      db.connections = [];
      db.states = [];
      db.audit = [];
      db.failAudit = false;
    },
  };

  const uid = () =>
    `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

  const tableOf = (t: string): Row[] =>
    t === "google_drive_connections"
      ? db.connections
      : t === "google_drive_oauth_states"
        ? db.states
        : db.audit;

  function insertAudit(row: Row) {
    if (db.failAudit) throw new Error("audit insert failed");
    db.audit.push({ id: uid(), created_at: new Date().toISOString(), ...row });
  }

  function applyPatch(row: Row, patch: Record<string, unknown>) {
    for (const [k, v] of Object.entries(patch)) row[k] = v;
    row.updated_at = new Date().toISOString();
  }

  function builder(t: string) {
    const filters: { col: string; val?: unknown; op: "eq" | "is" }[] = [];
    let mode: "select" | "update" | null = null;
    let patch: Record<string, unknown> = {};

    const matches = () =>
      tableOf(t).filter((r) =>
        filters.every((f) => (f.op === "is" ? r[f.col] == null : r[f.col] === f.val)),
      );

    function finish(): { data: Row[]; error: unknown } {
      const rows = matches();
      if (mode === "update") {
        rows.forEach((r) => applyPatch(r, patch));
      }
      return { data: rows, error: null };
    }

    const api: Record<string, unknown> = {
      insert(obj: Row | Row[]) {
        const arr = Array.isArray(obj) ? obj : [obj];
        if (t === "google_drive_audit_log" && db.failAudit) {
          return Promise.resolve({ data: null, error: { message: "audit unavailable" } });
        }
        arr.forEach((o) =>
          tableOf(t).push({ id: uid(), created_at: new Date().toISOString(), ...o }),
        );
        return Promise.resolve({ data: arr, error: null });
      },
      select() {
        if (!mode) mode = "select";
        return api;
      },
      update(p: Record<string, unknown>) {
        mode = "update";
        patch = p;
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push({ col, val, op: "eq" });
        return api;
      },
      is(col: string) {
        filters.push({ col, op: "is" });
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return Promise.resolve(finish());
      },
      maybeSingle() {
        const r = finish();
        return Promise.resolve({ data: r.data[0] ?? null, error: null });
      },
      single() {
        const r = finish();
        return Promise.resolve(
          r.data[0]
            ? { data: r.data[0], error: null }
            : { data: null, error: { message: "no rows" } },
        );
      },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        return Promise.resolve(finish()).then(res, rej);
      },
    };
    return api;
  }

  function rpc(name: string, args: Record<string, unknown>) {
    try {
      if (name === "sh_gdrive_state_create") {
        // Transaction: state row + connect_started audit, or neither.
        const snapshot = db.states.length;
        db.states.push({
          id: uid(),
          state_hash: args.p_state_hash,
          tenant_code: args.p_tenant_code,
          actor_user_id: args.p_actor_user_id ?? null,
          actor_name: args.p_actor_name ?? null,
          code_verifier_ciphertext: args.p_verifier_ciphertext,
          redirect_uri: args.p_redirect_uri,
          purpose: "connect",
          used_at: null,
          expires_at: args.p_expires_at,
        });
        try {
          insertAudit({
            tenant_code: args.p_tenant_code,
            action: "connect_started",
            detail: {},
            actor_user_id: args.p_actor_user_id ?? null,
            actor_name: args.p_actor_name ?? null,
          });
        } catch (e) {
          db.states.length = snapshot;
          throw e;
        }
        return Promise.resolve({ data: uid(), error: null });
      }

      if (name === "sh_gdrive_apply") {
        const tenant = args.p_tenant_code as string;
        let row = db.connections.find((r) => r.tenant_code === tenant && r.is_active === true);
        const created = !row;
        if (!row) {
          row = {
            id: uid(),
            tenant_code: tenant,
            is_active: true,
            status: "connected",
            detected_sharing_status: "unknown",
            public_sharing_acknowledged: false,
            cipher_version: 1,
            scopes: [],
            created_at: new Date().toISOString(),
          };
          db.connections.push(row);
        }
        const before = { ...row };
        applyPatch(row, (args.p_patch as Record<string, unknown>) ?? {});
        try {
          if (args.p_action) {
            insertAudit({
              tenant_code: tenant,
              action: args.p_action,
              detail: args.p_detail ?? {},
              actor_user_id: args.p_actor_user_id ?? null,
              actor_name: args.p_actor_name ?? null,
            });
          }
        } catch (e) {
          // Roll the whole transaction back — no silent partial success.
          if (created) db.connections = db.connections.filter((r) => r !== row);
          else Object.assign(row, before);
          throw e;
        }
        return Promise.resolve({ data: { ...row }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    } catch (e) {
      return Promise.resolve({ data: null, error: { message: (e as Error).message } });
    }
  }

  const supabaseAdmin = { from: (t: string) => builder(t), rpc };
  return { db, supabaseAdmin };
});

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: H.supabaseAdmin }));

/* -------------------------------------------------------------- session --- */

interface FakeUser {
  tenantCode: string;
  isAdministrator: boolean;
  userId: string | null;
  displayName: string;
  email: string;
}
let session: FakeUser | null = null;

class UnauthorizedError extends Error {}
class ForbiddenError extends Error {}

vi.mock("@/lib/qne/session/current-user.server", () => ({
  requireAuthenticatedN3User: async () => {
    if (!session) throw new UnauthorizedError("Authentication required");
    return ctx(session);
  },
  requireAdministrator: async () => {
    if (!session) throw new UnauthorizedError("Authentication required");
    if (!session.isAdministrator) throw new ForbiddenError("Administrator access required");
    return ctx(session);
  },
  guardResponse: (err: unknown) => {
    if (err instanceof UnauthorizedError)
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof ForbiddenError) return Response.json({ error: "Forbidden" }, { status: 403 });
    return null;
  },
}));

function ctx(u: FakeUser) {
  return {
    tenantCode: u.tenantCode,
    isAdministrator: u.isAdministrator,
    displayName: u.displayName,
    email: u.email,
    userCode: null,
    diagnostics: { matchedN3UserId: u.userId },
  };
}

/* ------------------------------------------------------------ google net -- */

interface GoogleScript {
  token?: { access_token?: string; refresh_token?: string; scope?: string; expires_in?: number };
  tokenStatus?: number;
  account?: { emailAddress?: string; permissionId?: string };
  aboutStatus?: number;
  folder?: Record<string, unknown>;
  folderStatus?: number;
  permissionPages?: { permissions: unknown[]; nextPageToken?: string }[];
  permissionsStatus?: number;
  revokeOk?: boolean;
}

let google: GoogleScript = {};
let calls: string[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  H.db.reset();
  session = { tenantCode: "TCT", isAdministrator: true, userId: "U1", displayName: "Owner", email: "owner@tct.com" };
  calls = [];
  google = {
    token: {
      access_token: "at-1",
      refresh_token: "rt-1",
      scope: GOOGLE_DRIVE_SCOPE,
      expires_in: 3600,
    },
    account: { emailAddress: "ops@tct.com", permissionId: "PID-1" },
    folder: {
      id: "F1",
      name: "Software ServiceHub",
      mimeType: "application/vnd.google-apps.folder",
      trashed: false,
      capabilities: { canAddChildren: true, canListChildren: true },
    },
    permissionPages: [{ permissions: [{ id: "owner", type: "user", role: "owner" }] }],
    revokeOk: true,
  };

  process.env["GOOGLE_DRIVE_CLIENT_ID"] = "1234-test.apps.googleusercontent.com";
  process.env["GOOGLE_DRIVE_CLIENT_SECRET"] = "test-secret-not-real";
  process.env["GOOGLE_DRIVE_REDIRECT_URI"] =
    "https://servicehub22.lovable.app/api/integrations/google-drive/callback";
  // Test-only AES key material; never a live credential.
  process.env["GOOGLE_DRIVE_TOKEN_ENC_KEY"] = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
  process.env["GOOGLE_PICKER_API_KEY"] = "picker-key-test";

  let permPage = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      if (google.tokenStatus && google.tokenStatus >= 400)
        return json({ error: "invalid_grant" }, google.tokenStatus);
      return json(google.token ?? {});
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) {
      return new Response("", { status: google.revokeOk === false ? 400 : 200 });
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/about")) {
      if (google.aboutStatus && google.aboutStatus >= 400) return json({}, google.aboutStatus);
      return json({ user: google.account });
    }
    if (url.includes("/permissions")) {
      if (google.permissionsStatus && google.permissionsStatus >= 400)
        return json({}, google.permissionsStatus);
      const page = google.permissionPages?.[permPage] ?? { permissions: [] };
      permPage = Math.min(permPage + 1, (google.permissionPages?.length ?? 1) - 1);
      return json(page);
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files")) {
      if (google.folderStatus && google.folderStatus >= 400) return json({}, google.folderStatus);
      return json(google.folder ?? {});
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
});

/* -------------------------------------------------------------- helpers --- */

type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>;

async function handlers(path: string): Promise<Record<string, Handler>> {
  const mod = (await import(/* @vite-ignore */ path)) as unknown as {
    Route: { options: { server: { handlers: Record<string, Handler> } } };
  };
  return mod.Route.options.server.handlers;
}

const CONNECT = "@/routes/api/integrations/google-drive/connect";
const CALLBACK = "@/routes/api/integrations/google-drive/callback";
const CONNECTION = "@/routes/api/integrations/google-drive/connection";

function req(url: string, body?: unknown): Request {
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

async function startConnect(): Promise<string> {
  const h = await handlers(CONNECT);
  const res = await h.POST!({
    request: req("https://servicehub22.lovable.app/api/integrations/google-drive/connect", {}),
    params: {},
  });
  const body = (await res.json()) as { authorizationUrl?: string; error?: string };
  if (!body.authorizationUrl) throw new Error(body.error ?? "no url");
  return body.authorizationUrl;
}

function stateFrom(authUrl: string): string {
  return new URL(authUrl).searchParams.get("state")!;
}

async function runCallback(state: string | null, extra = ""): Promise<Response> {
  const h = await handlers(CALLBACK);
  const qs = new URLSearchParams({ code: "auth-code" });
  if (state) qs.set("state", state);
  return h.GET!({
    request: req(
      `https://servicehub22.lovable.app/api/integrations/google-drive/callback?${qs}${extra}`,
    ),
    params: {},
  });
}

async function connectionPost(body: unknown): Promise<Response> {
  const h = await handlers(CONNECTION);
  return h.POST!({
    request: req("https://servicehub22.lovable.app/api/integrations/google-drive/connection", body),
    params: {},
  });
}

async function connectFully(): Promise<void> {
  const res = await runCallback(stateFrom(await startConnect()));
  expect(res.status).toBe(302);
}

/* ---------------------------------------------------------------- tests --- */

describe("P1-1 exact drive.file scope", () => {
  it("requests exactly drive.file with no openid/email/profile and no incremental scope", async () => {
    const url = new URL(await startConnect());
    expect(url.searchParams.get("scope")).toBe(GOOGLE_DRIVE_SCOPE);
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    for (const bad of ["openid", "email", "profile", "auth/drive ", "drive.readonly"]) {
      expect(url.searchParams.get("scope")).not.toContain(bad);
    }
    expect(APPROVED_SCOPES).toEqual([GOOGLE_DRIVE_SCOPE]);
  });

  it("uses Drive about.get for account identity and never calls an OIDC UserInfo endpoint", async () => {
    await connectFully();
    expect(calls.some((c) => c.includes("openidconnect.googleapis.com"))).toBe(false);
    const about = calls.find((c) => c.includes("/drive/v3/about"));
    expect(about).toBeTruthy();
    expect(decodeURIComponent(about!)).toContain("user(emailAddress,permissionId)");
    expect(H.db.connections[0]!.google_account_permission_id).toBe("PID-1");
    expect(H.db.connections[0]!.google_account_email).toBe("ops@tct.com");
  });

  it("rejects and revokes a grant whose scopes fall outside the approved set", async () => {
    google.token = { ...google.token, scope: `${GOOGLE_DRIVE_SCOPE} openid email` };
    const res = await runCallback(stateFrom(await startConnect()));
    expect(res.headers.get("location")).toContain("drive=scope_rejected");
    expect(calls.some((c) => c.includes("/revoke"))).toBe(true);
    expect(H.db.connections).toHaveLength(0);
  });

  it("rejects a grant that omits drive.file", () => {
    expect(validateGrantedScopes("openid email").ok).toBe(false);
    expect(validateGrantedScopes(GOOGLE_DRIVE_SCOPE).ok).toBe(true);
    expect(validateGrantedScopes(null).missing).toEqual([GOOGLE_DRIVE_SCOPE]);
  });
});

describe("OAuth state: forgery, expiry, replay, cross-tenant", () => {
  it("rejects missing, forged, expired and already-used state", async () => {
    expect((await runCallback(null)).headers.get("location")).toContain("state_invalid");
    expect((await runCallback("forged-state-value-1234567890")).headers.get("location")).toContain(
      "state_invalid",
    );

    const s = stateFrom(await startConnect());
    H.db.states[0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await runCallback(s)).headers.get("location")).toContain("state_expired");

    const s2 = stateFrom(await startConnect());
    await runCallback(s2);
    expect((await runCallback(s2)).headers.get("location")).toContain("state_used");
  });

  it("lets at most one of two concurrent replays of the same state succeed", async () => {
    const s = stateFrom(await startConnect());
    const [a, b] = await Promise.all([runCallback(s), runCallback(s)]);
    const locs = [a.headers.get("location")!, b.headers.get("location")!];
    expect(locs.filter((l) => l.includes("drive=connected"))).toHaveLength(1);
    expect(locs.filter((l) => l.includes("state_used"))).toHaveLength(1);
    expect(H.db.connections).toHaveLength(1);
  });

  it("binds the connection to the tenant stored in state, never to browser input", async () => {
    session = { ...session!, tenantCode: "TENANT-A" };
    const s = stateFrom(await startConnect());
    // Attacker adds their own tenant hint to the redirect.
    await runCallback(s, "&tenant_code=TENANT-B&tenantCode=TENANT-B");
    expect(H.db.connections.map((c) => c.tenant_code)).toEqual(["TENANT-A"]);
  });

  it("refuses a state minted for another tenant's connection row", async () => {
    session = { ...session!, tenantCode: "TENANT-A" };
    const sA = stateFrom(await startConnect());
    session = { ...session!, tenantCode: "TENANT-B" };
    await startConnect();
    // Substituting A's state only ever writes A's row.
    await runCallback(sA);
    expect(H.db.connections).toHaveLength(1);
    expect(H.db.connections[0]!.tenant_code).toBe("TENANT-A");
  });
});

describe("Authority: Owner/Admin only", () => {
  it("denies a Normal User / Technician with 403 on every management surface", async () => {
    session = { tenantCode: "TCT", isAdministrator: false, userId: "U9", displayName: "Tech", email: "t@tct.com" };
    const conn = await handlers(CONNECT);
    expect(
      (await conn.POST!({ request: req("https://x/api", {}), params: {} })).status,
    ).toBe(403);
    const c = await handlers(CONNECTION);
    expect((await c.GET!({ request: req("https://x/api"), params: {} })).status).toBe(403);
    expect((await connectionPost({ action: "test" })).status).toBe(403);
  });

  it("denies an unauthenticated caller with 401", async () => {
    session = null;
    expect((await connectionPost({ action: "test" })).status).toBe(401);
  });

  it("allows an Owner/Admin", async () => {
    await connectFully();
    const res = await connectionPost({ action: "test" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe("No secret ever leaves the server", () => {
  it("keeps tokens, ciphertext and the Client Secret out of every response", async () => {
    await connectFully();
    const h = await handlers(CONNECTION);
    const payloads = [
      await (await h.GET!({ request: req("https://x/api"), params: {} })).text(),
      await (await connectionPost({ action: "test" })).text(),
      await (await connectionPost({ action: "select_folder", folderId: "F1" })).text(),
      await (await connectionPost({ action: "refresh_sharing" })).text(),
    ];
    for (const p of payloads) {
      expect(p).not.toContain("rt-1");
      expect(p).not.toContain("test-secret-not-real");
      expect(p).not.toContain("v1.");
      expect(p).not.toContain("refresh_token");
      expect(p).not.toContain("ciphertext");
    }
  });

  it("returns a Picker token only through the explicit picker action", async () => {
    await connectFully();
    const res = await connectionPost({ action: "picker_token" });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.accessToken).toBe("at-1");
    expect(body).not.toHaveProperty("refreshToken");
    expect(JSON.stringify(body)).not.toContain("rt-1");
  });

  it("stores only ciphertext for token material", async () => {
    await connectFully();
    const row = H.db.connections[0]!;
    expect(String(row.refresh_token_ciphertext)).toMatch(/^v1\./);
    expect(String(row.refresh_token_ciphertext)).not.toContain("rt-1");
    expect(String(row.access_token_ciphertext)).not.toContain("at-1");
  });

  it("only ever redirects with a known safe outcome code", async () => {
    const locations: string[] = [];
    locations.push((await runCallback(null)).headers.get("location")!);
    locations.push((await runCallback(stateFrom(await startConnect()))).headers.get("location")!);
    google.tokenStatus = 400;
    locations.push((await runCallback(stateFrom(await startConnect()))).headers.get("location")!);
    for (const loc of locations) {
      const code = new URL(loc).searchParams.get("drive")!;
      expect(SAFE_CALLBACK_CODES).toContain(code);
      expect(loc).not.toContain("auth-code");
      expect(loc).not.toContain("at-1");
      expect(new URL(loc).searchParams.has("code")).toBe(false);
    }
    expect(Object.keys(CALLBACK_MESSAGE).sort()).toEqual([...SAFE_CALLBACK_CODES].sort());
  });
});

describe("P1-3 reconnect and folder truth", () => {
  it("clears the saved Root Folder when a different Google account reconnects", async () => {
    await connectFully();
    await connectionPost({ action: "select_folder", folderId: "F1" });
    expect(H.db.connections[0]!.root_folder_id).toBe("F1");

    google.account = { emailAddress: "other@tct.com", permissionId: "PID-2" };
    const res = await runCallback(stateFrom(await startConnect()));
    expect(res.headers.get("location")).toContain("drive=account_changed");
    expect(H.db.connections[0]!.root_folder_id).toBeNull();
    expect(H.db.connections[0]!.google_account_permission_id).toBe("PID-2");
    expect(H.db.audit.some((a) => a.action === "account_changed")).toBe(true);
  });

  it("revalidates the saved folder and sharing on reconnect with the same account", async () => {
    await connectFully();
    await connectionPost({ action: "select_folder", folderId: "F1" });
    const res = await connectionPost({ action: "test" });
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(calls.filter((c) => c.includes("/permissions")).length).toBeGreaterThan(0);
    expect(H.db.connections[0]!.detected_sharing_status).toBe("restricted");
  });

  it("fails closed when the folder is inaccessible, trashed or read-only", async () => {
    await connectFully();
    google.folderStatus = 404;
    const res = await connectionPost({ action: "select_folder", folderId: "F-missing" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; recovery: string };
    expect(body.recovery).toBeTruthy();
    expect(H.db.connections[0]!.root_folder_id).toBeUndefined();
  });

  it("requires positive capabilities — absent capability data is not usable", () => {
    const base = {
      id: "F1",
      name: "x",
      mimeType: "application/vnd.google-apps.folder",
      trashed: false,
    };
    expect(validateFolderMeta(base).ok).toBe(false);
    expect(validateFolderMeta({ ...base, capabilities: {} }).ok).toBe(false);
    expect(
      validateFolderMeta({ ...base, capabilities: { canAddChildren: true } }).ok,
    ).toBe(false);
    expect(
      validateFolderMeta({
        ...base,
        capabilities: { canAddChildren: true, canListChildren: true },
      }).ok,
    ).toBe(true);
  });
});

describe("P1-2 truthful Google sharing status", () => {
  it("detects real public link sharing from permissions.list", async () => {
    google.permissionPages = [
      { permissions: [{ id: "p1", type: "user", role: "owner" }], nextPageToken: "n1" },
      { permissions: [{ id: "p2", type: "anyone", role: "reader", allowFileDiscovery: false }] },
    ];
    await connectFully();
    const res = await connectionPost({ action: "select_folder", folderId: "F1" });
    const body = (await res.json()) as { sharing: { status: string } };
    expect(body.sharing.status).toBe("anyone_with_link");
    expect(H.db.connections[0]!.detected_sharing_status).toBe("anyone_with_link");
    expect(H.db.connections[0]!.public_sharing_acknowledged).toBe(false);
    // Pagination was followed.
    expect(calls.filter((c) => c.includes("/permissions")).length).toBe(2);
  });

  it("never reports Restricted when Google could not be read", async () => {
    await connectFully();
    google.permissionsStatus = 500;
    await connectionPost({ action: "select_folder", folderId: "F1" });
    expect(H.db.connections[0]!.detected_sharing_status).toBe("error");
    expect(String(H.db.connections[0]!.sharing_detail)).toContain("500");
  });

  it("records the confirmation actor and time only when sharing is really public", async () => {
    await connectFully();
    await connectionPost({ action: "select_folder", folderId: "F1" });
    const refused = await connectionPost({ action: "acknowledge_public_sharing", confirm: true });
    expect(refused.status).toBe(409);
    expect(H.db.connections[0]!.public_sharing_acknowledged).toBe(false);

    google.permissionPages = [{ permissions: [{ id: "p", type: "anyone", role: "reader" }] }];
    const needsConfirm = await connectionPost({ action: "acknowledge_public_sharing" });
    expect(needsConfirm.status).toBe(400);

    const ok = await connectionPost({ action: "acknowledge_public_sharing", confirm: true });
    expect(ok.status).toBe(200);
    const row = H.db.connections[0]!;
    expect(row.public_sharing_acknowledged).toBe(true);
    expect(row.sharing_confirmed_by_name).toBe("Owner");
    expect(row.sharing_confirmed_at).toBeTruthy();
    expect(H.db.audit.some((a) => a.action === "public_sharing_acknowledged")).toBe(true);
  });

  it("never offers a ServiceHub control that changes Google sharing", async () => {
    await connectFully();
    const res = await connectionPost({ action: "set_sharing", sharingPolicy: "restricted" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown action.");
    expect(calls.some((c) => c.startsWith("POST") && c.includes("/permissions"))).toBe(false);
  });

  it("classifies permission lists purely", () => {
    expect(classifySharing([]).status).toBe("restricted");
    expect(classifySharing([{ type: "anyone", role: "reader" }]).isPublic).toBe(true);
    expect(classifySharing([{ type: "anyone", deleted: true }]).status).toBe("restricted");
    expect(
      classifySharing([{ type: "anyone", role: "reader", allowFileDiscovery: true }]).detail,
    ).toContain("discoverable");
  });
});

describe("P1-4 audit and mutation atomicity", () => {
  it("does not report success when the audit record cannot be written", async () => {
    await connectFully();
    const before = { ...H.db.connections[0]! };
    H.db.failAudit = true;
    const res = await connectionPost({ action: "select_folder", folderId: "F1" });
    expect(res.status).toBe(500);
    expect(H.db.connections[0]!.root_folder_id).toBeUndefined();
    expect(H.db.connections[0]!.updated_at).toBe(before.updated_at);
  });

  it("does not start an OAuth flow when connect_started cannot be recorded", async () => {
    H.db.failAudit = true;
    const h = await handlers(CONNECT);
    const res = await h.POST!({ request: req("https://x/api", {}), params: {} });
    expect(res.status).toBe(500);
    expect(H.db.states).toHaveLength(0);
  });

  it("withholds the Picker token when its issuance audit fails", async () => {
    await connectFully();
    H.db.failAudit = true;
    const res = await connectionPost({ action: "picker_token" });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("at-1");
  });

  it("writes an audit row for every persisted connection change", async () => {
    await connectFully();
    await connectionPost({ action: "select_folder", folderId: "F1" });
    await connectionPost({ action: "test" });
    expect(H.db.audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["connect_started", "connected", "select_folder", "tested"]),
    );
  });

  it("wipes local credentials and reports partial failure when Google revoke fails", async () => {
    await connectFully();
    google.revokeOk = false;
    const res = await connectionPost({ action: "disconnect", confirm: true });
    const body = (await res.json()) as { revoked: boolean; message: string };
    expect(body.revoked).toBe(false);
    expect(body.message).toContain("did not confirm");
    const row = H.db.connections[0]!;
    expect(row.refresh_token_ciphertext).toBeNull();
    expect(row.access_token_ciphertext).toBeNull();
    expect(row.status).toBe("disconnected");
    expect(H.db.audit.some((a) => a.action === "disconnected")).toBe(true);
  });

  it("requires explicit confirmation to disconnect and never deletes Drive files", async () => {
    await connectFully();
    expect((await connectionPost({ action: "disconnect" })).status).toBe(400);
    await connectionPost({ action: "disconnect", confirm: true });
    expect(calls.some((c) => c.startsWith("DELETE"))).toBe(false);
  });
});

describe("One active connection and Root Folder per tenant", () => {
  it("keeps a single active row under concurrent connection writes", async () => {
    const [s1, s2] = [stateFrom(await startConnect()), stateFrom(await startConnect())];
    await Promise.all([runCallback(s1), runCallback(s2)]);
    const active = H.db.connections.filter((c) => c.tenant_code === "TCT" && c.is_active === true);
    expect(active).toHaveLength(1);

    await Promise.all([
      connectionPost({ action: "select_folder", folderId: "F1" }),
      connectionPost({ action: "select_folder", folderId: "F1" }),
    ]);
    expect(H.db.connections.filter((c) => c.is_active === true)).toHaveLength(1);
    expect(H.db.connections[0]!.root_folder_id).toBe("F1");
  });

  it("keeps tenants isolated", async () => {
    session = { ...session!, tenantCode: "TENANT-A" };
    await connectFully();
    await connectionPost({ action: "select_folder", folderId: "F1" });

    session = { ...session!, tenantCode: "TENANT-B" };
    const h = await handlers(CONNECTION);
    const res = await h.GET!({ request: req("https://x/api"), params: {} });
    const body = (await res.json()) as { connection: { rootFolderId: string | null; status: string } };
    expect(body.connection.rootFolderId).toBeNull();
    expect(body.connection.status).toBe("not_connected");
  });
});

describe("No Supabase production-byte fallback while WP2B is pending", () => {
  it("refuses new attachment bytes and says so truthfully", async () => {
    const flags = await import("./attachment-bytes");
    expect(flags.ATTACHMENT_BYTES_ENABLED).toBe(false);
    const h = await handlers("@/routes/api/workspace/jobs.$jobId.attachments");
    const res = await h.POST!({
      request: new Request("https://x/api/workspace/jobs/J1/attachments", { method: "POST" }),
      params: { jobId: "J1" },
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(flags.ATTACHMENT_BYTES_DISABLED_MESSAGE);
  });
});
