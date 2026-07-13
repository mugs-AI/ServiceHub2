// Server-only current-user resolution & access guards.
// Tenant + user identity are ALWAYS resolved from the authenticated N3
// session (BasicInfo + JWT payload fallback). Browser-supplied values are
// ignored.
//
// Administrator status is resolved from the official N3 /api/Users role
// attachments (see role-resolution.ts). The tenant-scoped ServiceHub
// allowlist (service_hub_admins) remains only as a secure fallback.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildN3Url } from "@/lib/qne/server-config";
import { unwrapApiResponse } from "@/lib/qne/envelope";
import { n3Get } from "@/lib/qne/sync/n3.server";
import { decodeJwtPayload } from "@/lib/qne/jwt";
import {
  decideAdmin,
  type AdminDecision,
  type AdminDecisionReason,
  type AdminGate,
  type N3UserDto,
  type UsersEndpointStatus,
  type UsersLoad,
} from "@/lib/qne/session/role-resolution";
import { normalizeBasicInfo, type NormalizedBasicInfo } from "@/lib/qne/session/basic-info";

export interface CurrentUserContext {
  token: string;
  tenantCode: string;
  companyName: string;
  email: string;
  displayName: string;
  userCode: string | null;
  isAdministrator: boolean;
  adminGate: AdminGate;
  roleNames: string[];
  /** Structured diagnostics — never surfaced to Normal Users. */
  diagnostics: {
    basicInfoUserIdentifier: string | null;
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

function pick(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
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

/**
 * Fetch /api/Users through the same-origin path (direct upstream call from
 * the server). Accepts multiple response shapes documented in the OpenAPI:
 *   { code, message, data: UserDto[] }
 *   { code, message, data: { value: UserDto[], count } }   // paged
 *   { code, message, data: { data: UserDto[] } }           // occasional wrap
 * Records structured diagnostics so a stuck resolution is never silent.
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

  // Accept: array, {value: []}, {items: []}, {data: []}.
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
 * Tenant comes from BasicInfo first, then falls back to the JWT payload
 * (`tenantCode` claim) — matching the N3 Development Brief.
 */
export async function requireAuthenticatedN3User(
  request: Request,
): Promise<CurrentUserContext> {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new UnauthorizedError("Missing Authorization bearer");
  const token = match[1].trim();

  let basic: Record<string, unknown> = {};
  try {
    basic = ((await n3Get<unknown>(token, "main", "/api/companyprofile/BasicInfo")) ?? {}) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof Error && /401|unauth/i.test(err.message)) {
      throw new UnauthorizedError(err.message);
    }
    throw err;
  }

  const claims = decodeJwtPayload(token);

  const tenantCode =
    pick(basic, "tenantCode", "tenant", "tenantId", "code") ||
    (typeof claims.tenantCode === "string" ? claims.tenantCode.trim() : "");
  const companyName =
    pick(basic, "companyName", "company", "name", "companyDisplayName") ||
    (typeof claims.company === "string" ? (claims.company as string).trim() : "");
  const email =
    pick(basic, "email", "userEmail", "loginEmail", "userName") ||
    (typeof claims.email === "string" ? claims.email.trim() : "");
  const displayName =
    pick(basic, "displayName", "fullName", "userDisplayName", "name") ||
    (typeof claims.name === "string" ? claims.name.trim() : "") ||
    email;
  const userCode = pick(basic, "userCode", "userId", "userName") || null;

  if (!tenantCode) {
    throw new UnauthorizedError(
      "Unable to resolve tenant from N3 session (BasicInfo and JWT payload both missing tenantCode)",
    );
  }

  const load = await fetchN3Users(token);

  const decision = await decideAdmin(
    { users: load.users, status: load.status },
    { userCode, email },
    {
      isAllowlisted: (e) => isAllowlisted(tenantCode, e),
      tryBootstrap: (e) => tryBootstrap(tenantCode, e),
    },
  );

  // Prefer the display name N3 has on file when BasicInfo didn't surface one.
  const effectiveDisplayName =
    decision.matchedDisplayName && !pick(basic, "displayName", "fullName", "userDisplayName")
      ? decision.matchedDisplayName
      : displayName;

  return {
    token,
    tenantCode,
    companyName,
    email,
    displayName: effectiveDisplayName,
    userCode,
    isAdministrator: decision.isAdministrator,
    adminGate: decision.adminGate,
    roleNames: decision.roleNames,
    diagnostics: {
      basicInfoUserIdentifier: userCode || email || null,
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
  return null;
}
