// CustomerSnapshotSync — pulls N3 Customers into public.customer_snapshots.
// Tenant-scoped. Uses immutable N3 Customer ID as the permanent key so a
// Customer Code rename in N3 updates the existing row instead of creating
// a duplicate. Falls back to (tenant, customer_code) when the incoming row
// has no id (legacy) or when backfilling an existing row that predates the
// n3_customer_id column.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { N3_ENDPOINTS } from "@/lib/qne/endpoints";
import { n3IterateList, type N3TenantContext } from "./n3.server";
import { runWithSyncLog, type SyncResult } from "./log.server";

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

    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from("customer_snapshots")
      .select("id, n3_customer_id, customer_code, customer_name, contact_person, phone, email, address, n3_status");
    if (existingErr) throw new Error(`Load existing customers failed: ${existingErr.message}`);

    // Two lookup maps: primary by N3 ID (immutable), fallback by code (legacy).
    const byId = new Map<string, Record<string, unknown> & { id: string }>();
    const byCode = new Map<string, Record<string, unknown> & { id: string }>();
    for (const r of existingRows ?? []) {
      if (r.n3_customer_id) byId.set(r.n3_customer_id, r as Record<string, unknown> & { id: string });
      if (r.customer_code) byCode.set(r.customer_code, r as Record<string, unknown> & { id: string });
    }

    const BATCH = 200;
    let batch: Row[] = [];
    let processed = 0;

    const flush = async () => {
      if (batch.length === 0) return;
      const toInsert: Row[] = [];
      const toUpdate: Array<{ id: string; row: Row }> = [];

      for (const r of batch) {
        // Match order: N3 id → legacy code. Never both.
        const existing =
          (r.n3_customer_id && byId.get(r.n3_customer_id)) ||
          (r.customer_code && byCode.get(r.customer_code)) ||
          undefined;

        if (!existing) {
          counters.inserted += 1;
          toInsert.push(r);
        } else if (rowChanged(existing, r)) {
          counters.updated += 1;
          toUpdate.push({ id: existing.id, row: r });
        } else {
          counters.skipped += 1;
        }
      }

      if (toInsert.length > 0) {
        const { data, error } = await supabaseAdmin
          .from("customer_snapshots")
          .insert(toInsert)
          .select("id, n3_customer_id, customer_code");
        if (error) {
          counters.failed += toInsert.length;
          counters.inserted = Math.max(0, counters.inserted - toInsert.length);
          throw new Error(`Insert customers failed: ${error.message}`);
        }
        for (const r of data ?? []) {
          if (r.n3_customer_id) byId.set(r.n3_customer_id, r as never);
          if (r.customer_code) byCode.set(r.customer_code, r as never);
        }
      }

      for (const { id, row } of toUpdate) {
        const { error } = await supabaseAdmin
          .from("customer_snapshots")
          .update(row)
          .eq("id", id);
        if (error) {
          counters.failed += 1;
          throw new Error(`Update customer ${id} failed: ${error.message}`);
        }
        // Refresh cache in case code changed (rename case).
        if (row.n3_customer_id) byId.set(row.n3_customer_id, { id, ...row } as never);
        if (row.customer_code) byCode.set(row.customer_code, { id, ...row } as never);
      }

      batch = [];
    };

    const ep = N3_ENDPOINTS["customers.list"];
    for await (const raw of n3IterateList<N3Customer>(ctx.token, ep.target, ep.path)) {
      const norm = normalise(raw, tenantCode);
      if (!norm.customer_code && !norm.n3_customer_id) {
        counters.skipped += 1;
        continue;
      }
      batch.push(norm);
      processed += 1;
      if (batch.length >= BATCH) {
        await flush();
        await heartbeat("upserting customers", { processed });
      }
    }
    await flush();
    await heartbeat("completed", { processed });
  });
}
