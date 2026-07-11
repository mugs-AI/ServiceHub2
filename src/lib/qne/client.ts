// Browser HTTP client. Talks ONLY to our same-origin backend proxy.
// The browser must never call openapi.account.qne.cloud directly.

import { clearStoredToken, getStoredToken } from "./tokens";
import type { ApiEnvelope, PageQueryResult } from "./envelope";
import { unwrapApiResponse, unwrapPageList } from "./envelope";

export type ProxyTarget = "main" | "reporting";

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

interface ProxyOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
}

export async function qneProxy<T = unknown>(
  target: ProxyTarget,
  method: string,
  path: string,
  opts: ProxyOptions = {},
): Promise<ApiEnvelope<T>> {
  const token = getStoredToken();
  const res = await fetch("/api/proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ target, method, path, query: opts.query, body: opts.body }),
  });

  if (res.status === 401) {
    clearStoredToken();
    // Trigger a re-render of the auth gate so the user is sent back to
    // the login/relaunch screen.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("qne:unauthorized"));
    }
    throw new UnauthorizedError();
  }

  const text = await res.text();
  let json: ApiEnvelope<T>;
  try {
    json = text ? (JSON.parse(text) as ApiEnvelope<T>) : ({ code: "9999", message: "Empty response", data: null as unknown as T });
  } catch {
    throw new Error(`Non-JSON proxy response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok && json?.code === undefined) {
    throw new Error(`Proxy HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return json;
}

export async function qneGet<T>(target: ProxyTarget, path: string, query?: ProxyOptions["query"]): Promise<T> {
  return unwrapApiResponse(await qneProxy<T>(target, "GET", path, { query }));
}

export async function qneGetList<T>(
  target: ProxyTarget,
  path: string,
  query?: ProxyOptions["query"],
): Promise<{ rows: T[]; total: number }> {
  return unwrapPageList(await qneProxy<PageQueryResult<T>>(target, "GET", path, { query }));
}
