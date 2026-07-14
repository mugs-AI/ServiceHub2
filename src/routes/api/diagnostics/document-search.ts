// GET /api/diagnostics/document-search?q=... — Administrator search over
// tenant-scoped Sales Invoice and Delivery Order line snapshots. Matches
// document_no, customer_code and customer_name (case-insensitive, partial).
// Returns a small candidate list; the user then opens one document in the
// Document Verifier. Never returns pricing, JWTs or raw payloads.

import { createFileRoute } from "@tanstack/react-router";

const MAX_RESULTS = 25;

function escapeLike(s: string): string {
  return s.replace(/[\\%_,]/g, (m) => "\\" + m);
}

interface Candidate {
  document_no: string;
  source_type: "invoice" | "delivery_order";
  document_date: string | null;
  customer_code: string | null;
  customer_name: string | null;
  total_lines: number;
  eligible_lines: number;
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

          const [mapRes, siRes, doRes] = await Promise.all([
            supabaseAdmin
              .from("renewal_stock_mappings")
              .select("stock_code, service_type, renewal_cycle_value")
              .eq("tenant_code", tenant)
              .eq("is_active", true),
            supabaseAdmin
              .from("sales_invoice_line_snapshots")
              .select(
                "document_no, document_date, customer_code, customer_name, line_type, stock_code, is_void",
              )
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
              .select(
                "document_no, document_date, customer_code, customer_name, line_type, stock_code, is_void",
              )
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

          const grouped = new Map<string, Candidate>();
          const ingest = (
            rows: NonNullable<typeof siRes.data>,
            source: "invoice" | "delivery_order",
          ) => {
            for (const r of rows) {
              const docNo = r.document_no ?? "";
              if (!docNo) continue;
              const key = `${source}::${docNo}`;
              let c = grouped.get(key);
              if (!c) {
                c = {
                  document_no: docNo,
                  source_type: source,
                  document_date: r.document_date ?? null,
                  customer_code: r.customer_code ?? null,
                  customer_name: r.customer_name ?? null,
                  total_lines: 0,
                  eligible_lines: 0,
                };
                grouped.set(key, c);
              }
              c.total_lines += 1;
              if (
                !r.is_void &&
                r.line_type === "stock" &&
                r.stock_code &&
                renewalKeys.has(r.stock_code.trim().toLowerCase())
              ) {
                c.eligible_lines += 1;
              }
            }
          };
          ingest(siRes.data ?? [], "invoice");
          ingest(doRes.data ?? [], "delivery_order");

          const candidates = Array.from(grouped.values())
            .sort((a, b) => {
              const ad = a.document_date ? Date.parse(a.document_date) : 0;
              const bd = b.document_date ? Date.parse(b.document_date) : 0;
              if (ad !== bd) return bd - ad;
              return a.document_no.localeCompare(b.document_no);
            })
            .slice(0, MAX_RESULTS);

          return Response.json({
            tenantCode: tenant,
            query: q,
            tooShort: false,
            truncated: grouped.size > MAX_RESULTS,
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
