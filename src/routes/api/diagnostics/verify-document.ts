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
          const documentId = (url.searchParams.get("documentId") ?? "").trim();
          const sourceParam = (url.searchParams.get("source") ?? "").trim();
          const source: "invoice" | "delivery_order" | null =
            sourceParam === "invoice" || sourceParam === "delivery_order"
              ? sourceParam
              : null;
          if (!docNo && !documentId) {
            return Response.json(
              { error: "Provide a document number (docNo) or immutable documentId." },
              { status: 400 },
            );
          }

          const LINE_SELECT =
            "n3_document_id, n3_line_id, document_no, document_date, document_status, customer_code, customer_name, line_no, stock_code, stock_name, description, quantity, is_void, line_type, has_stock_code, parent_line_id";

          // Build the line queries. When an immutable N3 document ID is
          // provided it takes precedence — a mutable document_no may map to
          // multiple immutable IDs and only the caller-selected record must
          // be returned.
          const siQuery = supabaseAdmin
            .from("sales_invoice_line_snapshots")
            .select(LINE_SELECT)
            .eq("tenant_code", tenant);
          const doQuery = supabaseAdmin
            .from("delivery_order_line_snapshots")
            .select(LINE_SELECT)
            .eq("tenant_code", tenant);
          if (documentId) {
            siQuery.eq("n3_document_id", documentId);
            doQuery.eq("n3_document_id", documentId);
          } else {
            siQuery.eq("document_no", docNo);
            doQuery.eq("document_no", docNo);
          }
          const wantInvoice = !source || source === "invoice";
          const wantDelivery = !source || source === "delivery_order";

          const evQuery = supabaseAdmin
            .from("subscription_renewal_events")
            .select(
              "customer_code, subscription_category_name, stock_code, source_type, source_document_no, source_document_id, source_line_id, source_document_date, expiry_date, is_source_void",
            )
            .eq("tenant_code", tenant);
          if (documentId) evQuery.eq("source_document_id", documentId);
          else evQuery.eq("source_document_no", docNo);

          const [siRes, doRes, mapRes, subsRes, evRes] = await Promise.all([
            wantInvoice
              ? siQuery
              : Promise.resolve({ data: [] as never[], error: null }),
            wantDelivery
              ? doQuery
              : Promise.resolve({ data: [] as never[], error: null }),
            supabaseAdmin
              .from("renewal_stock_mappings")
              .select(
                "stock_code, service_type, subscription_category, renewal_cycle_value, renewal_cycle_unit",
              )
              .eq("tenant_code", tenant)
              .eq("is_active", true),
            docNo
              ? supabaseAdmin
                  .from("customer_subscription_snapshots")
                  .select(
                    "customer_code, subscription_category, stock_code, latest_document_no, latest_document_date, expiry_date, remaining_days, subscription_status",
                  )
                  .eq("tenant_code", tenant)
                  .eq("latest_document_no", docNo)
              : Promise.resolve({ data: [], error: null }),
            evQuery,
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

              // A line is eligible only if its renewal event exists and is not
              // voided, matching the current-subscription rule.
              const event = eventBySourceLine.get(r.n3_line_id ?? "");

              let eligible: "yes" | "no" = "no";
              let ineligibleReason:
                | null
                | "line_type_not_stock"
                | "missing_stock_code"
                | "unmapped_stock_code"
                | "ad_hoc_stock_code"
                | "renewal_invalid_cycle"
                | "voided_source_document"
                | "missing_customer_code"
                | "invalid_document_date" = null;
              if (mappingResult === "not_applicable") ineligibleReason = "line_type_not_stock";
              else if (!r.stock_code) ineligibleReason = "missing_stock_code";
              else if (mappingResult === "unmapped") ineligibleReason = "unmapped_stock_code";
              else if (mappingResult === "ad_hoc") ineligibleReason = "ad_hoc_stock_code";
              else if (mappingResult === "renewal_invalid_cycle")
                ineligibleReason = "renewal_invalid_cycle";
              else if (r.is_void || event?.is_source_void)
                ineligibleReason = "voided_source_document";
              else if (!r.customer_code) ineligibleReason = "missing_customer_code";
              else if (!r.document_date) ineligibleReason = "invalid_document_date";
              else eligible = "yes";

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
                eligible_for_renewal: eligible,
                ineligible_reason: ineligibleReason,

                subscription_category: m?.subscription_category ?? null,
                renewal_cycle:
                  m?.renewal_cycle_value && m?.renewal_cycle_unit
                    ? `${m.renewal_cycle_value} ${m.renewal_cycle_unit}`
                    : null,
                renewal_event: event ?? null,
                // Phase 1.1 — explicit state for the "Renewal Event" column.
                //   existing        — eligible mapped line with a stored event
                //   missing         — eligible mapped line, no event stored
                //   not_applicable  — line cannot produce entitlement
                renewal_event_state:
                  mappingResult === "renewal" || mappingResult === "renewal_invalid_cycle"
                    ? eventBySourceLine.has(r.n3_line_id ?? "")
                      ? "existing"
                      : eligible === "yes"
                        ? "missing"
                        : "not_applicable"
                    : "not_applicable",
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
