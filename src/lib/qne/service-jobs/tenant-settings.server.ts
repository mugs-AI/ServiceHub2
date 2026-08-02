// Server-side tenant settings persistence (Run 7).
// Stored inside general_settings.extra so no new table is needed for
// Travel & GPS, Attachments & Storage and Completion & Acknowledgement.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_TENANT_SETTINGS,
  mergeTenantSettings,
  type TenantSettings,
} from "./tenant-settings";

export async function loadTenantSettings(tenantCode: string): Promise<TenantSettings> {
  const { data, error } = await supabaseAdmin
    .from("general_settings")
    .select("extra")
    .eq("tenant_code", tenantCode)
    .maybeSingle();
  if (error) throw error;
  const extra = (data?.extra ?? {}) as Record<string, unknown>;
  return mergeTenantSettings(extra.run7 ?? {});
}

export async function saveTenantSettings(
  tenantCode: string,
  next: TenantSettings,
  actor: { userId: string | null; name: string | null },
  area: string,
): Promise<TenantSettings> {
  const { data: existing } = await supabaseAdmin
    .from("general_settings")
    .select("extra")
    .eq("tenant_code", tenantCode)
    .maybeSingle();

  const extra = { ...((existing?.extra ?? {}) as Record<string, unknown>) };
  const before = mergeTenantSettings((extra as { run7?: unknown }).run7 ?? {});
  extra.run7 = next;

  const { error } = await supabaseAdmin
    .from("general_settings")
    .upsert(
      { tenant_code: tenantCode, extra: extra as never },
      { onConflict: "tenant_code" },
    );
  if (error) throw error;

  await auditSettings(tenantCode, area, "updated", before, next, actor);
  return next;
}

export async function auditSettings(
  tenantCode: string,
  area: string,
  action: string,
  oldValue: unknown,
  newValue: unknown,
  actor: { userId: string | null; name: string | null },
): Promise<void> {
  await supabaseAdmin.from("settings_audit_log").insert({
    tenant_code: tenantCode,
    area,
    action,
    old_value: (oldValue ?? null) as never,
    new_value: (newValue ?? null) as never,
    performed_by_user_id: actor.userId,
    performed_by_name: actor.name,
  });
}

export { DEFAULT_TENANT_SETTINGS };
