// GET /api/diagnostics/lifecycle-probe?source_type=...&document_id=...
//
// Phase 1.1.6a — Read-only lifecycle probe. Administrator only.
//
// Performs a SINGLE N3 detail GET for one Sales Invoice or Delivery Order
// document by its immutable N3 id and reports the raw lifecycle signals
// (HTTP status, envelope code, timing, payload shape). No writes. No sync.
// No entitlement or snapshot changes. Tenant is resolved from the N3
// session (`Authorization` bearer); a browser-supplied tenant is ignored.
//
// Response is safe to render in the Admin console — it strips pricing
// fields from any returned document payload before returning.

import { createFileRoute } from "@tanstack/react-router";

type SourceType = "invoice" | "delivery_order";

function normaliseSource(raw: string | null): SourceType | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === "invoice" || s === "sales_invoice" || s === "salesinvoice") return "invoice";
  if (s === "delivery_order" || s === "deliveryorder" || s === "do") return "delivery_order";
  return null;
}

const PRICE_FIELDS = new Set([
  "unitPrice",
  "unitprice",
  "price",
  "amount",
  "netAmount",
  "netamount",
  "totalAmount",
  "totalamount",
  "subTotal",
  "subtotal",
  "grandTotal",
  "grandtotal",
  "taxAmount",
  "taxamount",
  "discountAmount",
  "discountamount",
  "cost",
  "unitCost",
  "unitcost",
]);

function stripPricing(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPricing);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PRICE_FIELDS.has(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = stripPricing(v);
      }
    }
    return out;
  }
  return value;
}

function summarisePayload(payload: unknown): {
  hasItemDetails: boolean;
  itemDetailsCount: number | null;
  keys: string[];
  documentNo: string | null;
  isCancelled: boolean | null;
  customerCode: string | null;
} {
  if (!payload || typeof payload !== "object") {
    return {
      hasItemDetails: false,
      itemDetailsCount: null,
      keys: [],
      documentNo: null,
      isCancelled: null,
      customerCode: null,
    };
  }
  const o = payload as Record<string, unknown>;
  const items = o.itemDetails;
  return {
    hasItemDetails: Array.isArray(items),
    itemDetailsCount: Array.isArray(items) ? items.length : null,
    keys: Object.keys(o).slice(0, 40),
    documentNo:
      typeof o.documentNo === "string"
        ? o.documentNo
        : typeof o.docNo === "string"
          ? (o.docNo as string)
          : null,
    isCancelled:
      typeof o.isCancelled === "boolean"
        ? o.isCancelled
        : typeof o.cancelled === "boolean"
          ? (o.cancelled as boolean)
          : null,
    customerCode: typeof o.customerCode === "string" ? o.customerCode : null,
  };
}

export const Route = createFileRoute("/api/diagnostics/lifecycle-probe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { n3Get, N3HttpError } = await import("@/lib/qne/sync/n3.server");
        const { n3Endpoint } = await import("@/lib/qne/endpoints");

        try {
          const user = await requireAdministrator(request);
          const url = new URL(request.url);
          const source = normaliseSource(url.searchParams.get("source_type"));
          const documentId = (url.searchParams.get("document_id") ?? "").trim();

          if (!source) {
            return Response.json(
              {
                error:
                  "source_type must be one of: invoice, delivery_order.",
              },
              { status: 400 },
            );
          }
          if (!documentId) {
            return Response.json(
              { error: "document_id (N3 immutable id) is required." },
              { status: 400 },
            );
          }

          const endpoint =
            source === "invoice"
              ? n3Endpoint("salesInvoices.get")
              : n3Endpoint("deliveryOrders.get");
          const path = endpoint.path.replace("{key}", encodeURIComponent(documentId));

          const startedAt = Date.now();
          let httpStatus = 200;
          let envelopeCode: string | null = "0000";
          let outcome: "found" | "not_found" | "unauthorized" | "forbidden" | "envelope_error" | "server_error" | "network_error" = "found";
          let errorMessage: string | null = null;
          let rawSample: unknown = null;
          let payloadSummary: ReturnType<typeof summarisePayload> | null = null;

          try {
            const data = await n3Get<unknown>(user.token, endpoint.target, path);
            payloadSummary = summarisePayload(data);
            rawSample = stripPricing(data);
          } catch (err) {
            if (err instanceof N3HttpError) {
              httpStatus = err.status;
              envelopeCode = err.envelopeCode ?? null;
              errorMessage = err.message;
              rawSample = stripPricing(err.rawResponse);
              if (err.status === 404) outcome = "not_found";
              else if (err.status === 401) outcome = "unauthorized";
              else if (err.status === 403) outcome = "forbidden";
              else if (err.status >= 500) outcome = "server_error";
              else outcome = "envelope_error";
            } else {
              httpStatus = 0;
              envelopeCode = null;
              outcome = "network_error";
              errorMessage = err instanceof Error ? err.message : String(err);
            }
          }
          const elapsedMs = Date.now() - startedAt;

          console.info("[lifecycle-probe]", {
            tenant: user.tenantCode,
            resource: endpoint.resource,
            source,
            documentId,
            httpStatus,
            envelopeCode,
            outcome,
            elapsedMs,
          });

          return Response.json({
            tenantCode: user.tenantCode,
            resource: endpoint.resource,
            source_type: source,
            document_id: documentId,
            request: { method: endpoint.method, path },
            httpStatus,
            envelopeCode,
            outcome,
            elapsedMs,
            errorMessage,
            payloadSummary,
            rawSample,
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[diagnostics/lifecycle-probe] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Probe failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
