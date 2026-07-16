// GET /api/workspace/customers?q=... — tenant-scoped Customer Snapshot search.
// Reads only from public.customer_snapshots for the authenticated tenant.
// Never calls N3 OpenAPI; never trusts client-supplied tenant_code.

import { createFileRoute } from "@tanstack/react-router";

const MAX_RESULTS = 20;
const MIN_QUERY_LEN = 2;

function escapeLike(s: string): string {
  return s.replace(/[\\%_,]/g, (m) => "\\" + m);
}

export const Route = createFileRoute("/api/workspace/customers")({
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
          const tenant = user.tenantCode;

          const url = new URL(request.url);
          const qRaw = (url.searchParams.get("q") ?? "").trim();

          // Check whether this tenant has any snapshots at all — used to
          // distinguish "no match" from "empty snapshot store".
          const { count: tenantTotal, error: countErr } = await supabaseAdmin
            .from("customer_snapshots")
            .select("customer_code", { count: "exact", head: true })
            .eq("tenant_code", tenant);
          if (countErr) throw countErr;

          if (qRaw.length < MIN_QUERY_LEN) {
            return Response.json({
              query: qRaw,
              tenantHasSnapshots: (tenantTotal ?? 0) > 0,
              rows: [],
              tooShort: true,
            });
          }

          const like = `%${escapeLike(qRaw)}%`;

          const { data, error } = await supabaseAdmin
            .from("customer_snapshots")
            .select(
              "n3_customer_id, customer_code, customer_name, contact_person, phone, email, last_synced_at",
            )
            .eq("tenant_code", tenant)
            .or(
              [
                `customer_code.ilike.${like}`,
                `customer_name.ilike.${like}`,
                `contact_person.ilike.${like}`,
                `phone.ilike.${like}`,
                `email.ilike.${like}`,
              ].join(","),
            )
            .limit(MAX_RESULTS * 2);
          if (error) throw error;

          // Deduplicate by immutable N3 Customer ID — prefer the row that
          // already carries the ID (canonical) over any legacy null-id row
          // that lingers before the next sync clears it.
          const byIdentity = new Map<string, (typeof data)[number]>();
          const legacyOnly: typeof data = [];
          for (const r of data ?? []) {
            if (r.n3_customer_id) {
              const prev = byIdentity.get(r.n3_customer_id);
              if (!prev) byIdentity.set(r.n3_customer_id, r);
            } else {
              legacyOnly.push(r);
            }
          }
          const deduped = [...byIdentity.values(), ...legacyOnly];

          const qLower = qRaw.toLowerCase();
          const rows = deduped
            .map((r) => ({
              ...r,
              _exact: (r.customer_code ?? "").toLowerCase() === qLower ? 0 : 1,
            }))
            .sort((a, b) => {
              if (a._exact !== b._exact) return a._exact - b._exact;
              const an = (a.customer_name ?? "").toLowerCase();
              const bn = (b.customer_name ?? "").toLowerCase();
              if (an !== bn) return an < bn ? -1 : 1;
              return (a.customer_code ?? "").localeCompare(b.customer_code ?? "");
            })
            .slice(0, MAX_RESULTS)
            .map(({ _exact: _e, n3_customer_id: _n, ...rest }) => rest);

          return Response.json({
            query: qRaw,
            tenantHasSnapshots: (tenantTotal ?? 0) > 0,
            rows,
            tooShort: false,
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/customers] failed", err);
          return Response.json(
            { error: "Customer Lookup is temporarily unavailable. Please try again." },
            { status: 500 },
          );
        }
      },
    },
  },
});
