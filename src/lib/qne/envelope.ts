// Shared helpers for parsing the N3 Open API response envelope.
// The envelope shape is { code: "0000", message, data }.
// List endpoints return `data` as a PageQueryResult { value, count }.

export interface ApiEnvelope<T = unknown> {
  code: string;
  message?: string;
  data: T;
}

export interface PageQueryResult<T> {
  value: T[];
  count: number;
}

export function unwrapApiResponse<T>(env: ApiEnvelope<T>): T {
  if (!env || typeof env !== "object") {
    throw new Error("Malformed API response");
  }
  if (env.code !== "0000") {
    throw new Error(env.message || `N3 API error (code ${env.code})`);
  }
  return env.data;
}

export function unwrapPageList<T>(
  env: ApiEnvelope<PageQueryResult<T>>,
): { rows: T[]; total: number } {
  const data = unwrapApiResponse(env);
  return { rows: data?.value ?? [], total: data?.count ?? 0 };
}
