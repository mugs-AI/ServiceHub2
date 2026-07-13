// GET /api/diagnostics/subscription-run — latest subscription sync log +
// aggregate counts for the Admin console's Transaction Detail Diagnostics.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/diagnostics/subscription-run")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAdministrator(request);
          const tenant = user.tenantCode;

          const [logRes, siLinesRes, doLinesRes, eventsRes, subsRes, lockRes] =
            await Promise.all([
              supabaseAdmin
                .from("snapshot_sync_logs")
                .select(
                  "id, snapshot_type, status, started_at, completed_at, duration_ms, inserted_count, updated_count, skipped_count, failed_count, error_message, details",
                )
                .eq("tenant_code", tenant)
                .eq("snapshot_type", "contract")
                .order("started_at", { ascending: false })
                .limit(1)
                .maybeSingle(),
              supabaseAdmin
                .from("sales_invoice_line_snapshots")
                .select("id", { count: "exact", head: true })
                .eq("tenant_code", tenant),
              supabaseAdmin
                .from("delivery_order_line_snapshots")
                .select("id", { count: "exact", head: true })
                .eq("tenant_code", tenant),
              supabaseAdmin
                .from("subscription_renewal_events")
                .select("id", { count: "exact", head: true })
                .eq("tenant_code", tenant),
              supabaseAdmin
                .from("customer_subscription_snapshots")
                .select("id", { count: "exact", head: true })
                .eq("tenant_code", tenant),
              supabaseAdmin
                .from("sync_locks")
                .select("snapshot_type, acquired_at")
                .eq("tenant_code", tenant),
            ]);

          return Response.json({
            tenantCode: tenant,
            latest: logRes.data ?? null,
            totals: {
              salesInvoiceLines: siLinesRes.count ?? 0,
              deliveryOrderLines: doLinesRes.count ?? 0,
              renewalEvents: eventsRes.count ?? 0,
              currentSubscriptions: subsRes.count ?? 0,
            },
            activeLocks: (lockRes.data ?? []).map((l) => ({
              snapshotType: l.snapshot_type,
              acquiredAt: l.acquired_at,
            })),
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[diagnostics/subscription-run] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
