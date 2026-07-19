// GET /api/diagnostics/document-search?q=... — Administrator search over
// tenant-scoped Sales Invoice and Delivery Order line snapshots. Matches
// document_no, customer_code and customer_name (case-insensitive, partial).
// Returns a small candidate list keyed by (source_type, immutable N3 document
// ID) so a reused/deleted document number surfaces every distinct record.
// Never returns pricing, JWTs or raw payloads.

import { createFileRoute } from "@tanstack/react-router";
import {
  buildDocumentCandidates,
  type LineRow,
} from "@/lib/qne/diagnostics/document-candidates";

const MAX_RESULTS = 25;

function escapeLike(s: string): string {
  return s.replace(/[\\%_,]/g, (m) => "\\" + m);
}

export const Route = createFileRoute("/api/diagnostics/document-search")({
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
          const q = (url.searchParams.get("q") ?? "").trim();
          if (q.length < 2) {
            return Response.json({ query: q, tooShort: true, candidates: [] });
          }
          const like = `%${escapeLike(q)}%`;

          const SELECT =
            "n3_document_id, document_no, document_date, document_status, customer_code, customer_name, line_type, stock_code, is_void";

          const [mapRes, siRes, doRes] = await Promise.all([
            supabaseAdmin
              .from("renewal_stock_mappings")
              .select("stock_code, service_type, renewal_cycle_value")
              .eq("tenant_code", tenant)
              .eq("is_active", true),
            supabaseAdmin
              .from("sales_invoice_line_snapshots")
              .select(SELECT)
              .eq("tenant_code", tenant)
              .or(
                [
                  `document_no.ilike.${like}`,
                  `customer_code.ilike.${like}`,
                  `customer_name.ilike.${like}`,
                ].join(","),
              )
              .limit(5000),
            supabaseAdmin
              .from("delivery_order_line_snapshots")
              .select(SELECT)
              .eq("tenant_code", tenant)
              .or(
                [
                  `document_no.ilike.${like}`,
                  `customer_code.ilike.${like}`,
                  `customer_name.ilike.${like}`,
                ].join(","),
              )
              .limit(5000),
          ]);

          const renewalKeys = new Set<string>();
          for (const m of mapRes.data ?? []) {
            if (m.service_type !== "Renewal") continue;
            if (!m.renewal_cycle_value || m.renewal_cycle_value <= 0) continue;
            const k = (m.stock_code ?? "").trim().toLowerCase();
            if (k) renewalKeys.add(k);
          }

          const all = buildDocumentCandidates(
            [
              { rows: (siRes.data ?? []) as LineRow[], source: "invoice" },
              { rows: (doRes.data ?? []) as LineRow[], source: "delivery_order" },
            ],
            renewalKeys,
          );

          const candidates = all.slice(0, MAX_RESULTS);

          return Response.json({
            tenantCode: tenant,
            query: q,
            tooShort: false,
            truncated: all.length > MAX_RESULTS,
            candidates,
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[diagnostics/document-search] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Search failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
