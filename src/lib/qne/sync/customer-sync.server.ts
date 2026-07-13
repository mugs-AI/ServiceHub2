// CustomerSnapshotSync — pulls N3 Customers into public.customer_snapshots.
// Tenant-scoped: only rows belonging to the resolved tenant are touched.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { N3_ENDPOINTS } from "@/lib/qne/endpoints";
import { n3IterateList, type N3TenantContext } from "./n3.server";
import { runWithSyncLog, type SyncResult } from "./log.server";

interface N3Customer {
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

function normalise(row: N3Customer, tenantCode: string) {
  return {
    tenant_code: tenantCode,
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

function rowChanged(existing: Record<string, unknown> | undefined, next: ReturnType<typeof normalise>): boolean {
  if (!existing) return true;
  const keys: Array<keyof ReturnType<typeof normalise>> = [
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
  return runWithSyncLog({ tenantCode, snapshotType: "customer" }, async (counters) => {
    // Load existing rows for change detection (single query per tenant).
    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from("customer_snapshots")
      .select("customer_code, customer_name, contact_person, phone, email, address, n3_status")
      .eq("tenant_code", tenantCode);
    if (existingErr) throw new Error(`Load existing customers failed: ${existingErr.message}`);
    const existingByCode = new Map<string, Record<string, unknown>>();
    for (const r of existingRows ?? []) existingByCode.set(r.customer_code, r as Record<string, unknown>);

    const BATCH = 200;
    let batch: ReturnType<typeof normalise>[] = [];

    const flush = async () => {
      if (batch.length === 0) return;
      // Split into new vs changed for accurate counters.
      const toWrite: ReturnType<typeof normalise>[] = [];
      for (const r of batch) {
        const existing = existingByCode.get(r.customer_code);
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
          .from("customer_snapshots")
          .upsert(toWrite, { onConflict: "tenant_code,customer_code" });
        if (error) {
          counters.failed += toWrite.length;
          counters.inserted = Math.max(0, counters.inserted - toWrite.length);
          throw new Error(`Upsert customers failed: ${error.message}`);
        }
      }
      batch = [];
    };

    for await (const raw of n3IterateList<N3Customer>(ctx.token, "main", "/api/customer")) {
      const norm = normalise(raw, tenantCode);
      if (!norm.customer_code) {
        counters.skipped += 1;
        continue;
      }
      batch.push(norm);
      if (batch.length >= BATCH) await flush();
    }
    await flush();
  });
}
