// StockSnapshotSync — mirrors business fields only. Never pricing.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { N3_ENDPOINTS } from "@/lib/qne/endpoints";
import { n3IterateList, type N3TenantContext } from "./n3.server";
import { runWithSyncLog, type SyncResult } from "./log.server";

interface N3Stock {
  code?: string;
  stockName?: string;
  name?: string;
  description?: string;
  isActive?: boolean;
  [k: string]: unknown;
}

function pick(...vals: Array<string | undefined | null>): string | null {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v;
  return null;
}

function normalise(row: N3Stock, tenantCode: string) {
  return {
    tenant_code: tenantCode,
    stock_code: (row.code ?? "").trim(),
    stock_name: pick(row.stockName, row.name),
    description: pick(row.description),
    is_active: row.isActive !== false,
    last_synced_at: new Date().toISOString(),
  };
}

function rowChanged(existing: Record<string, unknown> | undefined, next: ReturnType<typeof normalise>): boolean {
  if (!existing) return true;
  return (
    (existing.stock_name ?? null) !== (next.stock_name ?? null) ||
    (existing.description ?? null) !== (next.description ?? null) ||
    (existing.is_active ?? null) !== (next.is_active ?? null)
  );
}

export async function syncStockSnapshots(ctx: N3TenantContext): Promise<SyncResult> {
  const { tenantCode } = ctx;
  return runWithSyncLog({ tenantCode, snapshotType: "stock" }, async (counters) => {
    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from("stock_snapshots")
      .select("stock_code, stock_name, description, is_active")
      .eq("tenant_code", tenantCode);
    if (existingErr) throw new Error(`Load existing stock failed: ${existingErr.message}`);
    const existingByCode = new Map<string, Record<string, unknown>>();
    for (const r of existingRows ?? []) existingByCode.set(r.stock_code, r as Record<string, unknown>);

    const BATCH = 200;
    let batch: ReturnType<typeof normalise>[] = [];

    const flush = async () => {
      if (batch.length === 0) return;
      const toWrite: ReturnType<typeof normalise>[] = [];
      for (const r of batch) {
        const existing = existingByCode.get(r.stock_code);
        if (!existing) {
          counters.inserted += 1;
          toWrite.push(r);
        } else if (rowChanged(existing, r)) {
          counters.updated += 1;
          toWrite.push(r);
        } else {
          counters.skipped += 1;
        }
      }
      if (toWrite.length > 0) {
        const { error } = await supabaseAdmin
          .from("stock_snapshots")
          .upsert(toWrite, { onConflict: "tenant_code,stock_code" });
        if (error) {
          counters.failed += toWrite.length;
          throw new Error(`Upsert stock failed: ${error.message}`);
        }
      }
      batch = [];
    };

    for await (const raw of n3IterateList<N3Stock>(ctx.token, "main", "/api/stock")) {
      const norm = normalise(raw, tenantCode);
      if (!norm.stock_code) {
        counters.skipped += 1;
        continue;
      }
      batch.push(norm);
      if (batch.length >= BATCH) await flush();
    }
    await flush();
  });
}
