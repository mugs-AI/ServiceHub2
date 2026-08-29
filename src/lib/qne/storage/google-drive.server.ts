// WP2A — server-only Google Drive tenant connection engine.
//
// Responsibilities: OAuth (PKCE + single-use state), token storage with
// authenticated encryption, refresh with rotation, revoke, and the minimum
// Drive metadata calls needed to create/validate one Root Folder per tenant
// and to READ its true sharing status.
//
// Hard rules enforced here:
//  • Client Secret and refresh tokens never leave the server.
//  • Authorization codes / tokens / ciphertext are never logged.
//  • Exactly https://www.googleapis.com/auth/drive.file is requested — no
//    openid/email/profile, no UserInfo endpoint, no broader Drive scope.
//  • Connection mutation and its audit record commit atomically (RPC).
//  • Exactly one active connection + Root Folder per tenant.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import {
  decryptSecret,
  encryptSecret,
  randomUrlSafeToken,
  sha256Hex,
  tokenEncryptionConfigured,
} from "./token-crypto.server";
import {
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_DRIVE_FOLDER_MIME,
  classifySharing,
  sharingUnavailable,
  validateFolderMeta,
  type DriveFolderMeta,
  type DrivePermission,
  type FolderValidation,
  type SharingAssessment,
} from "./google-drive";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_ABOUT = "https://www.googleapis.com/drive/v3/about";
const STATE_TTL_MS = 10 * 60 * 1000;

export type ConnectionRow = Database["public"]["Tables"]["google_drive_connections"]["Row"];

export interface DriveActor {
  tenantCode: string;
  userId: string | null;
  name: string | null;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class DriveNotConfiguredError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`Google Drive is not configured for this deployment: missing ${missing.join(", ")}.`);
    this.name = "DriveNotConfiguredError";
    this.missing = missing;
  }
}

export function missingDriveEnv(): string[] {
  const missing: string[] = [];
  if (!(process.env["GOOGLE_DRIVE_CLIENT_ID"] ?? "").trim()) missing.push("GOOGLE_DRIVE_CLIENT_ID");
  if (!(process.env["GOOGLE_DRIVE_CLIENT_SECRET"] ?? "").trim())
    missing.push("GOOGLE_DRIVE_CLIENT_SECRET");
  if (!(process.env["GOOGLE_DRIVE_REDIRECT_URI"] ?? "").trim())
    missing.push("GOOGLE_DRIVE_REDIRECT_URI");
  if (!tokenEncryptionConfigured()) missing.push("GOOGLE_DRIVE_TOKEN_ENC_KEY");
  return missing;
}

export function driveConfigured(): boolean {
  return missingDriveEnv().length === 0;
}

export function requireConfig(): OAuthConfig {
  const missing = missingDriveEnv();
  if (missing.length) throw new DriveNotConfiguredError(missing);
  return {
    clientId: process.env["GOOGLE_DRIVE_CLIENT_ID"]!.trim(),
    clientSecret: process.env["GOOGLE_DRIVE_CLIENT_SECRET"]!.trim(),
    redirectUri: process.env["GOOGLE_DRIVE_REDIRECT_URI"]!.trim(),
  };
}

export function pickerApiKey(): string | null {
  return (process.env["GOOGLE_PICKER_API_KEY"] ?? "").trim() || null;
}

// ---------------------------------------------------------------- audit ----

export class AuditWriteError extends Error {
  constructor(action: string) {
    super(`The activity record for "${action}" could not be saved, so the action was not applied.`);
    this.name = "AuditWriteError";
  }
}

/**
 * Standalone audit write. THROWS on failure: no WP2A operation may report
 * success when its audit record was lost.
 */
export async function auditDrive(
  actor: DriveActor,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabaseAdmin.from("google_drive_audit_log").insert({
    tenant_code: actor.tenantCode,
    action,
    detail: detail as never,
    actor_user_id: actor.userId,
    actor_name: actor.name,
  });
  if (error) throw new AuditWriteError(action);
}

/**
 * Atomic connection mutation + audit. The RPC locks the tenant's active row,
 * applies the patch and writes the audit record in ONE transaction, so a
 * persisted change can never exist without its audit trail.
 */
export async function applyConnection(
  actor: DriveActor,
  patch: Record<string, unknown>,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<ConnectionRow> {
  const { data, error } = await supabaseAdmin.rpc("sh_gdrive_apply", {
    p_tenant_code: actor.tenantCode,
    p_patch: patch as never,
    p_action: action,
    p_detail: detail as never,
    p_actor_user_id: actor.userId ?? undefined,
    p_actor_name: actor.name ?? undefined,
  });
  if (error || !data) {
    throw new Error(
      `The Google Drive change could not be saved together with its activity record (${action}). Nothing was applied.`,
    );
  }
  return data as unknown as ConnectionRow;
}

// ------------------------------------------------------------ oauth state --

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomUrlSafeToken(48);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier) as unknown as ArrayBuffer,
  );
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

/**
 * Build the consent URL and persist the single-use state bound to tenant+actor.
 * State creation and the connect_started audit are one transaction (RPC).
 * The requested scope is exactly drive.file.
 */
export async function beginAuthorization(actor: DriveActor): Promise<string> {
  const cfg = requireConfig();
  const state = randomUrlSafeToken(32);
  const { verifier, challenge } = await pkcePair();

  const { error } = await supabaseAdmin.rpc("sh_gdrive_state_create", {
    p_tenant_code: actor.tenantCode,
    p_state_hash: await sha256Hex(state),
    p_verifier_ciphertext: await encryptSecret(verifier),
    p_redirect_uri: cfg.redirectUri,
    p_expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
    p_actor_user_id: actor.userId ?? undefined,
    p_actor_name: actor.name ?? undefined,
  });
  if (error) {
    throw new Error(
      "The Google connection attempt could not be recorded, so it was not started. Try again.",
    );
  }

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("scope", GOOGLE_DRIVE_SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

export type StateOutcome =
  | {
      ok: true;
      tenantCode: string;
      actorUserId: string | null;
      actorName: string | null;
      verifier: string;
    }
  | { ok: false; reason: "state_invalid" | "state_expired" | "state_used" };

/**
 * Consume the state exactly once. Replay is prevented by an atomic
 * conditional update (`used_at is null`), so concurrent callbacks cannot
 * both succeed. The tenant is taken from the stored state, never the browser.
 */
export async function consumeState(rawState: string | null): Promise<StateOutcome> {
  if (!rawState || rawState.length < 16) return { ok: false, reason: "state_invalid" };
  const hash = await sha256Hex(rawState);
  const { data: row } = await supabaseAdmin
    .from("google_drive_oauth_states")
    .select("*")
    .eq("state_hash", hash)
    .maybeSingle();
  if (!row) return { ok: false, reason: "state_invalid" };
  if (row.used_at) return { ok: false, reason: "state_used" };
  if (new Date(row.expires_at).getTime() < Date.now())
    return { ok: false, reason: "state_expired" };

  const { data: claimed } = await supabaseAdmin
    .from("google_drive_oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: false, reason: "state_used" };

  const verifier = await decryptSecret(row.code_verifier_ciphertext);
  if (!verifier) return { ok: false, reason: "state_invalid" };
  return {
    ok: true,
    tenantCode: row.tenant_code,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    verifier,
  };
}

// ---------------------------------------------------------------- tokens ---

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || json.error) {
    // Never log the body: it can echo the authorization code or tokens.
    throw new Error(`Google token request failed (${res.status}: ${json.error ?? "unknown"}).`);
  }
  return json;
}

export async function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  const cfg = requireConfig();
  return tokenRequest(
    new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  );
}

async function refreshWithToken(refreshToken: string): Promise<TokenResponse> {
  const cfg = requireConfig();
  return tokenRequest(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
    }),
  );
}

export async function loadConnection(tenantCode: string): Promise<ConnectionRow | null> {
  const { data } = await supabaseAdmin
    .from("google_drive_connections")
    .select("*")
    .eq("tenant_code", tenantCode)
    .eq("is_active", true)
    .maybeSingle();
  return (data as ConnectionRow | null) ?? null;
}

export class DriveAuthError extends Error {
  readonly recovery: string;
  constructor(message: string, recovery: string) {
    super(message);
    this.name = "DriveAuthError";
    this.recovery = recovery;
  }
}

/**
 * Background/system actor for mutations that are not initiated by a person
 * (token refresh, fail-closed status changes). Truthful: no fabricated user.
 */
function systemActor(row: ConnectionRow): DriveActor {
  return { tenantCode: row.tenant_code, userId: null, name: null };
}

/**
 * P1-3 (patch): every persisted status/credential change goes through the
 * atomic connection-mutation + audit RPC. A direct table update would allow a
 * persisted change without its audit record.
 */
async function markNeedsReconnect(row: ConnectionRow, reason: string): Promise<void> {
  await applyConnection(
    systemActor(row),
    { status: "needs_reconnect", last_error: reason },
    "token_refresh_failed",
    { reason },
  );
}

/**
 * Return a usable access token, refreshing (and rotating the refresh token
 * when Google issues a new one) as required. Fails closed.
 */
export async function accessTokenFor(row: ConnectionRow): Promise<string> {
  const expiresAt = row.access_token_expires_at
    ? new Date(row.access_token_expires_at).getTime()
    : 0;
  if (row.access_token_ciphertext && expiresAt - 60_000 > Date.now()) {
    const cached = await decryptSecret(row.access_token_ciphertext);
    if (cached) return cached;
  }
  const refresh = await decryptSecret(row.refresh_token_ciphertext);
  if (!refresh) {
    await markNeedsReconnect(row, "No stored Google refresh token.");
    throw new DriveAuthError(
      "This company's Google Drive connection has no usable credential.",
      "Reconnect Google Drive from Settings.",
    );
  }
  let token: TokenResponse;
  try {
    token = await refreshWithToken(refresh);
  } catch {
    await markNeedsReconnect(
      row,
      "Google refused to refresh the connection (access revoked or expired).",
    );
    throw new DriveAuthError(
      "Google refused to refresh this connection.",
      "Reconnect Google Drive from Settings — access may have been revoked in the Google account.",
    );
  }
  if (!token.access_token) {
    await markNeedsReconnect(row, "Google returned no access token on refresh.");
    throw new DriveAuthError(
      "Google returned no access token.",
      "Reconnect Google Drive from Settings.",
    );
  }
  const patch: Record<string, unknown> = {
    access_token_ciphertext: await encryptSecret(token.access_token),
    access_token_expires_at: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
    status: "connected",
    last_error: null,
  };
  // Refresh-token rotation: persist the replacement whenever Google sends one.
  if (token.refresh_token && token.refresh_token !== refresh) {
    patch.refresh_token_ciphertext = await encryptSecret(token.refresh_token);
  }
  await supabaseAdmin
    .from("google_drive_connections")
    .update(patch as never)
    .eq("id", row.id);
  return token.access_token;
}

export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------- drive calls ---

async function driveFetch(
  accessToken: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export interface DriveAccount {
  email: string | null;
  permissionId: string | null;
}

/**
 * Connected-account identity from Drive `about.get`, which is supported by
 * drive.file. No OIDC/UserInfo call is made anywhere in this vertical.
 */
export async function fetchDriveAccount(accessToken: string): Promise<DriveAccount> {
  const res = await driveFetch(
    accessToken,
    `${DRIVE_ABOUT}?fields=${encodeURIComponent("user(emailAddress,permissionId)")}`,
  );
  if (!res.ok) return { email: null, permissionId: null };
  const json = (await res.json().catch(() => null)) as {
    user?: { emailAddress?: string; permissionId?: string };
  } | null;
  return {
    email: json?.user?.emailAddress ?? null,
    permissionId: json?.user?.permissionId ?? null,
  };
}

export async function driveAbout(
  accessToken: string,
): Promise<{ ok: boolean; message: string; account: DriveAccount }> {
  const res = await driveFetch(
    accessToken,
    `${DRIVE_ABOUT}?fields=${encodeURIComponent("user(emailAddress,permissionId)")}`,
  );
  if (!res.ok) {
    return {
      ok: false,
      message: `Google Drive rejected the connection check (HTTP ${res.status}).`,
      account: { email: null, permissionId: null },
    };
  }
  const json = (await res.json().catch(() => null)) as {
    user?: { emailAddress?: string; permissionId?: string };
  } | null;
  const account = {
    email: json?.user?.emailAddress ?? null,
    permissionId: json?.user?.permissionId ?? null,
  };
  return {
    ok: true,
    message: `Google Drive reachable as ${account.email ?? "the connected account"}.`,
    account,
  };
}

const FOLDER_FIELDS =
  "id,name,mimeType,trashed,driveId,capabilities(canAddChildren,canListChildren)";

/** Read folder metadata from Google, then validate it — never trust the browser. */
export async function revalidateFolder(
  accessToken: string,
  folderId: string,
): Promise<FolderValidation> {
  if (!folderId) {
    return {
      ok: false,
      reason: "No Root Folder is selected for this company.",
      recovery: "Create a new Software ServiceHub folder, or select an existing folder.",
      folder: null,
    };
  }
  const url = `${DRIVE_FILES}/${encodeURIComponent(folderId)}?fields=${encodeURIComponent(
    FOLDER_FIELDS,
  )}&supportsAllDrives=true`;
  const res = await driveFetch(accessToken, url);
  if (res.status === 404 || res.status === 403) {
    return {
      ok: false,
      reason:
        "The connected Google account cannot open that folder. It may belong to a different account, or access was not granted.",
      recovery:
        "Select the folder again with the picker while signed in as the connected account, or create a new Software ServiceHub folder.",
      folder: null,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: `Google Drive returned HTTP ${res.status} while checking the folder.`,
      recovery: "Run Test Connection, then try again.",
      folder: null,
    };
  }
  return validateFolderMeta((await res.json().catch(() => null)) as DriveFolderMeta | null);
}

export async function createRootFolder(
  accessToken: string,
  name: string,
  parentId: string | null,
): Promise<FolderValidation> {
  const res = await driveFetch(
    accessToken,
    `${DRIVE_FILES}?supportsAllDrives=true&fields=${encodeURIComponent(FOLDER_FIELDS)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: GOOGLE_DRIVE_FOLDER_MIME,
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    },
  );
  if (!res.ok) {
    return {
      ok: false,
      reason: `Google Drive could not create the folder (HTTP ${res.status}).`,
      recovery: "Check the connected account has space and permission, then try again.",
      folder: null,
    };
  }
  return validateFolderMeta((await res.json().catch(() => null)) as DriveFolderMeta | null);
}

/**
 * TRUE sharing status, read from Google `permissions.list` (drive.file
 * supported). Handles pagination, My Drive and Shared Drives. On failure the
 * result is "error" — never a fabricated "restricted".
 */
export async function readSharing(
  accessToken: string,
  folderId: string,
): Promise<SharingAssessment> {
  if (!folderId) return sharingUnavailable("No Root Folder is selected yet.");
  const permissions: DrivePermission[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const url = new URL(`${DRIVE_FILES}/${encodeURIComponent(folderId)}/permissions`);
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("useDomainAdminAccess", "false");
    url.searchParams.set("pageSize", "100");
    url.searchParams.set(
      "fields",
      "nextPageToken,permissions(id,type,role,allowFileDiscovery,deleted)",
    );
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await driveFetch(accessToken, url.toString());
    if (!res.ok) {
      return sharingUnavailable(
        `Google Drive did not return the folder's sharing settings (HTTP ${res.status}).`,
      );
    }
    const json = (await res.json().catch(() => null)) as {
      permissions?: DrivePermission[];
      nextPageToken?: string;
    } | null;
    if (!json) return sharingUnavailable("Google Drive returned an unreadable sharing response.");
    permissions.push(...(json.permissions ?? []));
    pageToken = json.nextPageToken;
    pages += 1;
  } while (pageToken && pages < 20);
  return classifySharing(permissions);
}
