import { createFileRoute } from "@tanstack/react-router";

import { buildN3Url, type N3Target } from "@/lib/qne/server-config";

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const ALLOWED_TARGETS = new Set<N3Target>(["main", "reporting"]);

interface ProxyRequestBody {
  target?: string;
  method?: string;
  path?: string;
  query?: Record<string, unknown> | null;
  body?: unknown;
}

/**
 * Same-origin proxy for the N3 Open API. Every browser call to N3 goes
 * through here so N3 hosts are never contacted directly by the browser
 * (avoids CORS and keeps base URLs server-side).
 */
export const Route = createFileRoute("/api/proxy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: ProxyRequestBody;
        try {
          payload = (await request.json()) as ProxyRequestBody;
        } catch {
          return json({ code: "9400", message: "Invalid JSON body", data: null }, 400);
        }

        const target = (payload.target || "main") as N3Target;
        const method = (payload.method || "GET").toUpperCase();
        const path = payload.path || "";

        if (!ALLOWED_TARGETS.has(target)) {
          return json({ code: "9400", message: "Invalid target", data: null }, 400);
        }
        if (!ALLOWED_METHODS.has(method)) {
          return json({ code: "9400", message: "Method not allowed", data: null }, 400);
        }
        if (!path.startsWith("/api/")) {
          return json(
            { code: "9400", message: "Path must start with /api/", data: null },
            400,
          );
        }

        const auth = request.headers.get("authorization");
        if (!auth) {
          return json(
            { code: "9401", message: "Missing Authorization header", data: null },
            401,
          );
        }

        const url = buildN3Url(target, path, payload.query ?? undefined);

        const headers: Record<string, string> = {
          Authorization: auth,
          Accept: "application/json",
        };

        let body: string | undefined;
        if (method !== "GET" && method !== "DELETE" && payload.body !== undefined) {
          headers["Content-Type"] = "application/json";
          body = JSON.stringify(payload.body);
        }

        let upstream: Response;
        try {
          upstream = await fetch(url, { method, headers, body });
        } catch (err) {
          console.error("[qne proxy] upstream fetch failed", err);
          return json(
            { code: "9502", message: "Upstream fetch failed", data: null },
            502,
          );
        }

        const text = await upstream.text();
        // Preserve upstream status so the browser sees 401s.
        return new Response(text || "{}", {
          status: upstream.status,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
