// StockSnapshotSync — mirrors business fields only. Never pricing.
// Uses immutable N3 Stock ID as the permanent key so a Stock Code rename
// updates the same row (and its renewal mapping / entitlement follow) rather
// than creating a duplicate.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { N3_ENDPOINTS } from "@/lib/qne/endpoints";
import { n3IterateList, type N3TenantContext } from "./n3.server";
import { runWithSyncLog, type SyncResult } from "./log.server";
import { loadAllPaginated } from "./pagination.server";

interface N3Stock {
  id?: string | number;
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

function idOf(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function normalise(row: N3Stock, tenantCode: string) {
  return {
    tenant_code: tenantCode,
    n3_stock_id: idOf(row.id),
    stock_code: (row.code ?? "").trim(),
    stock_name: pick(row.stockName, row.name),
    description: pick(row.description),
    is_active: row.isActive !== false,
    last_synced_at: new Date().toISOString(),
  };
}

type Row = ReturnType<typeof normalise>;

function rowChanged(existing: Record<string, unknown> | undefined, next: Row): boolean {
  if (!existing) return true;
  return (
    (existing.n3_stock_id ?? null) !== (next.n3_stock_id ?? null) ||
    (existing.stock_code ?? null) !== (next.stock_code ?? null) ||
    (existing.stock_name ?? null) !== (next.stock_name ?? null) ||
    (existing.description ?? null) !== (next.description ?? null) ||
    (existing.is_active ?? null) !== (next.is_active ?? null)
  );
}

export async function syncStockSnapshots(ctx: N3TenantContext): Promise<SyncResult> {
  const { tenantCode } = ctx;
  return runWithSyncLog({ tenantCode, snapshotType: "stock" }, async (counters, heartbeat) => {
    await heartbeat("loading existing stock snapshots");

    // Paginated + tenant-scoped load — mirrors customer-sync fix so tenants
    // with >1000 stock rows keep a complete in-memory index and cannot
    // collide on stock_snapshots_tenant_n3id_uidx.
    type ExistingStockRow = {
      id: string;
      n3_stock_id: string | null;
      stock_code: string | null;
      stock_name: string | null;
      description: string | null;
      is_active: boolean | null;
    };
    const existingRows = await loadAllPaginated<ExistingStockRow>(
      "stock_snapshots.existing",
      (from, to) =>
        supabaseAdmin
          .from("stock_snapshots")
          .select("id, n3_stock_id, stock_code, stock_name, description, is_active")
          .eq("tenant_code", tenantCode)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: ExistingStockRow[] | null; error: { message: string } | null }>,
    );

    const byId = new Map<string, Record<string, unknown> & { id: string }>();
    const byCode = new Map<string, Record<string, unknown> & { id: string }>();
    for (const r of existingRows ?? []) {
      if (r.n3_stock_id) byId.set(r.n3_stock_id, r as never);
      if (r.stock_code) byCode.set(r.stock_code, r as never);
    }

    // When a mapping's original stock_code has been renamed we also refresh
    // the mapping's stock_code + stock_name here (its permanent key is the
    // n3_stock_id).
    const mappingUpdates = new Map<string, { stock_code: string; stock_name: string | null }>();

    const BATCH = 200;
    let batch: Row[] = [];
    let processed = 0;
    const seenApiIds = new Set<string>();
    let renamed = 0;
    let duplicates_from_api_ignored = 0;

    const flush = async () => {
      if (batch.length === 0) return;
      const toInsert: Row[] = [];
      const toUpdate: Array<{ id: string; row: Row; prevCode: string | null }> = [];

      for (const r of batch) {
        const existing =
          (r.n3_stock_id && byId.get(r.n3_stock_id)) ||
          (r.stock_code && byCode.get(r.stock_code)) ||
          undefined;

        if (!existing) {
          counters.inserted += 1;
          toInsert.push(r);
        } else if (rowChanged(existing, r)) {
          const prevCode = (existing.stock_code as string) ?? null;
          if (r.n3_stock_id && prevCode && prevCode !== r.stock_code) renamed += 1;
          else counters.updated += 1;
          toUpdate.push({ id: existing.id, row: r, prevCode });
        } else {
          counters.skipped += 1;
        }
      }

      if (toInsert.length > 0) {
        const { data, error } = await supabaseAdmin
          .from("stock_snapshots")
          .insert(toInsert)
          .select("id, n3_stock_id, stock_code");
        if (error) {
          counters.failed += toInsert.length;
          counters.inserted = Math.max(0, counters.inserted - toInsert.length);
          throw new Error(`Insert stock failed: ${error.message}`);
        }
        for (const r of data ?? []) {
          if (r.n3_stock_id) byId.set(r.n3_stock_id, r as never);
          if (r.stock_code) byCode.set(r.stock_code, r as never);
        }
      }

      for (const { id, row, prevCode } of toUpdate) {
        const { error } = await supabaseAdmin
          .from("stock_snapshots")
          .update(row)
          .eq("id", id);
        if (error) {
          counters.failed += 1;
          throw new Error(`Update stock ${id} failed: ${error.message}`);
        }
        // Detect rename → schedule mapping refresh.
        if (row.n3_stock_id && prevCode && prevCode !== row.stock_code) {
          mappingUpdates.set(row.n3_stock_id, {
            stock_code: row.stock_code,
            stock_name: row.stock_name,
          });
        }
        if (row.n3_stock_id) byId.set(row.n3_stock_id, { id, ...row } as never);
        if (row.stock_code) byCode.set(row.stock_code, { id, ...row } as never);
      }

      batch = [];
    };

    const ep = N3_ENDPOINTS["stock.list"];
    for await (const raw of n3IterateList<N3Stock>(ctx.token, ep.target, ep.path)) {
      const norm = normalise(raw, tenantCode);
      if (!norm.stock_code && !norm.n3_stock_id) {
        counters.skipped += 1;
        continue;
      }
      if (norm.n3_stock_id) {
        if (seenApiIds.has(norm.n3_stock_id)) {
          duplicates_from_api_ignored += 1;
          continue;
        }
        seenApiIds.add(norm.n3_stock_id);
      }
      batch.push(norm);
      processed += 1;
      if (batch.length >= BATCH) {
        await flush();
        await heartbeat("upserting stock", { processed });
      }
    }
    await flush();

    // Refresh renewal_stock_mappings display fields for any renamed stock.
    if (mappingUpdates.size > 0) {
      await heartbeat("refreshing renewal mappings after stock rename", {
        renamed: mappingUpdates.size,
      });
      for (const [n3StockId, upd] of mappingUpdates) {
        const { error } = await supabaseAdmin
          .from("renewal_stock_mappings")
          .update(upd)
          .eq("tenant_code", tenantCode)
          .eq("n3_stock_id", n3StockId);
        if (error) {
          console.warn("[stock-sync] mapping refresh failed", n3StockId, error.message);
        }
      }
    }

    // Merge lingering Supabase-side duplicates that share (tenant, n3_stock_id).
    await heartbeat("merging legacy duplicate stock rows");
    let merged = 0;
    type DupStockRow = { id: string; n3_stock_id: string | null; stock_code: string; updated_at: string };
    const dupCheck = await loadAllPaginated<DupStockRow>(
      "stock_snapshots.dupCheck",
      (from, to) =>
        supabaseAdmin
          .from("stock_snapshots")
          .select("id, n3_stock_id, stock_code, updated_at")
          .eq("tenant_code", tenantCode)
          .not("n3_stock_id", "is", null)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: DupStockRow[] | null; error: { message: string } | null }>,
    );
    const groups = new Map<string, Array<{ id: string; updated_at: string; stock_code: string }>>();
    for (const r of dupCheck) {
      if (!r.n3_stock_id) continue;
      const arr = groups.get(r.n3_stock_id) ?? [];
      arr.push(r as never);
      groups.set(r.n3_stock_id, arr);
    }
    for (const [n3Id, rows] of groups) {
      if (rows.length < 2) continue;
      rows.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
      const keeper = rows[0];
      for (const l of rows.slice(1)) {
        const { error } = await supabaseAdmin.from("stock_snapshots").delete().eq("id", l.id);
        if (error) {
          console.warn("[stock-sync] merge delete failed", l.id, error.message);
          continue;
        }
        merged += 1;
        await supabaseAdmin.from("snapshot_identity_backfill").insert({
          tenant_code: tenantCode,
          entity_type: "stock",
          entity_id: keeper.id,
          natural_key: l.stock_code,
          n3_id: n3Id,
          match_method: "post_sync_dedupe",
          confidence: "high",
          migration_status: "merged",
          notes: `Merged legacy duplicate stock row (code ${l.stock_code}) into canonical (code ${keeper.stock_code}).`,
        });
      }
    }

    counters.details = {
      received: processed,
      unique_n3_ids: seenApiIds.size,
      renamed,
      duplicates_from_api_ignored,
      renamed_mappings_refreshed: mappingUpdates.size,
      merged,
    };

    await heartbeat("completed", { processed, renamed, merged });
  });
}
