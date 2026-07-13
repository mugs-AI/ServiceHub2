// Server-only N3 Open API helpers used by the Snapshot Synchronization Engine.
// The browser NEVER imports this file. All calls go through the server, so
// the JWT stays on the server request path and base URLs never ship to the
// client bundle.

import { buildN3Url, type N3Target } from "@/lib/qne/server-config";
import { unwrapApiResponse, unwrapPageList, type ApiEnvelope, type PageQueryResult } from "@/lib/qne/envelope";

export interface N3TenantContext {
  token: string;
  tenantCode: string;
  companyName: string;
  email: string;
}

async function n3Fetch<T>(
  token: string,
  target: N3Target,
  method: string,
  path: string,
  query?: Record<string, unknown>,
  body?: unknown,
): Promise<ApiEnvelope<T>> {
  const url = buildN3Url(target, path, query);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "DELETE" && body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`N3 ${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return text ? (JSON.parse(text) as ApiEnvelope<T>) : ({ code: "0000", data: null as unknown as T } as ApiEnvelope<T>);
}

export async function n3Get<T>(token: string, target: N3Target, path: string, query?: Record<string, unknown>): Promise<T> {
  return unwrapApiResponse(await n3Fetch<T>(token, target, "GET", path, query));
}

export async function n3GetList<T>(
  token: string,
  target: N3Target,
  path: string,
  query?: Record<string, unknown>,
): Promise<{ rows: T[]; total: number }> {
  return unwrapPageList(await n3Fetch<PageQueryResult<T>>(token, target, "GET", path, query));
}

/**
 * Page through an N3 list endpoint using OData `$top` / `$skip` (per the
 * official `x-qne-paging: odata-page` extension). Tenant is enforced
 * upstream by the JWT itself — N3 scopes the response to that tenant.
 */
export async function* n3IterateList<T>(
  token: string,
  target: N3Target,
  path: string,
  query: Record<string, unknown> = {},
  pageSize = 200,
): AsyncGenerator<T> {
  let skip = 0;
  // Cap for safety; a single sync should never need this many pages.
  const HARD_CAP_PAGES = 500;
  for (let page = 0; page < HARD_CAP_PAGES; page++) {
    const { rows, total } = await n3GetList<T>(token, target, path, {
      ...query,
      $top: pageSize,
      $skip: skip,
    });
    for (const row of rows) yield row;
    if (rows.length < pageSize) return;
    if (total && skip + rows.length >= total) return;
    skip += rows.length;
  }
}

import { normalizeBasicInfo } from "@/lib/qne/session/basic-info";

function extractBasicInfo(raw: unknown): { tenantCode: string; companyName: string; email: string } {
  const n = normalizeBasicInfo(raw);
  return {
    tenantCode: n.tenantCode,
    companyName: n.companyName,
    email: n.email ?? n.userName ?? "",
  };
}

/**
 * Resolve the current tenant from the authenticated N3 session.
 * NEVER trust a tenant value supplied by the browser.
 *
 * Tenant resolution order (per the N3 Development Brief):
 *   1. BasicInfo (`/api/companyprofile/BasicInfo`) — preferred when exposed.
 *   2. JWT payload `tenantCode` claim (display-only fallback the brief
 *      explicitly permits). Signature is NOT verified here — N3 already
 *      validated it upstream when the request came back with 200.
 */
export async function resolveTenantContext(request: Request): Promise<N3TenantContext> {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new UnauthorizedSyncError("Missing Authorization bearer");
  }
  const token = match[1].trim();

  let info: { tenantCode: string; companyName: string; email: string };
  try {
    info = extractBasicInfo(await n3Get<unknown>(token, "main", "/api/companyprofile/BasicInfo"));
  } catch (err) {
    if (err instanceof Error && /401|unauth/i.test(err.message)) {
      throw new UnauthorizedSyncError(err.message);
    }
    throw err;
  }

  if (!info.tenantCode || !info.email || !info.companyName) {
    const { decodeJwtPayload } = await import("@/lib/qne/jwt");
    const claims = decodeJwtPayload(token);
    if (!info.tenantCode && typeof claims.tenantCode === "string") {
      info.tenantCode = claims.tenantCode.trim();
    }
    if (!info.email && typeof claims.email === "string") {
      info.email = claims.email.trim();
    }
    if (!info.companyName && typeof claims.company === "string") {
      info.companyName = (claims.company as string).trim();
    }
  }

  if (!info.tenantCode) {
    throw new UnauthorizedSyncError(
      "Unable to resolve tenant from N3 session (BasicInfo and JWT payload both missing tenantCode)",
    );
  }
  return { token, ...info };
}

export class UnauthorizedSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedSyncError";
  }
}
