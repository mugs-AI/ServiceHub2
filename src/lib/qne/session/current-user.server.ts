// Server-only current-user resolution & access guards.
// Tenant + user identity are ALWAYS resolved from the authenticated N3
// session (BasicInfo + JWT payload fallback). Browser-supplied values are
// ignored. Administrator status is resolved via the interim allowlist
// (see service_hub_admins) documented in the Phase 0.9 brief.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { n3Get } from "@/lib/qne/sync/n3.server";
import { decodeJwtPayload } from "@/lib/qne/jwt";

export interface CurrentUserContext {
  token: string;
  tenantCode: string;
  companyName: string;
  email: string;
  displayName: string;
  userCode: string | null;
  isAdministrator: boolean;
  /** How isAdministrator was decided — for audit/debug. Never surfaced to Normal Users. */
  adminSource:
    | "env_allowlist"
    | "db_allowlist"
    | "db_bootstrap"
    | "not_admin"
    | "no_email";
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

async function resolveAdmin(
  tenantCode: string,
  email: string,
): Promise<CurrentUserContext["adminSource"]> {
  if (!email) return "no_email";
  const emailLc = email.toLowerCase();

  if (envAllowlist().has(emailLc)) return "env_allowlist";

  const { data: existing } = await supabaseAdmin
    .from("service_hub_admins")
    .select("id")
    .eq("tenant_code", tenantCode)
    .ilike("email", email)
    .maybeSingle();
  if (existing) return "db_allowlist";

  // Bootstrap: if no admins exist for this tenant yet, promote the first
  // authenticated user. This is an interim gate — see Phase 0.9 brief.
  const { count } = await supabaseAdmin
    .from("service_hub_admins")
    .select("id", { count: "exact", head: true })
    .eq("tenant_code", tenantCode);
  if ((count ?? 0) === 0) {
    const { error } = await supabaseAdmin.from("service_hub_admins").insert({
      tenant_code: tenantCode,
      email,
      granted_by: "bootstrap",
      is_bootstrap: true,
    });
    if (!error) return "db_bootstrap";
  }

  return "not_admin";
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
    // Some tenants may 401 on BasicInfo if the token is expired — surface as 401.
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

  const adminSource = await resolveAdmin(tenantCode, email);
  const isAdministrator =
    adminSource === "env_allowlist" ||
    adminSource === "db_allowlist" ||
    adminSource === "db_bootstrap";

  return {
    token,
    tenantCode,
    companyName,
    email,
    displayName,
    userCode,
    isAdministrator,
    adminSource,
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
