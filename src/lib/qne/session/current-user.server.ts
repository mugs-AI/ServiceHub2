// Server-only current-user resolution & access guards.
//
// Phase 0.9.7 rules (Owner-based ServiceHub Administration):
//   • Current-user identity is sourced from the VALIDATED N3 bearer context
//     (JWT payload claims). BasicInfo is NOT used as user identity — it is
//     tenant/company metadata only. Browser-submitted values are ignored.
//   • Administrator ⇔ matched UserDto in /api/Users has isOwner === true.
//   • The Administrators role is informational only.
//   • Tenant allowlist / bootstrap remain as emergency fallbacks, DISABLED
//     by default — enable per-tenant with SERVICEHUB_ALLOWLIST_FALLBACK=1.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildN3Url } from "@/lib/qne/server-config";
import { unwrapApiResponse } from "@/lib/qne/envelope";
import { n3Get } from "@/lib/qne/sync/n3.server";
import { decodeJwtPayload, type JwtDisplayClaims } from "@/lib/qne/jwt";
import {
  decideAdmin,
  type AdminDecision,
  type AdminDecisionReason,
  type AdminGate,
  type IdentityLookup,
  type N3UserDto,
  type UsersEndpointStatus,
  type UsersLoad,
} from "@/lib/qne/session/role-resolution";
import { normalizeBasicInfo } from "@/lib/qne/session/basic-info";

export interface CurrentUserContext {
  token: string;
  tenantCode: string;
  companyName: string;
  email: string;
  displayName: string;
  userCode: string | null;
  isAdministrator: boolean;
  isOwner: boolean;
  adminGate: AdminGate;
  roleNames: string[];
  /** Structured diagnostics — never surfaced to Normal Users. */
  diagnostics: {
    identitySource: "n3_jwt" | "n3_jwt+basicinfo" | "unknown";
    identityUserIdentifier: string | null;
    matchedN3UserId: string | null;
    matchedDisplayName: string | null;
    reason: AdminDecision["reason"];
    usersEndpoint: {
      status: UsersEndpointStatus;
      httpStatus: number | null;
      shape: string;
      count: number;
      error: string | null;
    };
  };
}

export class UnauthorizedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Administrator access required") {
    super(message);
    this.name = "ForbiddenError";
  }
}

function allowlistFallbackEnabled(): boolean {
  const v = (process.env.SERVICEHUB_ALLOWLIST_FALLBACK ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function envAllowlist(): Set<string> {
  const raw = process.env.SERVICEHUB_BOOTSTRAP_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function isAllowlisted(tenantCode: string, email: string): Promise<boolean> {
  if (!allowlistFallbackEnabled()) return false;
  const emailLc = email.trim().toLowerCase();
  if (!emailLc) return false;
  if (envAllowlist().has(emailLc)) return true;
  const { data } = await supabaseAdmin
    .from("service_hub_admins")
    .select("id")
    .eq("tenant_code", tenantCode)
    .ilike("email", email)
    .maybeSingle();
  return !!data;
}

async function tryBootstrap(tenantCode: string, email: string): Promise<boolean> {
  if (!allowlistFallbackEnabled()) return false;
  const { count } = await supabaseAdmin
    .from("service_hub_admins")
    .select("id", { count: "exact", head: true })
    .eq("tenant_code", tenantCode);
  if ((count ?? 0) !== 0) return false;
  const { error } = await supabaseAdmin.from("service_hub_admins").insert({
    tenant_code: tenantCode,
    email,
    granted_by: "bootstrap",
    is_bootstrap: true,
  });
  return !error;
}

/** Case-insensitive claim picker. Trims. Rejects empty strings. */
function pickClaim(
  claims: JwtDisplayClaims,
  keys: readonly string[],
): string | null {
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(claims)) lower[k.toLowerCase()] = v;
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Extract current-user identity from the validated N3 bearer JWT.
 * N3 signs the token; any request forwarded to N3 with a bad token comes
 * back 401 before we ever get here, so the claim set is trusted context.
 */
function identityFromJwt(claims: JwtDisplayClaims): IdentityLookup & {
  displayName: string | null;
} {
  return {
    userId: pickClaim(claims, [
      "userId",
      "uid",
      "userGuid",
      "sub",
      "nameid",
      "nameId",
    ]),
    userCode: pickClaim(claims, ["userCode"]),
    email: pickClaim(claims, ["email", "upn", "preferred_username"]),
    userName: pickClaim(claims, [
      "userName",
      "unique_name",
      "username",
      "loginName",
      "login",
    ]),
    displayName: pickClaim(claims, ["displayName", "name", "fullName"]),
  };
}

/**
 * Fetch /api/Users with tolerance for multiple documented shapes:
 *   { code, message, data: UserDto[] }
 *   { code, message, data: { value: UserDto[], count } }
 *   { code, message, data: { data: UserDto[] } }
 */
async function fetchN3Users(token: string): Promise<UsersLoad & {
  httpStatus: number | null;
  shape: string;
  count: number;
  error: string | null;
}> {
  const url = buildN3Url("main", "/api/Users");
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch (err) {
    return {
      users: null,
      status: "failed",
      httpStatus: null,
      shape: "network_error",
      count: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const text = await res.text();
  if (!res.ok) {
    const status: UsersEndpointStatus =
      res.status === 401 ? "unauthorized" : res.status === 403 ? "forbidden" : "failed";
    return {
      users: null,
      status,
      httpStatus: res.status,
      shape: "http_error",
      count: 0,
      error: text.slice(0, 300),
    };
  }

  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (err) {
    return {
      users: null,
      status: "failed",
      httpStatus: res.status,
      shape: "invalid_json",
      count: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let data: unknown = parsed;
  try {
    data = unwrapApiResponse(parsed as { code: string; data: unknown });
  } catch (err) {
    return {
      users: null,
      status: "failed",
      httpStatus: res.status,
      shape: "envelope_error",
      count: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let users: N3UserDto[] | null = null;
  let shape = "unknown";
  if (Array.isArray(data)) {
    users = data as N3UserDto[];
    shape = "array";
  } else if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.value)) {
      users = o.value as N3UserDto[];
      shape = "paged_value";
    } else if (Array.isArray(o.items)) {
      users = o.items as N3UserDto[];
      shape = "items";
    } else if (Array.isArray(o.data)) {
      users = o.data as N3UserDto[];
      shape = "wrapped_data";
    }
  }

  if (!users) {
    return {
      users: null,
      status: "failed",
      httpStatus: res.status,
      shape: `unrecognised:${shape}`,
      count: 0,
      error: "Unable to locate user array in /api/Users response",
    };
  }

  return {
    users,
    status: "ok",
    httpStatus: res.status,
    shape,
    count: users.length,
    error: null,
  };
}

/**
 * Resolve the authenticated N3 user from an incoming Request.
 * Tenant/company come from BasicInfo (with JWT tenantCode as fallback).
 * User identity comes from the JWT payload — NEVER from BasicInfo or the
 * browser.
 */
// ---------------------------------------------------------------------------
// Per-token session cache (Run 3 performance).
// Resolving current-user runs 2 live N3 calls (BasicInfo + /api/Users).
// Cache the CurrentUserContext for a short TTL keyed by the bearer token so
// back-to-back requests (Job Detail: 3 parallel calls; Dashboard auto-refresh
// every 30s) don't repeatedly hit N3.
// ---------------------------------------------------------------------------

interface CachedSession {
  ctx: CurrentUserContext;
  expiresAt: number;
}
const SESSION_TTL_MS = 60_000;
const SESSION_CACHE = new Map<string, CachedSession>();
const SESSION_CACHE_MAX = 500;

function cacheKey(token: string): string {
  // Bearer token is opaque to us; a short suffix keeps the map compact
  // without weakening security (tokens never leave the server).
  return token.length > 96 ? token.slice(-96) : token;
}

function readCache(token: string): CurrentUserContext | null {
  const key = cacheKey(token);
  const hit = SESSION_CACHE.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    SESSION_CACHE.delete(key);
    return null;
  }
  return hit.ctx;
}

function writeCache(token: string, ctx: CurrentUserContext): void {
  if (SESSION_CACHE.size >= SESSION_CACHE_MAX) {
    // Simple eviction: drop the oldest entry.
    const first = SESSION_CACHE.keys().next().value;
    if (first) SESSION_CACHE.delete(first);
  }
  SESSION_CACHE.set(cacheKey(token), {
    ctx,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
}

export async function requireAuthenticatedN3User(
  request: Request,
): Promise<CurrentUserContext> {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new UnauthorizedError("Missing Authorization bearer");
  const token = match[1].trim();

  const cached = readCache(token);
  if (cached) return cached;

  const claims = decodeJwtPayload(token);
  const jwtIdentity = identityFromJwt(claims);

  // BasicInfo is tenant/company only.
  let basicRaw: unknown = {};
  try {
    basicRaw = (await n3Get<unknown>(token, "main", "/api/companyprofile/BasicInfo")) ?? {};
  } catch (err) {
    if (err instanceof Error && /401|unauth/i.test(err.message)) {
      throw new UnauthorizedError(err.message);
    }
    // Non-401 BasicInfo failure is non-fatal for identity — JWT already has it.
  }
  const basic = normalizeBasicInfo(basicRaw);

  const tenantCode =
    basic.tenantCode ||
    (typeof claims.tenantCode === "string" ? claims.tenantCode.trim() : "");
  const companyName =
    basic.companyName ||
    (typeof claims.company === "string" ? (claims.company as string).trim() : "");

  if (!tenantCode) {
    throw new UnauthorizedError(
      "Unable to resolve tenant from N3 session (BasicInfo and JWT both missing tenantCode)",
    );
  }

  const email = jwtIdentity.email ?? "";
  const userName = jwtIdentity.userName ?? "";
  const userId = jwtIdentity.userId ?? null;
  const userCode = jwtIdentity.userCode ?? null;
  const displayNameFromJwt = jwtIdentity.displayName ?? "";

  const identityUserIdentifier =
    userId || userCode || email || userName || null;

  const load = await fetchN3Users(token);

  const decision = await decideAdmin(
    { users: load.users, status: load.status },
    { userId, userCode, email, userName },
    {
      isAllowlisted: (e) => isAllowlisted(tenantCode, e),
      tryBootstrap: (e) => tryBootstrap(tenantCode, e),
    },
  );

  const displayName =
    decision.matchedDisplayName ||
    displayNameFromJwt ||
    email ||
    userName ||
    "";

  return {
    token,
    tenantCode,
    companyName,
    email,
    displayName,
    userCode,
    isAdministrator: decision.isAdministrator,
    isOwner: decision.isOwner,
    adminGate: decision.adminGate,
    roleNames: decision.roleNames,
    diagnostics: {
      identitySource: identityUserIdentifier
        ? basic.tenantCode
          ? "n3_jwt+basicinfo"
          : "n3_jwt"
        : "unknown",
      identityUserIdentifier,
      matchedN3UserId: decision.matchedUserId,
      matchedDisplayName: decision.matchedDisplayName,
      reason: decision.reason satisfies AdminDecisionReason,
      usersEndpoint: {
        status: load.status,
        httpStatus: load.httpStatus,
        shape: load.shape,
        count: load.count,
        error: load.error,
      },
    },
  };
}

export async function requireTenantContext(request: Request): Promise<CurrentUserContext> {
  return requireAuthenticatedN3User(request);
}

export async function requireAdministrator(request: Request): Promise<CurrentUserContext> {
  const user = await requireAuthenticatedN3User(request);
  if (!user.isAdministrator) throw new ForbiddenError();
  return user;
}

export function guardResponse(err: unknown): Response | null {
  if (err instanceof UnauthorizedError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (err instanceof ForbiddenError) {
    return new Response(
      JSON.stringify({ error: "Administrator access required" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
  // Sync concurrency lock — translate to 409.
  if (err && typeof err === "object" && (err as { name?: string }).name === "SyncLockedError") {
    return new Response(
      JSON.stringify({
        error:
          (err as { userMessage?: string }).userMessage ??
          "A synchronization run is already in progress for this Client.",
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }
  return null;
}
