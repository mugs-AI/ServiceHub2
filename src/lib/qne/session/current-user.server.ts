// Server-only current-user resolution & access guards.
// Tenant + user identity are ALWAYS resolved from the authenticated N3
// session (BasicInfo + JWT payload fallback). Browser-supplied values are
// ignored.
//
// Administrator status is resolved from the official N3 /api/Users role
// attachments (see role-resolution.ts). The tenant-scoped ServiceHub
// allowlist (service_hub_admins) remains only as a secure fallback when
// official N3 role data cannot be obtained.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { n3Get } from "@/lib/qne/sync/n3.server";
import { decodeJwtPayload } from "@/lib/qne/jwt";
import {
  decideAdmin,
  type AdminDecision,
  type AdminGate,
  type N3UserDto,
} from "@/lib/qne/session/role-resolution";

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
    usersEndpointOk: boolean;
    usersEndpointError: string | null;
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

async function fetchN3Users(
  token: string,
): Promise<{ users: N3UserDto[] | null; error: string | null }> {
  try {
    const raw = await n3Get<unknown>(token, "main", "/api/Users");
    if (Array.isArray(raw)) return { users: raw as N3UserDto[], error: null };
    // Some envelopes may wrap {data: [...]} at the outer layer; n3Get already unwraps.
    return { users: [], error: null };
  } catch (err) {
    return {
      users: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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

  const { users, error: usersError } = await fetchN3Users(token);

  const decision = await decideAdmin(
    users,
    { userCode, email },
    {
      isAllowlisted: (e) => isAllowlisted(tenantCode, e),
      tryBootstrap: (e) => tryBootstrap(tenantCode, e),
    },
  );

  // Prefer the display name N3 has on file for the matched user when
  // BasicInfo did not surface a friendlier value.
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
      reason: decision.reason,
      usersEndpointOk: users !== null,
      usersEndpointError: usersError,
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
