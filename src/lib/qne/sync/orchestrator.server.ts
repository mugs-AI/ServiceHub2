// Unified Sync Orchestrator — runs Customers → Stock → Subscriptions in
// sequence for one Client, tracking a single parent `sync_orchestrations`
// row across all stages. Also refreshes current display Codes/Names on
// customer_subscription_snapshots from their master snapshots after the
// Subscription stage completes.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { N3TenantContext } from "./n3.server";
import { syncCustomerSnapshots } from "./customer-sync.server";
import { syncStockSnapshots } from "./stock-sync.server";
import { syncSubscriptionSnapshots } from "./subscription-sync.server";
import { SyncLockedError, type SyncResult } from "./log.server";

export type OrchestrationStatus = "queued" | "running" | "success" | "partial" | "failed";

export interface OrchestrationRow {
  id: string;
  tenant_code: string;
  overall_status: OrchestrationStatus;
  current_stage: string | null;
  current_stage_index: number;
  total_stages: number;
  customer_run_id: string | null;
  stock_run_id: string | null;
  subscription_run_id: string | null;
  customer_result: SyncResult | null;
  stock_result: SyncResult | null;
  subscription_result: SyncResult | null;
  safe_error_summary: string | null;
  started_at: string;
  last_heartbeat_at: string;
  completed_at: string | null;
  total_duration_ms: number | null;
}

const STAGES = [
  "Syncing Customers",
  "Syncing Stock",
  "Syncing Subscriptions (headers, details, events, rebuild)",
  "Refreshing display Codes and Names",
] as const;

async function updateOrch(id: string, patch: Record<string, unknown>) {
  const { error } = await supabaseAdmin
    .from("sync_orchestrations")
    .update({ ...patch, last_heartbeat_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.warn("[orchestrator] update failed", error.message);
}

/**
 * Refresh current display Codes/Names on customer_subscription_snapshots
 * from the master snapshots. Only runs where n3_customer_id or n3_stock_id
 * are present so a code-only legacy row is never overwritten with NULL.
 */
async function refreshEntitlementDisplay(tenantCode: string) {
  // Customer display
  await supabaseAdmin.rpc("void_noop").select().limit(0).then(() => {}).catch(() => {});
  await supabaseAdmin
    .from("customer_subscription_snapshots")
    .select("id")
    .limit(0); // warm-up no-op

  // Fetch masters
  const [{ data: cust }, { data: stock }] = await Promise.all([
    supabaseAdmin
      .from("customer_snapshots")
      .select("n3_customer_id, customer_code, customer_name")
      .eq("tenant_code", tenantCode)
      .not("n3_customer_id", "is", null),
    supabaseAdmin
      .from("stock_snapshots")
      .select("n3_stock_id, stock_code, stock_name")
      .eq("tenant_code", tenantCode)
      .not("n3_stock_id", "is", null),
  ]);

  const custById = new Map<string, { code: string; name: string | null }>();
  for (const c of cust ?? []) if (c.n3_customer_id) custById.set(c.n3_customer_id, { code: c.customer_code, name: c.customer_name });
  const stockById = new Map<string, { code: string; name: string | null }>();
  for (const s of stock ?? []) if (s.n3_stock_id) stockById.set(s.n3_stock_id, { code: s.stock_code, name: s.stock_name });

  const { data: entRows } = await supabaseAdmin
    .from("customer_subscription_snapshots")
    .select("id, n3_customer_id, n3_stock_id, customer_code, customer_name, stock_code, stock_name")
    .eq("tenant_code", tenantCode);

  let refreshed = 0;
  for (const row of entRows ?? []) {
    const patch: Record<string, string | null> = {};
    if (row.n3_customer_id) {
      const c = custById.get(row.n3_customer_id);
      if (c) {
        if (c.code && c.code !== row.customer_code) patch.customer_code = c.code;
        if (c.name && c.name !== row.customer_name) patch.customer_name = c.name;
      }
    }
    if (row.n3_stock_id) {
      const s = stockById.get(row.n3_stock_id);
      if (s) {
        if (s.code && s.code !== row.stock_code) patch.stock_code = s.code;
        if (s.name && s.name !== row.stock_name) patch.stock_name = s.name;
      }
    }
    if (Object.keys(patch).length > 0) {
      await supabaseAdmin.from("customer_subscription_snapshots").update(patch).eq("id", row.id);
      refreshed += 1;
    }
  }

  // Also refresh renewal_stock_mappings display fields when stock code differs.
  const { data: mapRows } = await supabaseAdmin
    .from("renewal_stock_mappings")
    .select("id, n3_stock_id, stock_code, stock_name")
    .eq("tenant_code", tenantCode)
    .not("n3_stock_id", "is", null);
  for (const m of mapRows ?? []) {
    const s = stockById.get(m.n3_stock_id!);
    if (!s) continue;
    const patch: Record<string, string | null> = {};
    if (s.code && s.code !== m.stock_code) patch.stock_code = s.code;
    if (s.name && s.name !== m.stock_name) patch.stock_name = s.name;
    if (Object.keys(patch).length > 0) {
      await supabaseAdmin.from("renewal_stock_mappings").update(patch).eq("id", m.id);
      refreshed += 1;
    }
  }

  return refreshed;
}

function statusOf(r: SyncResult | null | undefined): "success" | "partial" | "failed" | "skipped" {
  if (!r) return "skipped";
  return (r.status as "success" | "partial" | "failed") ?? "failed";
}

export async function runFullSync(ctx: N3TenantContext): Promise<OrchestrationRow> {
  const started = Date.now();
  const { data: created, error: createErr } = await supabaseAdmin
    .from("sync_orchestrations")
    .insert({
      tenant_code: ctx.tenantCode,
      orchestration_type: "full",
      overall_status: "running",
      current_stage: STAGES[0],
      current_stage_index: 1,
      total_stages: STAGES.length,
    })
    .select("*")
    .single();
  if (createErr || !created) {
    throw new Error(`Failed to create sync_orchestrations row: ${createErr?.message ?? "unknown"}`);
  }
  const orchId = created.id as string;

  let customer: SyncResult | null = null;
  let stock: SyncResult | null = null;
  let subscription: SyncResult | null = null;
  let errorSummary: string | null = null;

  try {
    await updateOrch(orchId, { current_stage: STAGES[0], current_stage_index: 1 });
    customer = await syncCustomerSnapshots(ctx);
    await updateOrch(orchId, {
      customer_run_id: customer.logId,
      customer_result: customer as never,
    });

    await updateOrch(orchId, { current_stage: STAGES[1], current_stage_index: 2 });
    stock = await syncStockSnapshots(ctx);
    await updateOrch(orchId, { stock_run_id: stock.logId, stock_result: stock as never });

    await updateOrch(orchId, { current_stage: STAGES[2], current_stage_index: 3 });
    subscription = await syncSubscriptionSnapshots(ctx);
    await updateOrch(orchId, {
      subscription_run_id: subscription.logId,
      subscription_result: subscription as never,
    });

    await updateOrch(orchId, { current_stage: STAGES[3], current_stage_index: 4 });
    const refreshed = await refreshEntitlementDisplay(ctx.tenantCode);

    const stages = [statusOf(customer), statusOf(stock), statusOf(subscription)];
    const overall: OrchestrationStatus =
      stages.some((s) => s === "failed")
        ? "failed"
        : stages.some((s) => s === "partial")
        ? "partial"
        : "success";

    const durationMs = Date.now() - started;
    await updateOrch(orchId, {
      overall_status: overall,
      current_stage: "Completed",
      current_stage_index: STAGES.length,
      completed_at: new Date().toISOString(),
      total_duration_ms: durationMs,
      current_stage_progress: { display_refreshed: refreshed } as never,
    });
  } catch (err) {
    if (err instanceof SyncLockedError) {
      errorSummary = err.userMessage;
    } else {
      errorSummary = err instanceof Error ? err.message : String(err);
    }
    await updateOrch(orchId, {
      overall_status: "failed",
      completed_at: new Date().toISOString(),
      total_duration_ms: Date.now() - started,
      safe_error_summary: errorSummary,
    });
  }

  const { data: final } = await supabaseAdmin
    .from("sync_orchestrations")
    .select("*")
    .eq("id", orchId)
    .single();
  return (final ?? { ...created, overall_status: "failed" }) as OrchestrationRow;
}

export async function getLatestOrchestration(tenantCode: string): Promise<OrchestrationRow | null> {
  const { data } = await supabaseAdmin
    .from("sync_orchestrations")
    .select("*")
    .eq("tenant_code", tenantCode)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as OrchestrationRow | null;
}
