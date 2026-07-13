// GET /api/diagnostics/subscription-run — latest subscription sync log,
// aggregate counts and per-source line-type breakdown for the Admin
// console's Transaction Detail Diagnostics.

import { createFileRoute } from "@tanstack/react-router";

type LineTable = "sales_invoice_line_snapshots" | "delivery_order_line_snapshots";

interface LineBreakdown {
  total: number;
  stock: number;
  description: number;
  serial_or_reference: number;
  child_detail: number;
  unknown: number;
  voided: number;
  linesWithoutStock: number;
  stockRenewalMapped: number;
  stockAdHocMapped: number;
  stockUnmapped: number;
  duplicateRowsDetected: number;
  distinctDocuments: number;
}

async function breakdown(
  supabaseAdmin: typeof import("@/integrations/supabase/client.server").supabaseAdmin,
  tenant: string,
  table: LineTable,
  mappedRenewalKeys: Set<string>,
  mappedAdHocKeys: Set<string>,
): Promise<LineBreakdown> {
  const out: LineBreakdown = {
    total: 0,
    stock: 0,
    description: 0,
    serial_or_reference: 0,
    child_detail: 0,
    unknown: 0,
    voided: 0,
    linesWithoutStock: 0,
    stockRenewalMapped: 0,
    stockAdHocMapped: 0,
    stockUnmapped: 0,
    duplicateRowsDetected: 0,
    distinctDocuments: 0,
  };

  const PAGE = 1000;
  let offset = 0;
  const seenKeys = new Set<string>();
  const docSet = new Set<string>();
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("n3_document_id, n3_line_id, line_type, has_stock_code, stock_code, is_void_source, is_void")
      .eq("tenant_code", tenant)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) {
      out.total += 1;
      const t = (r.line_type ?? "unknown") as keyof LineBreakdown;
      if (t in out && typeof out[t] === "number") {
        (out[t] as number) += 1;
      } else {
        out.unknown += 1;
      }
      if (r.is_void_source ?? r.is_void) out.voided += 1;
      if (!r.has_stock_code) out.linesWithoutStock += 1;
      if (r.line_type === "stock" && r.stock_code) {
        const key = String(r.stock_code).trim().toLowerCase();
        if (mappedRenewalKeys.has(key)) out.stockRenewalMapped += 1;
        else if (mappedAdHocKeys.has(key)) out.stockAdHocMapped += 1;
        else out.stockUnmapped += 1;
      }
      const composite = `${r.n3_document_id}::${r.n3_line_id}`;
      if (seenKeys.has(composite)) out.duplicateRowsDetected += 1;
      else seenKeys.add(composite);
      if (r.n3_document_id) docSet.add(String(r.n3_document_id));
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  out.distinctDocuments = docSet.size;
  return out;
}

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

          const { data: mapRows } = await supabaseAdmin
            .from("renewal_stock_mappings")
            .select("stock_code, service_type")
            .eq("tenant_code", tenant)
            .eq("is_active", true);
          const renewalKeys = new Set<string>();
          const adHocKeys = new Set<string>();
          for (const m of mapRows ?? []) {
            const k = (m.stock_code ?? "").trim().toLowerCase();
            if (!k) continue;
            if (m.service_type === "Renewal") renewalKeys.add(k);
            else if (m.service_type === "Ad Hoc") adHocKeys.add(k);
          }

          const [logRes, eventsRes, subsRes, lockRes, si, dord] = await Promise.all([
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
            breakdown(supabaseAdmin, tenant, "sales_invoice_line_snapshots", renewalKeys, adHocKeys),
            breakdown(supabaseAdmin, tenant, "delivery_order_line_snapshots", renewalKeys, adHocKeys),
          ]);

          return Response.json({
            tenantCode: tenant,
            latest: logRes.data ?? null,
            totals: {
              salesInvoiceLines: si.total,
              deliveryOrderLines: dord.total,
              renewalEvents: eventsRes.count ?? 0,
              currentSubscriptions: subsRes.count ?? 0,
            },
            perSource: {
              salesInvoice: si,
              deliveryOrder: dord,
            },
            reconciliationNote:
              "Stored detail-line totals are line-count, not document-count. The N3 Sales History Inquiry lists document headers; a single document may carry several detail lines (stock, description, serial and child-detail rows). The stock breakdown above reflects only rows that can produce entitlement.",
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
