// GET /api/workspace/technicians?q=... — tenant-scoped technician lookup.
//
// Source: N3 /api/Users (validated bearer, so N3 itself scopes to the caller's
// tenant). No local Technician master. We filter to isActive users and rank
// exact code/email matches first. Available to any authenticated tenant user
// so the New Service Job form can offer Assign To at creation time; the write
// endpoints (POST /assign, POST /jobs with assigned_user_id) enforce their own
// admin gates where applicable.

import { createFileRoute } from "@tanstack/react-router";

const MAX_RESULTS = 25;
const MIN_QUERY_LEN = 1;

export const Route = createFileRoute("/api/workspace/technicians")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { n3Get } = await import("@/lib/qne/sync/n3.server");
        const roleMod = await import("@/lib/qne/session/role-resolution");
        const { isUserActive } = roleMod;
        type N3UserDto = import("@/lib/qne/session/role-resolution").N3UserDto;
        try {
          const user = await requireAuthenticatedN3User(request);
          const url = new URL(request.url);
          const qRaw = (url.searchParams.get("q") ?? "").trim();

          const raw = await n3Get<unknown>(user.token, "main", "/api/Users");
          const list: N3UserDto[] = Array.isArray(raw)
            ? (raw as N3UserDto[])
            : Array.isArray((raw as { value?: unknown[] })?.value)
              ? ((raw as { value: N3UserDto[] }).value)
              : Array.isArray((raw as { data?: unknown[] })?.data)
                ? ((raw as { data: N3UserDto[] }).data)
                : [];

          const active = list.filter(isUserActive);

          const q = qRaw.toLowerCase();
          const filtered = qRaw.length < MIN_QUERY_LEN
            ? active
            : active.filter((u) => {
                const hay = [
                  u.userName ?? "",
                  u.displayName ?? "",
                  u.email ?? "",
                  u.userId ?? "",
                ]
                  .join(" ")
                  .toLowerCase();
                return hay.includes(q);
              });

          const rows = filtered
            .map((u) => ({
              user_id: (u.userId ?? "").trim() || null,
              user_name: (u.userName ?? "").trim() || null,
              display_name: (u.displayName ?? "").trim() || null,
              email: (u.email ?? "").trim() || null,
            }))
            .filter((r) => r.user_id || r.email || r.user_name)
            .sort((a, b) => {
              const an = (a.display_name ?? a.user_name ?? a.email ?? "").toLowerCase();
              const bn = (b.display_name ?? b.user_name ?? b.email ?? "").toLowerCase();
              return an < bn ? -1 : an > bn ? 1 : 0;
            })
            .slice(0, MAX_RESULTS);

          return Response.json({
            tenantCode: user.tenantCode,
            query: qRaw,
            rows,
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/technicians] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
