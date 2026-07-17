// CustomerSnapshotSync — pulls N3 Customers into public.customer_snapshots.
// Tenant-scoped. Uses immutable N3 Customer ID as the permanent key so a
// Customer Code rename in N3 updates the existing row instead of creating
// a duplicate. Falls back to (tenant, customer_code) when the incoming row
// has no id (legacy) or when backfilling an existing row that predates the
// n3_customer_id column.
//
// Pass 3 additions:
//   - Deduplicate incoming N3 rows by n3_customer_id before writing.
//   - After the pull, merge any pre-existing Supabase duplicates that share
//     the same (tenant, n3_customer_id) into a single canonical row so a
//     rename never leaves the old code row behind.
//   - Extended counters: renamed / duplicates_from_api_ignored / merged.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { N3_ENDPOINTS } from "@/lib/qne/endpoints";
import { n3IterateList, type N3TenantContext } from "./n3.server";
import { runWithSyncLog, type SyncResult } from "./log.server";
import { loadAllPaginated } from "./pagination.server";

interface N3Customer {
  id?: string | number;
  code?: string;
  companyName?: string;
  name?: string;
  contactPerson?: string;
  contact?: string;
  phone1?: string;
  phone?: string;
  email?: string;
  address1?: string;
  address?: string;
  isActive?: boolean;
  status?: string;
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

function normalise(row: N3Customer, tenantCode: string) {
  return {
    tenant_code: tenantCode,
    n3_customer_id: idOf(row.id),
    customer_code: (row.code ?? "").trim(),
    customer_name: pick(row.companyName, row.name),
    contact_person: pick(row.contactPerson, row.contact),
    phone: pick(row.phone1, row.phone),
    email: pick(row.email),
    address: pick(row.address1, row.address),
    n3_status: row.isActive === false ? "inactive" : pick(row.status) ?? "active",
    sync_status: "synced",
    last_synced_at: new Date().toISOString(),
  };
}

type Row = ReturnType<typeof normalise>;

function rowChanged(existing: Record<string, unknown> | undefined, next: Row): boolean {
  if (!existing) return true;
  const keys: Array<keyof Row> = [
    "n3_customer_id",
    "customer_code",
    "customer_name",
    "contact_person",
    "phone",
    "email",
    "address",
    "n3_status",
  ];
  return keys.some((k) => (existing[k as string] ?? null) !== (next[k] ?? null));
}

export async function syncCustomerSnapshots(ctx: N3TenantContext): Promise<SyncResult> {
  const { tenantCode } = ctx;
  return runWithSyncLog({ tenantCode, snapshotType: "customer" }, async (counters, heartbeat) => {
    await heartbeat("loading existing customer snapshots");

    // Paginated + tenant-scoped load. PostgREST caps a single select at
    // 1000 rows; without paging, tenants with >1000 snapshots build a
    // partial in-memory index, miss existing rows, push them to insert,
    // and collide on customer_snapshots_tenant_n3id_uidx.
    type ExistingCustomerRow = {
      id: string;
      n3_customer_id: string | null;
      customer_code: string | null;
      customer_name: string | null;
      contact_person: string | null;
      phone: string | null;
      email: string | null;
      address: string | null;
      n3_status: string | null;
      updated_at: string | null;
    };
    const existingRows = await loadAllPaginated<ExistingCustomerRow>(
      "customer_snapshots.existing",
      (from, to) =>
        supabaseAdmin
          .from("customer_snapshots")
          .select("id, n3_customer_id, customer_code, customer_name, contact_person, phone, email, address, n3_status, updated_at")
          .eq("tenant_code", tenantCode)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: ExistingCustomerRow[] | null; error: { message: string } | null }>,
    );

    const byId = new Map<string, Record<string, unknown> & { id: string }>();
    const byCode = new Map<string, Record<string, unknown> & { id: string }>();
    // Legacy null-id rows keyed by normalised customer_name — used as a
    // last-resort match for API rows whose immutable ID has not been linked
    // to any existing snapshot yet AND whose current N3 Code no longer
    // matches the stored (renamed) Code. Only entries where exactly ONE
    // legacy null-id row shares that name are trusted.
    const nameCounts = new Map<string, number>();
    const nameToRow = new Map<string, Record<string, unknown> & { id: string }>();
    const normName = (s: unknown) =>
      typeof s === "string" ? s.trim().toLowerCase() : "";
    for (const r of existingRows ?? []) {
      if (r.n3_customer_id) byId.set(r.n3_customer_id, r as never);
      if (r.customer_code) byCode.set(r.customer_code, r as never);
      if (!r.n3_customer_id) {
        const key = normName(r.customer_name);
        if (key) {
          nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
          nameToRow.set(key, r as never);
        }
      }
    }

    // Counters exposed on the sync log details.
    let received = 0;
    let renamed = 0;
    let legacy_name_merged = 0;
    let duplicates_from_api_ignored = 0;
    let unchanged = 0;

    const BATCH = 200;
    let batch: Row[] = [];
    const seenApiIds = new Set<string>();

    const flush = async () => {
      if (batch.length === 0) return;
      const toInsert: Row[] = [];
      const toUpdate: Array<{ id: string; row: Row; prevCode: string | null; hadId: boolean; legacyName: boolean }> = [];

      for (const r of batch) {
        let existing =
          (r.n3_customer_id && byId.get(r.n3_customer_id)) ||
          (r.customer_code && byCode.get(r.customer_code)) ||
          undefined;
        let legacyName = false;
        // Fallback: legacy null-id row with the same customer_name (unique).
        if (!existing && r.n3_customer_id) {
          const key = normName(r.customer_name);
          if (key && nameCounts.get(key) === 1) {
            const candidate = nameToRow.get(key);
            if (candidate && !candidate.n3_customer_id) {
              existing = candidate;
              legacyName = true;
            }
          }
        }

        if (!existing) {
          counters.inserted += 1;
          toInsert.push(r);
        } else if (rowChanged(existing, r) || legacyName) {
          const prevCode = (existing.customer_code as string) ?? null;
          const isRename = !!r.n3_customer_id && prevCode !== null && prevCode !== r.customer_code;
          if (legacyName) legacy_name_merged += 1;
          else if (isRename) renamed += 1;
          else counters.updated += 1;
          toUpdate.push({
            id: existing.id,
            row: r,
            prevCode,
            hadId: !!existing.n3_customer_id,
            legacyName,
          });
        } else {
          unchanged += 1;
          counters.skipped += 1;
        }
      }

      // Per-row insert so a single unique-index collision cannot abort
      // the whole batch and leave the sync stuck at the first BATCH boundary.
      for (const row of toInsert) {
        const { data, error } = await supabaseAdmin
          .from("customer_snapshots")
          .insert(row)
          .select("id, n3_customer_id, customer_code")
          .single();
        if (error) {
          counters.failed += 1;
          counters.inserted = Math.max(0, counters.inserted - 1);
          console.warn(
            `[customer-sync] insert failed tenant=${tenantCode} n3_id=${row.n3_customer_id ?? "null"} code=${row.customer_code}: ${error.message}`,
          );
          continue;
        }
        if (data?.n3_customer_id) byId.set(data.n3_customer_id, data as never);
        if (data?.customer_code) byCode.set(data.customer_code, data as never);
      }

      for (const { id, row, prevCode, hadId, legacyName } of toUpdate) {
        const { error } = await supabaseAdmin
          .from("customer_snapshots")
          .update(row)
          .eq("id", id);
        if (error) {
          counters.failed += 1;
          throw new Error(`Update customer ${id} failed: ${error.message}`);
        }
        // Legacy row backfilled with N3 ID → record it.
        if (!hadId && row.n3_customer_id) {
          await supabaseAdmin.from("snapshot_identity_backfill").insert({
            tenant_code: tenantCode,
            entity_type: "customer",
            entity_id: id,
            natural_key: prevCode,
            n3_id: row.n3_customer_id,
            match_method: legacyName ? "sync_pull_matched_name" : "sync_pull_matched_code",
            confidence: legacyName ? "medium" : "high",
            migration_status: "resolved",
            notes: legacyName
              ? `Backfilled N3 Customer ID during sync (matched by unique customer_name; previous Code ${prevCode ?? "n/a"} → ${row.customer_code}).`
              : "Backfilled N3 Customer ID during sync (matched by Code).",
          });
        }
        if (row.n3_customer_id) byId.set(row.n3_customer_id, { id, ...row } as never);
        if (row.customer_code) byCode.set(row.customer_code, { id, ...row } as never);
      }

      batch = [];
    };

    const ep = N3_ENDPOINTS["customers.list"];
    for await (const raw of n3IterateList<N3Customer>(ctx.token, ep.target, ep.path)) {
      received += 1;
      const norm = normalise(raw, tenantCode);
      if (!norm.customer_code && !norm.n3_customer_id) {
        counters.skipped += 1;
        continue;
      }
      // Dedupe the API stream by immutable ID (the same tenant should never
      // list the same customer twice, but guard anyway).
      if (norm.n3_customer_id) {
        if (seenApiIds.has(norm.n3_customer_id)) {
          duplicates_from_api_ignored += 1;
          continue;
        }
        seenApiIds.add(norm.n3_customer_id);
      }
      batch.push(norm);
      if (batch.length >= BATCH) {
        await flush();
        await heartbeat("upserting customers", { processed: received });
      }
    }
    await flush();

    // Post-pull merge: any lingering duplicates that share (tenant, n3_customer_id)
    // from historic renames. Keep the canonical row (highest updated_at),
    // delete the others. Renewal events / entitlements already carry
    // n3_customer_id so display data is preserved.
    await heartbeat("merging legacy duplicate customers");
    let merged = 0;
    const { data: dupCheck } = await supabaseAdmin
      .from("customer_snapshots")
      .select("id, n3_customer_id, customer_code, updated_at")
      .eq("tenant_code", tenantCode)
      .not("n3_customer_id", "is", null);

    const groups = new Map<string, Array<{ id: string; updated_at: string; customer_code: string }>>();
    for (const r of dupCheck ?? []) {
      if (!r.n3_customer_id) continue;
      const arr = groups.get(r.n3_customer_id) ?? [];
      arr.push(r as never);
      groups.set(r.n3_customer_id, arr);
    }
    for (const [n3Id, rows] of groups) {
      if (rows.length < 2) continue;
      rows.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
      const keeper = rows[0];
      const losers = rows.slice(1);
      for (const l of losers) {
        const { error } = await supabaseAdmin
          .from("customer_snapshots")
          .delete()
          .eq("id", l.id);
        if (error) {
          console.warn("[customer-sync] merge delete failed", l.id, error.message);
          continue;
        }
        merged += 1;
        await supabaseAdmin.from("snapshot_identity_backfill").insert({
          tenant_code: tenantCode,
          entity_type: "customer",
          entity_id: keeper.id,
          natural_key: l.customer_code,
          n3_id: n3Id,
          match_method: "post_sync_dedupe",
          confidence: "high",
          migration_status: "merged",
          notes: `Merged legacy duplicate row (code ${l.customer_code}) into canonical row (code ${keeper.customer_code}).`,
        });
      }
    }

    counters.details = {
      received,
      unique_n3_ids: seenApiIds.size,
      renamed,
      legacy_name_merged,
      unchanged,
      merged,
      duplicates_from_api_ignored,
    };

    await heartbeat("completed", { received, renamed, merged });
  });
}
