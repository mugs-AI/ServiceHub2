// WP4 — SERVER-ONLY inquiry permission resolver / guard for future WP5.
// Takes the verified authenticated user (tenant + Owner/Admin derived from
// N3 isOwner) and resolves one of the two inquiry keys. Tenant is never read
// from browser input.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ForbiddenError, type CurrentUserContext } from "@/lib/qne/session/current-user.server";
import {
  INQUIRY_KEYS,
  NORMAL_USER_ROLE,
  isInquiryKey,
  resolveInquiryAccess,
  type InquiryCapability,
  type InquiryKey,
  type InquiryPermission,
  type StoredInquiryRow,
} from "./permissions";

const COLUMNS =
  "report_code, role, can_view, can_export_excel, data_scope, view_private_notes, view_gps";

export async function loadInquiryRows(tenantCode: string): Promise<StoredInquiryRow[]> {
  if (!tenantCode) throw new ForbiddenError();
  const { data, error } = await supabaseAdmin
    .from("report_role_permissions")
    .select(COLUMNS)
    .eq("tenant_code", tenantCode)
    .eq("role", NORMAL_USER_ROLE)
    .in("report_code", [...INQUIRY_KEYS]);
  if (error) throw error;
  return (data ?? []) as StoredInquiryRow[];
}

export async function resolveInquiryAccessForUser(
  user: Pick<CurrentUserContext, "tenantCode" | "isAdministrator">,
  key: InquiryKey,
): Promise<InquiryPermission> {
  if (!isInquiryKey(key)) throw new ForbiddenError();
  if (user.isAdministrator) return resolveInquiryAccess({ isOwnerAdmin: true }, null);
  const rows = await loadInquiryRows(user.tenantCode);
  return resolveInquiryAccess(
    { isOwnerAdmin: false },
    rows.find((r) => r.report_code === key),
  );
}

/** Throw ForbiddenError unless the verified user holds the capability. */
export async function requireInquiryAccess(
  user: Pick<CurrentUserContext, "tenantCode" | "isAdministrator">,
  key: InquiryKey,
  capability: InquiryCapability = "can_view",
): Promise<InquiryPermission> {
  const access = await resolveInquiryAccessForUser(user, key);
  if (!access.can_view || !access[capability]) throw new ForbiddenError();
  return access;
}
