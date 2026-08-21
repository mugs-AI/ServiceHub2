// GET /api/admin/cancellation-requests — Owner/Admin decision queue.
//
// Read-only. Lists actionable pending cancellation requests for the
// server-resolved tenant, joined to their still-existing, non-deleted Job so
// the Admin sees current operational context alongside the request. Oldest
// request first. This route never mutates: decisions stay on the dedicated
// cancellation decision endpoint.

import { createFileRoute } from "@tanstack/react-router";

function trim(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export const Route = createFileRoute("/api/admin/cancellation-requests")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { loadPendingCancellationQueue } = await import(
          "@/lib/qne/service-jobs/cancellation.server"
        );
        try {
          const user = await requireAdministrator(request);
          const sp = new URL(request.url).searchParams;
          const q = trim(sp.get("q"), 100);
          const priority = trim(sp.get("priority"), 20);
          const page = Math.max(Number(sp.get("page") ?? 1) || 1, 1);
          const pageSize = Math.min(
            Math.max(Number(sp.get("pageSize") ?? 50) || 50, 1),
            200,
          );

          let rows = await loadPendingCancellationQueue(user.tenantCode);
          if (priority) rows = rows.filter((r) => r.priority === priority);
          if (q) {
            const needle = q.toLowerCase();
            rows = rows.filter((r) =>
              [r.job_number, r.subject, r.customer_name, r.customer_code]
                .filter((v): v is string => typeof v === "string")
                .some((v) => v.toLowerCase().includes(needle)),
            );
          }
          const total = rows.length;
          const paged = rows.slice((page - 1) * pageSize, page * pageSize);

          return Response.json({ requests: paged, total, page, pageSize });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[admin/cancellation-requests] failed", err);
          return Response.json({ error: "Failed to load cancellation requests" }, { status: 500 });
        }
      },
    },
  },
});
