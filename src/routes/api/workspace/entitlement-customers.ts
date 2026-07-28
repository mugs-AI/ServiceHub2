// GET /api/workspace/entitlement-customers?status=due_soon|overdue|active
// Returns tenant-scoped customers who have at least one entitlement in the
// requested status, plus a summary of expiring stocks and earliest expiry.
// Read-only. Authenticated N3 user in the tenant.

import { createFileRoute } from "@tanstack/react-router";

const VALID = new Set(["active", "due_soon", "overdue"]);
const STATUS_MAP: Record<string, string> = {
  active: "Active",
  due_soon: "Due Soon",
  overdue: "Overdue",
};

export const Route = createFileRoute("/api/workspace/entitlement-customers")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const sp = new URL(request.url).searchParams;
          const raw = (sp.get("status") ?? "due_soon").toLowerCase();
          if (!VALID.has(raw)) {
            return Response.json(
              { error: "Invalid status; use active, due_soon or overdue." },
              { status: 400 },
            );
          }
          const status = STATUS_MAP[raw];

          const { data, error } = await supabaseAdmin
            .from("customer_subscription_snapshots")
            .select(
              "customer_code, customer_name, subscription_category, stock_code, stock_name, expiry_date, remaining_days, subscription_status",
            )
            .eq("tenant_code", user.tenantCode)
            .eq("subscription_status", status)
            .order("expiry_date", { ascending: true })
            .limit(2000);
          if (error) throw error;

          interface Row {
            customer_code: string;
            customer_name: string | null;
            entitlements: number;
            earliestExpiry: string | null;
            minRemainingDays: number | null;
            samples: string[];
          }
          const map = new Map<string, Row>();
          for (const r of data ?? []) {
            const key = r.customer_code;
            if (!key) continue;
            const row =
              map.get(key) ??
              ({
                customer_code: key,
                customer_name: r.customer_name,
                entitlements: 0,
                earliestExpiry: null,
                minRemainingDays: null,
                samples: [],
              } as Row);
            row.entitlements++;
            if (
              r.expiry_date &&
              (!row.earliestExpiry || r.expiry_date < row.earliestExpiry)
            ) {
              row.earliestExpiry = r.expiry_date;
            }
            if (typeof r.remaining_days === "number") {
              row.minRemainingDays =
                row.minRemainingDays == null
                  ? r.remaining_days
                  : Math.min(row.minRemainingDays, r.remaining_days);
            }
            if (row.samples.length < 3 && r.stock_code) {
              row.samples.push(
                `${r.subscription_category ?? ""}·${r.stock_code}`.trim(),
              );
            }
            map.set(key, row);
          }
          const rows = Array.from(map.values()).sort((a, b) => {
            const ax = a.earliestExpiry ?? "9999-12-31";
            const bx = b.earliestExpiry ?? "9999-12-31";
            return ax.localeCompare(bx);
          });

          return Response.json({
            tenantCode: user.tenantCode,
            status,
            total: rows.length,
            rows,
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
