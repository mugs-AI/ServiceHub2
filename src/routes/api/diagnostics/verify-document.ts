// GET /api/diagnostics/verify-document?docNo=... — Administrator lookup for one
// stored transaction document. Reads only tenant-scoped local line snapshots
// (sales_invoice_line_snapshots + delivery_order_line_snapshots) and cross-
// references the active renewal_stock_mappings for the current tenant.
//
// Never returns pricing, JWTs, raw payloads or Authorization headers.

import { createFileRoute } from "@tanstack/react-router";

function normalizeStockKey(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

export const Route = createFileRoute("/api/diagnostics/verify-document")({
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
          const url = new URL(request.url);
          const docNo = (url.searchParams.get("docNo") ?? "").trim();
          if (!docNo) {
            return Response.json(
              { error: "Provide a document number (docNo)." },
              { status: 400 },
            );
          }

          // Look in both sales invoice and delivery order line snapshots.
          const [siRes, doRes, mapRes, subsRes, evRes] = await Promise.all([
            supabaseAdmin
              .from("sales_invoice_line_snapshots")
              .select(
                "n3_document_id, n3_line_id, document_no, document_date, document_status, customer_code, customer_name, line_no, stock_code, stock_name, description, quantity, is_void, line_type, has_stock_code, parent_line_id",
              )
              .eq("tenant_code", tenant)
              .eq("document_no", docNo),
            supabaseAdmin
              .from("delivery_order_line_snapshots")
              .select(
                "n3_document_id, n3_line_id, document_no, document_date, document_status, customer_code, customer_name, line_no, stock_code, stock_name, description, quantity, is_void, line_type, has_stock_code, parent_line_id",
              )
              .eq("tenant_code", tenant)
              .eq("document_no", docNo),

            supabaseAdmin
              .from("renewal_stock_mappings")
              .select(
                "stock_code, service_type, subscription_category, renewal_cycle_value, renewal_cycle_unit",
              )
              .eq("tenant_code", tenant)
              .eq("is_active", true),
            supabaseAdmin
              .from("customer_subscription_snapshots")
              .select(
                "customer_code, subscription_category, stock_code, latest_document_no, latest_document_date, expiry_date, remaining_days, subscription_status",
              )
              .eq("tenant_code", tenant)
              .eq("latest_document_no", docNo),
            supabaseAdmin
              .from("subscription_renewal_events")
              .select(
                "customer_code, subscription_category_name, stock_code, source_type, source_document_no, source_line_id, source_document_date, expiry_date",
              )
              .eq("tenant_code", tenant)
              .eq("source_document_no", docNo),
          ]);

          const mappings = new Map<
            string,
            {
              service_type: string;
              subscription_category: string | null;
              renewal_cycle_value: number | null;
              renewal_cycle_unit: string | null;
            }
          >();
          for (const m of mapRes.data ?? []) {
            mappings.set(normalizeStockKey(m.stock_code), {
              service_type: m.service_type,
              subscription_category: m.subscription_category,
              renewal_cycle_value: m.renewal_cycle_value,
              renewal_cycle_unit: m.renewal_cycle_unit,
            });
          }

          type RenewalEventRow = NonNullable<typeof evRes.data>[number];
          const eventBySourceLine = new Map<string, RenewalEventRow>();
          for (const e of evRes.data ?? []) {
            eventBySourceLine.set(`${e.source_line_id}`, e);
          }

          type Source = "invoice" | "delivery_order";
          const decorate = (rows: NonNullable<typeof siRes.data>, source: Source) =>
            rows.map((r) => {
              const key = normalizeStockKey(r.stock_code);
              const m = mappings.get(key);
              let mappingResult:
                | "unmapped"
                | "renewal"
                | "ad_hoc"
                | "renewal_invalid_cycle"
                | "not_applicable" = "unmapped";
              // Non-stock lines cannot produce entitlement — mark them so.
              if (r.line_type && r.line_type !== "stock") {
                mappingResult = "not_applicable";
              } else if (m) {
                if (m.service_type === "Renewal") {
                  mappingResult =
                    !m.renewal_cycle_value || m.renewal_cycle_value <= 0
                      ? "renewal_invalid_cycle"
                      : "renewal";
                } else if (m.service_type === "Ad Hoc") mappingResult = "ad_hoc";
              }
              return {
                source,
                n3_document_id: r.n3_document_id,
                n3_line_id: r.n3_line_id,
                line_no: r.line_no,
                line_type: r.line_type,
                has_stock_code: r.has_stock_code,
                parent_line_id: r.parent_line_id,
                stock_code: r.stock_code,
                stock_name: r.stock_name,
                description: r.description,
                quantity: r.quantity,
                is_void: r.is_void,
                mapping_result: mappingResult,

                subscription_category: m?.subscription_category ?? null,
                renewal_cycle:
                  m?.renewal_cycle_value && m?.renewal_cycle_unit
                    ? `${m.renewal_cycle_value} ${m.renewal_cycle_unit}`
                    : null,
                renewal_event: eventBySourceLine.get(r.n3_line_id ?? "") ?? null,
              };
            });

          const invoiceLines = decorate(siRes.data ?? [], "invoice");
          const doLines = decorate(doRes.data ?? [], "delivery_order");
          const allLines = [...invoiceLines, ...doLines];

          const found = allLines.length > 0;
          const header = found
            ? {
                document_no: docNo,
                document_id: allLines[0].n3_document_id,
                document_date:
                  (siRes.data?.[0]?.document_date ?? doRes.data?.[0]?.document_date) ?? null,
                document_status:
                  (siRes.data?.[0]?.document_status ??
                    doRes.data?.[0]?.document_status) ?? null,
                customer_code:
                  (siRes.data?.[0]?.customer_code ?? doRes.data?.[0]?.customer_code) ?? null,
                customer_name:
                  (siRes.data?.[0]?.customer_name ?? doRes.data?.[0]?.customer_name) ?? null,
                source_type: siRes.data && siRes.data.length > 0 ? "invoice" : "delivery_order",
              }
            : null;

          return Response.json({
            tenantCode: tenant,
            documentNo: docNo,
            found,
            header,
            detailFetch: {
              operation: found
                ? header?.source_type === "invoice"
                  ? "SalesInvoices_GetByKey_GET"
                  : "DeliveryOrders_GetByKey_GET"
                : null,
              linesStored: allLines.length,
            },
            lines: allLines,
            currentSubscriptions: subsRes.data ?? [],
            renewalEvents: evRes.data ?? [],
            hint: found
              ? null
              : "Document not present in local line snapshots. Run Sync Transaction Details & Recalculate Subscriptions first.",
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[diagnostics/verify-document] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
