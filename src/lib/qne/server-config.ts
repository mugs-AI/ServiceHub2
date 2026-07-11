// Server-side helper: resolve N3 base URLs and build a proxied fetch call.
// URLs live in env only — never shipped to the browser bundle.

export const N3_DEFAULTS = {
  main: "https://openapi.account.qne.cloud",
  reporting: "https://openapi-reporting.account.qne.cloud",
} as const;

export type N3Target = "main" | "reporting";

export function n3BaseUrl(target: N3Target): string {
  if (target === "reporting") {
    return process.env.OPEN_API_REPORTING_BASE_URL || N3_DEFAULTS.reporting;
  }
  return process.env.OPEN_API_BASE_URL || N3_DEFAULTS.main;
}

export function buildN3Url(
  target: N3Target,
  path: string,
  query?: Record<string, unknown> | null,
): string {
  const base = n3BaseUrl(target);
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(base + cleanPath);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}
