// Administrator-only, tenant-scoped Stock Mapping API.
//
// GET  /api/settings/stock-mappings?mode=search&q=...&type=renewal|adhoc&limit=50&offset=0
// GET  /api/settings/stock-mappings?mode=configured&type=renewal|adhoc
// POST /api/settings/stock-mappings   { stock_code, service_type, contract_days? }
// PATCH /api/settings/stock-mappings  { stock_code, is_active }
// DELETE /api/settings/stock-mappings?stock_code=...
//
// Tenant is always resolved server-side from the authenticated N3 session.
// Never trust a browser-supplied tenant_code. Never returns pricing.

import { createFileRoute } from "@tanstack/react-router";

const MIN_QUERY_LEN = 2;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function escapeLike(s: string): string {
  return s.replace(/[\\%_,]/g, (m) => "\\" + m);
}

type ServiceTypeUi = "renewal" | "adhoc";
const SERVICE_TYPE_DB: Record<ServiceTypeUi, "Renewal" | "Ad Hoc"> = {
  renewal: "Renewal",
  adhoc: "Ad Hoc",
};

function parseType(v: string | null): ServiceTypeUi | null {
  if (v === "renewal" || v === "adhoc") return v;
  return null;
}

async function markContractSnapshotsStale(
  supabaseAdmin: import("@supabase/supabase-js").SupabaseClient,
  tenantCode: string,
) {
  await supabaseAdmin
    .from("customer_contract_snapshots")
    .update({ is_stale: true })
    .eq("tenant_code", tenantCode);
}

export const Route = createFileRoute("/api/settings/stock-mappings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAdministrator(request);
          const tenant = user.tenantCode;
          const url = new URL(request.url);
          const mode = url.searchParams.get("mode") ?? "search";

          if (mode === "configured") {
            const typeParam = parseType(url.searchParams.get("type"));
            let query = supabaseAdmin
              .from("renewal_stock_mappings")
              .select("stock_code, service_type, contract_days, is_active, updated_at")
              .eq("tenant_code", tenant)
              .order("stock_code", { ascending: true });
            if (typeParam) query = query.eq("service_type", SERVICE_TYPE_DB[typeParam]);
            const { data: mappings, error } = await query;
            if (error) throw error;

            const codes = (mappings ?? []).map((m) => m.stock_code);
            const namesByCode = new Map<string, { stock_name: string | null; description: string | null }>();
            if (codes.length > 0) {
              const { data: stocks, error: sErr } = await supabaseAdmin
                .from("stock_snapshots")
                .select("stock_code, stock_name, description")
                .eq("tenant_code", tenant)
                .in("stock_code", codes);
              if (sErr) throw sErr;
              for (const s of stocks ?? []) {
                namesByCode.set(s.stock_code, {
                  stock_name: s.stock_name,
                  description: s.description,
                });
              }
            }

            const rows = (mappings ?? []).map((m) => ({
              stock_code: m.stock_code,
              stock_name: namesByCode.get(m.stock_code)?.stock_name ?? null,
              description: namesByCode.get(m.stock_code)?.description ?? null,
              service_type: m.service_type,
              contract_days: m.contract_days,
              is_active: m.is_active,
              updated_at: m.updated_at,
            }));
            return Response.json({ rows });
          }

          // mode === "search"
          const qRaw = (url.searchParams.get("q") ?? "").trim();
          const limit = Math.min(
            Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT),
            MAX_LIMIT,
          );
          const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

          const { count: tenantTotal, error: countErr } = await supabaseAdmin
            .from("stock_snapshots")
            .select("stock_code", { count: "exact", head: true })
            .eq("tenant_code", tenant);
          if (countErr) throw countErr;

          if (qRaw.length < MIN_QUERY_LEN) {
            return Response.json({
              query: qRaw,
              tooShort: true,
              tenantHasSnapshots: (tenantTotal ?? 0) > 0,
              rows: [],
              hasMore: false,
            });
          }

          const like = `%${escapeLike(qRaw)}%`;
          const { data: stocks, error: stErr } = await supabaseAdmin
            .from("stock_snapshots")
            .select("stock_code, stock_name, description, is_active")
            .eq("tenant_code", tenant)
            .or(
              [
                `stock_code.ilike.${like}`,
                `stock_name.ilike.${like}`,
                `description.ilike.${like}`,
              ].join(","),
            )
            .order("stock_code", { ascending: true })
            .range(offset, offset + limit); // request one extra to detect hasMore
          if (stErr) throw stErr;

          const trimmed = (stocks ?? []).slice(0, limit);
          const hasMore = (stocks?.length ?? 0) > limit;

          const codes = trimmed.map((s) => s.stock_code);
          const mappingByCode = new Map<
            string,
            { service_type: string; contract_days: number | null; is_active: boolean }
          >();
          if (codes.length > 0) {
            const { data: existing, error: mErr } = await supabaseAdmin
              .from("renewal_stock_mappings")
              .select("stock_code, service_type, contract_days, is_active")
              .eq("tenant_code", tenant)
              .in("stock_code", codes);
            if (mErr) throw mErr;
            for (const m of existing ?? []) {
              mappingByCode.set(m.stock_code, {
                service_type: m.service_type,
                contract_days: m.contract_days,
                is_active: m.is_active,
              });
            }
          }

          const rows = trimmed.map((s) => ({
            stock_code: s.stock_code,
            stock_name: s.stock_name,
            description: s.description,
            is_active: s.is_active,
            mapping: mappingByCode.get(s.stock_code) ?? null,
          }));

          return Response.json({
            query: qRaw,
            tooShort: false,
            tenantHasSnapshots: (tenantTotal ?? 0) > 0,
            rows,
            hasMore,
            limit,
            offset,
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/stock-mappings GET] failed", err);
          return Response.json(
            { error: "Stock Mapping is temporarily unavailable. Please try again." },
            { status: 500 },
          );
        }
      },

      POST: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAdministrator(request);
          const body = (await request.json().catch(() => ({}))) as {
            stock_code?: string;
            service_type?: string;
            contract_days?: number | null;
          };
          const stockCode = String(body.stock_code ?? "").trim();
          const typeUi = parseType(String(body.service_type ?? ""));
          if (!stockCode) {
            return Response.json({ error: "stock_code is required" }, { status: 400 });
          }
          if (!typeUi) {
            return Response.json(
              { error: "service_type must be 'renewal' or 'adhoc'" },
              { status: 400 },
            );
          }
          let contractDays: number | null = null;
          if (typeUi === "renewal") {
            const n = Number(body.contract_days);
            if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
              return Response.json(
                { error: "Contract Days must be a whole number ≥ 1" },
                { status: 400 },
              );
            }
            contractDays = n;
          }

          // Confirm the stock code exists in this tenant's snapshots — prevents
          // mapping arbitrary strings and preserves tenant isolation.
          const { data: stock, error: stErr } = await supabaseAdmin
            .from("stock_snapshots")
            .select("stock_code")
            .eq("tenant_code", user.tenantCode)
            .eq("stock_code", stockCode)
            .maybeSingle();
          if (stErr) throw stErr;
          if (!stock) {
            return Response.json(
              { error: "Stock code not found in this Client's snapshots" },
              { status: 404 },
            );
          }

          const { data, error } = await supabaseAdmin
            .from("renewal_stock_mappings")
            .upsert(
              {
                tenant_code: user.tenantCode,
                stock_code: stockCode,
                service_type: SERVICE_TYPE_DB[typeUi],
                contract_days: contractDays,
                is_active: true,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "tenant_code,stock_code" },
            )
            .select("stock_code, service_type, contract_days, is_active")
            .single();
          if (error) throw error;

          await markContractSnapshotsStale(supabaseAdmin, user.tenantCode);
          return Response.json({ ok: true, mapping: data });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/stock-mappings POST] failed", err);
          return Response.json(
            { error: "Mapping could not be saved. Please try again." },
            { status: 500 },
          );
        }
      },

      PATCH: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAdministrator(request);
          const body = (await request.json().catch(() => ({}))) as {
            stock_code?: string;
            is_active?: boolean;
          };
          const stockCode = String(body.stock_code ?? "").trim();
          if (!stockCode || typeof body.is_active !== "boolean") {
            return Response.json(
              { error: "stock_code and is_active are required" },
              { status: 400 },
            );
          }
          const { error } = await supabaseAdmin
            .from("renewal_stock_mappings")
            .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
            .eq("tenant_code", user.tenantCode)
            .eq("stock_code", stockCode);
          if (error) throw error;
          await markContractSnapshotsStale(supabaseAdmin, user.tenantCode);
          return Response.json({ ok: true });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/stock-mappings PATCH] failed", err);
          return Response.json(
            { error: "Mapping could not be updated. Please try again." },
            { status: 500 },
          );
        }
      },

      DELETE: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAdministrator(request);
          const url = new URL(request.url);
          const stockCode = (url.searchParams.get("stock_code") ?? "").trim();
          if (!stockCode) {
            return Response.json({ error: "stock_code required" }, { status: 400 });
          }
          const { error } = await supabaseAdmin
            .from("renewal_stock_mappings")
            .delete()
            .eq("tenant_code", user.tenantCode)
            .eq("stock_code", stockCode);
          if (error) throw error;
          await markContractSnapshotsStale(supabaseAdmin, user.tenantCode);
          return Response.json({ ok: true });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[settings/stock-mappings DELETE] failed", err);
          return Response.json(
            { error: "Mapping could not be removed. Please try again." },
            { status: 500 },
          );
        }
      },
    },
  },
});
