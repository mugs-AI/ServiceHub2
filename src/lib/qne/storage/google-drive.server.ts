// WP2A — server-only Google Drive tenant connection engine.
//
// Responsibilities: OAuth (PKCE + single-use state), token storage with
// authenticated encryption, refresh with rotation, revoke, and the minimum
// Drive metadata calls needed to create/validate one Root Folder per tenant.
//
// Hard rules enforced here:
//  • Client Secret and refresh tokens never leave the server.
//  • Authorization codes / tokens / ciphertext are never logged.
//  • Only https://www.googleapis.com/auth/drive.file is requested.
//  • Exactly one active connection + Root Folder per tenant.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
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
  validateFolderMeta,
  type DriveFolderMeta,
  type FolderValidation,
} from "./google-drive";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_ABOUT = "https://www.googleapis.com/drive/v3/about";
const STATE_TTL_MS = 10 * 60 * 1000;

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

export async function auditDrive(
  actor: DriveActor,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await supabaseAdmin.from("google_drive_audit_log").insert({
    tenant_code: actor.tenantCode,
    action,
    detail: detail as never,
    actor_user_id: actor.userId,
    actor_name: actor.name,
  });
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

/** Build the consent URL and persist the single-use state bound to tenant+actor. */
export async function beginAuthorization(actor: DriveActor): Promise<string> {
  const cfg = requireConfig();
  const state = randomUrlSafeToken(32);
  const { verifier, challenge } = await pkcePair();

  await supabaseAdmin.from("google_drive_oauth_states").insert({
    state_hash: await sha256Hex(state),
    tenant_code: actor.tenantCode,
    actor_user_id: actor.userId,
    actor_name: actor.name,
    code_verifier_ciphertext: await encryptSecret(verifier),
    redirect_uri: cfg.redirectUri,
    purpose: "connect",
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("scope", `${GOOGLE_DRIVE_SCOPE} openid email`);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

export type StateOutcome =
  | { ok: true; tenantCode: string; actorUserId: string | null; actorName: string | null; verifier: string }
  | { ok: false; reason: "state_invalid" | "state_expired" | "state_used" };

/**
 * Consume the state exactly once. Replay is prevented by an atomic
 * conditional update (`used_at is null`), so concurrent callbacks cannot
 * both succeed.
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
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "state_expired" };

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

interface TokenResponse {
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
    // Never log the body: it can echo the authorization code.
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

export interface ConnectionRow {
  id: string;
  tenant_code: string;
  status: string;
  google_account_email: string | null;
  root_folder_id: string | null;
  root_folder_name: string | null;
  drive_id: string | null;
  drive_context: string | null;
  access_token_ciphertext: string | null;
  access_token_expires_at: string | null;
  refresh_token_ciphertext: string | null;
  sharing_policy: string;
  [k: string]: unknown;
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

async function markNeedsReconnect(row: ConnectionRow, reason: string): Promise<void> {
  await supabaseAdmin
    .from("google_drive_connections")
    .update({ status: "needs_reconnect", last_error: reason })
    .eq("id", row.id);
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
    await markNeedsReconnect(row, "Google refused to refresh the connection (access revoked or expired).");
    throw new DriveAuthError(
      "Google refused to refresh this connection.",
      "Reconnect Google Drive from Settings — access may have been revoked in the Google account.",
    );
  }
  if (!token.access_token) {
    await markNeedsReconnect(row, "Google returned no access token on refresh.");
    throw new DriveAuthError("Google returned no access token.", "Reconnect Google Drive from Settings.");
  }
  const patch: Record<string, unknown> = {
    access_token_ciphertext: await encryptSecret(token.access_token),
    access_token_expires_at: new Date(
      Date.now() + (token.expires_in ?? 3600) * 1000,
    ).toISOString(),
    status: "connected",
    last_error: null,
  };
  // Refresh-token rotation: persist the replacement whenever Google sends one.
  if (token.refresh_token && token.refresh_token !== refresh) {
    patch.refresh_token_ciphertext = await encryptSecret(token.refresh_token);
  }
  await supabaseAdmin.from("google_drive_connections").update(patch).eq("id", row.id);
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

export async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  const res = await driveFetch(accessToken, USERINFO_ENDPOINT);
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as { email?: string };
  return json.email ?? null;
}

export async function driveAbout(accessToken: string): Promise<{ ok: boolean; message: string }> {
  const res = await driveFetch(accessToken, `${DRIVE_ABOUT}?fields=user(emailAddress),storageQuota`);
  if (!res.ok) {
    return { ok: false, message: `Google Drive rejected the request (HTTP ${res.status}).` };
  }
  const json = (await res.json().catch(() => ({}))) as {
    user?: { emailAddress?: string };
  };
  return {
    ok: true,
    message: `Google Drive reachable as ${json.user?.emailAddress ?? "the connected account"}.`,
  };
}

const FOLDER_FIELDS = "id,name,mimeType,trashed,driveId,capabilities(canAddChildren,canListChildren)";

/** Read folder metadata from Google, then validate it — never trust the browser. */
export async function revalidateFolder(
  accessToken: string,
  folderId: string,
): Promise<FolderValidation> {
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
 * Persist the one active connection for a tenant. Concurrency-safe: the
 * partial unique index google_drive_connections_one_active guarantees at most
 * one active row per tenant, and we upsert onto the existing active row.
 */
export async function upsertConnection(
  tenantCode: string,
  patch: Record<string, unknown>,
): Promise<ConnectionRow> {
  const existing = await loadConnection(tenantCode);
  if (existing) {
    const { data, error } = await supabaseAdmin
      .from("google_drive_connections")
      .update(patch as never)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as ConnectionRow;
  }
  const { data, error } = await supabaseAdmin
    .from("google_drive_connections")
    .insert({ tenant_code: tenantCode, is_active: true, ...patch } as never)
    .select("*")
    .single();
  if (error) {
    // Lost the race against a concurrent connect — reuse the winner.
    const winner = await loadConnection(tenantCode);
    if (winner) return winner;
    throw error;
  }
  return data as ConnectionRow;
}
