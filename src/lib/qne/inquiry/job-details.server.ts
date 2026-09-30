import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ForbiddenError } from "@/lib/qne/session/current-user.server";
import type { InquiryPermission } from "./permissions";
import {
  availableJobColumns,
  JOB_EXPORT_LIMIT,
  InquiryInputError,
  projectJobRow,
  type JobDetailsQuery,
  type JobInquiryRow,
} from "./job-details";

export interface InquiryActor {
  tenantCode: string;
  userId: string | null;
}
export interface JobDetailsPage {
  rows: JobInquiryRow[];
  total: number;
  page: number;
  pageSize: number;
  access: InquiryPermission;
}
const GPS_RELATION = "service_job_onsite_attendance";
function dayStart(day: string): string {
  return new Date(`${day}T00:00:00+08:00`).toISOString();
}
function nextDay(day: string): string {
  return new Date(new Date(`${day}T00:00:00+08:00`).getTime() + 86400000).toISOString();
}
function literalLike(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}
function quotedLike(value: string): string {
  return `"${literalLike(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Server-derived tenant and immutable N3 user only. List and export use this same read. */
export async function queryJobDetails(
  db: SupabaseClient<Database>,
  actor: InquiryActor,
  access: InquiryPermission,
  input: JobDetailsQuery,
  exporting = false,
): Promise<JobDetailsPage> {
  if (
    !actor.tenantCode ||
    !access.can_view ||
    (exporting && !access.can_export_excel) ||
    (access.scope === "own" && !actor.userId)
  )
    throw new ForbiddenError("Inquiry access is not available.");
  const columns = availableJobColumns(access),
    main = columns.filter((c) => c.sensitive !== "gps").map((c) => c.key),
    gps = columns.filter((c) => c.sensitive === "gps").map((c) => c.key);
  const selection = [
    "id",
    ...main,
    ...(gps.length ? [`${GPS_RELATION}(${gps.join(",")})`] : []),
  ].join(",");
  let query = db
    .from("service_jobs")
    .select(selection, { count: "exact" })
    .eq("tenant_code", actor.tenantCode)
    .eq("is_deleted", false);
  if (access.scope === "own") query = query.eq("assigned_user_id", actor.userId!);
  if (input.from) query = query.gte(input.dateField, dayStart(input.from));
  if (input.to) query = query.lt(input.dateField, nextDay(input.to));
  if (input.q) {
    const p = quotedLike(input.q);
    query = query.or(
      `job_number.ilike.${p},subject.ilike.${p},customer_code_snapshot.ilike.${p},customer_name_snapshot.ilike.${p}`,
    );
  }
  for (const [key, value] of Object.entries(input.filters)) {
    const base = key.replace(/__(from|to)$/, ""),
      col = columns.find((c) => c.key === base && !c.noFilter);
    if (!col) throw new InquiryInputError("Invalid filter.");
    if (key.endsWith("__from"))
      query = query.gte(base, col.kind === "datetime" ? dayStart(value) : value);
    else if (key.endsWith("__to"))
      query = col.kind === "datetime" ? query.lt(base, nextDay(value)) : query.lte(base, value);
    else if (col.choices || col.kind === "number") query = query.eq(base, value);
    else query = query.ilike(base, literalLike(value));
  }
  query = query
    .order(input.sort, { ascending: input.direction === "asc", nullsFirst: false })
    .order("id", { ascending: true });
  if (gps.length)
    query = query
      .eq(`${GPS_RELATION}.tenant_code`, actor.tenantCode)
      .order("clock_in_at", { referencedTable: GPS_RELATION, ascending: false })
      .order("id", { referencedTable: GPS_RELATION, ascending: false })
      .limit(1, { referencedTable: GPS_RELATION });
  const offset = exporting ? 0 : (input.page - 1) * input.pageSize,
    size = exporting ? 500 : input.pageSize;
  const { data, error, count } = await query.range(offset, offset + size - 1);
  if (error) throw error;
  if (count === null) throw new Error("Inquiry count is unavailable.");
  if (exporting && count > JOB_EXPORT_LIMIT)
    throw new InquiryInputError("Export is limited to 10,000 Jobs. Narrow your filters.");
  let all = (data ?? []) as unknown as Record<string, unknown>[];
  if (exporting) {
    while (all.length < count) {
      const {
        data: next,
        error: nextError,
        count: nextCount,
      } = await query.range(all.length, Math.min(all.length + 499, count - 1));
      if (nextError) throw nextError;
      if (nextCount !== count || !next?.length)
        throw new Error("Jobs changed during export. Please refresh and try again.");
      all = [...all, ...(next as unknown as Record<string, unknown>[])];
    }
    if (all.length !== count || new Set(all.map((r) => r.id)).size !== count)
      throw new Error("Jobs changed during export. Please refresh and try again.");
  }
  const rows = all.map((raw) => {
    const visits = raw[GPS_RELATION];
    const latest =
      access.view_gps && Array.isArray(visits)
        ? ((visits[0] ?? {}) as Record<string, unknown>)
        : {};
    return projectJobRow({ ...raw, ...latest, id: raw.id }, access);
  });
  return {
    rows,
    total: count,
    page: exporting ? 1 : input.page,
    pageSize: exporting ? count : input.pageSize,
    access,
  };
}
