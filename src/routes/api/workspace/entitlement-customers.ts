// GET /api/workspace/entitlement-customers
//   ?status=due_soon|overdue|active
//   &q=&stock=&category=&from=&to=&sort=&page=&pageSize=
//
// Tenant-scoped, grouped-by-customer entitlement list backed by the SHARED
// read model in src/lib/qne/entitlements/query.server.ts — the same module
// that produces the Admin Dashboard KPI counts, so counts and lists can never
// disagree. Read-only; any authenticated N3 user in the tenant.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/entitlement-customers")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const ent = await import("@/lib/qne/entitlements/query.server");
        try {
          const user = await requireAuthenticatedN3User(request);
          const sp = new URL(request.url).searchParams;
          const status = ent.parseStatusKey(sp.get("status") ?? "due_soon");
          if (!status) {
            return Response.json(
              { error: "Invalid status; use active, due_soon or overdue." },
              { status: 400 },
            );
          }

          const all = await ent.loadEntitlementRecords(user.tenantCode, status);
          const unfilteredTotals = ent.totalsFromRecords(all);
          const categories = ent.distinctCategories(all);

          const filtered = ent.filterRecords(all, {
            q: sp.get("q"),
            stock: sp.get("stock"),
            category: sp.get("category"),
            from: sp.get("from"),
            to: sp.get("to"),
          });
          const filteredTotals = ent.totalsFromRecords(filtered);

          const sort = ent.parseSort(sp.get("sort"), status);
          const groups = ent.groupByCustomer(filtered, sort);

          const pageSize = Math.min(
            Math.max(Number(sp.get("pageSize")) || 20, 5),
            100,
          );
          const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
          const page = Math.min(Math.max(Number(sp.get("page")) || 1, 1), totalPages);
          const pageGroups = groups.slice((page - 1) * pageSize, page * pageSize);

          return Response.json({
            tenantCode: user.tenantCode,
            status,
            statusLabel: ent.STATUS_LABEL[status],
            sort,
            page,
            pageSize,
            totalPages,
            // Unfiltered totals — these MUST equal the Dashboard KPI.
            totals: unfilteredTotals,
            // Totals after the user's filters (what the page renders).
            filteredTotals,
            categories,
            groups: pageGroups,
            generatedAt: new Date().toISOString(),
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/entitlement-customers] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
