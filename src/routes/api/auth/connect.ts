import { createFileRoute } from "@tanstack/react-router";

import { buildN3Url } from "@/lib/qne/server-config";

/**
 * DEV-ONLY: exchange an N3 API key for a JWT via GET /api/auth/connect.
 * Disabled in production builds (NODE_ENV === "production") so the
 * API-key path is never reachable on the live "My Apps" deployment.
 */
export const Route = createFileRoute("/api/auth/connect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (process.env.NODE_ENV === "production") {
          return new Response(
            JSON.stringify({ code: "9404", message: "Not found", data: null }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          );
        }

        let body: { apiKey?: string };
        try {
          body = (await request.json()) as { apiKey?: string };
        } catch {
          return json({ code: "9400", message: "Invalid JSON body", data: null }, 400);
        }
        const apiKey = (body.apiKey || "").trim();
        if (!apiKey) {
          return json({ code: "9400", message: "Missing apiKey", data: null }, 400);
        }

        const url = buildN3Url("main", "/api/auth/connect", { "api-key": apiKey });

        let upstream: Response;
        try {
          upstream = await fetch(url, {
            method: "GET",
            headers: { Accept: "application/json" },
          });
        } catch (err) {
          console.error("[qne connect] upstream fetch failed", err);
          return json(
            { code: "9502", message: "Upstream fetch failed", data: null },
            502,
          );
        }

        const text = await upstream.text();
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
