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
 * Page through an N3 list endpoint, yielding every row. Tenant is enforced
 * upstream by the JWT itself — N3 scopes the response to that tenant.
 */
export async function* n3IterateList<T>(
  token: string,
  target: N3Target,
  path: string,
  query: Record<string, unknown> = {},
  pageSize = 200,
): AsyncGenerator<T> {
  let pageNo = 1;
  // Cap for safety; a single sync should never need this many pages.
  const HARD_CAP_PAGES = 500;
  while (pageNo <= HARD_CAP_PAGES) {
    const { rows, total } = await n3GetList<T>(token, target, path, {
      ...query,
      pageNo,
      pageSize,
    });
    for (const row of rows) yield row;
    if (rows.length < pageSize) return;
    if (total && pageNo * pageSize >= total) return;
    pageNo += 1;
  }
}

function normaliseBasicInfo(raw: unknown): { tenantCode: string; companyName: string; email: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return "";
  };
  return {
    tenantCode: pick("tenantCode", "tenant", "tenantId", "code"),
    companyName: pick("companyName", "company", "name", "companyDisplayName"),
    email: pick("email", "userEmail", "loginEmail", "userName"),
  };
}

/**
 * Resolve the current tenant from the authenticated N3 session.
 * NEVER trust a tenant value supplied by the browser — always fetch it
 * from BasicInfo using the presented JWT.
 */
export async function resolveTenantContext(request: Request): Promise<N3TenantContext> {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new UnauthorizedSyncError("Missing Authorization bearer");
  }
  const token = match[1].trim();
  const info = normaliseBasicInfo(await n3Get<unknown>(token, "main", "/api/companyprofile/BasicInfo"));
  if (!info.tenantCode) {
    throw new UnauthorizedSyncError("N3 session did not return a tenantCode");
  }
  return { token, ...info };
}

export class UnauthorizedSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedSyncError";
  }
}
