import type { InquiryPermission } from "./permissions";
import { isValidIsoDate, malaysiaTodayIso } from "@/lib/qne/malaysia-date";
import { formatMYDateTime } from "@/lib/format-date";

export const JOB_STATUSES = [
  "Draft",
  "Pending Approval",
  "Open",
  "Assigned",
  "In Progress",
  "Waiting Customer",
  "Waiting Vendor",
  "Completed",
  "Cancelled",
];
export const JOB_PRIORITIES = ["High", "Medium", "Low"];
export const JOB_PAGE_SIZES = [20, 50, 100] as const;
export const JOB_EXPORT_LIMIT = 10000;
export interface JobColumn {
  key: string;
  label: string;
  kind?: "datetime" | "date" | "number";
  choices?: string[];
  sensitive?: "private" | "gps";
  default?: boolean;
  noFilter?: boolean;
}
export const JOB_COLUMNS: readonly JobColumn[] = [
  { key: "job_number", label: "Job No.", default: true },
  { key: "customer_code_snapshot", label: "Customer Code", default: true },
  { key: "customer_name_snapshot", label: "Customer", default: true },
  { key: "subject", label: "Subject", default: true },
  { key: "status", label: "Status", choices: JOB_STATUSES, default: true },
  { key: "priority", label: "Priority", choices: JOB_PRIORITIES, default: true },
  { key: "assigned_user_name_snapshot", label: "Primary PIC", default: true },
  { key: "created_at", label: "Created", kind: "datetime", default: true },
  { key: "scheduled_start_at", label: "Scheduled", kind: "datetime", default: true },
  { key: "completed_at", label: "Completed", kind: "datetime" },
  { key: "source", label: "Source" },
  { key: "support_mode", label: "Support Mode" },
  { key: "subscription_category_snapshot", label: "Category" },
  { key: "stock_code_snapshot", label: "Stock Code" },
  { key: "entitlement_expiry_snapshot", label: "Entitlement Expiry", kind: "date" },
  { key: "entitlement_status_snapshot", label: "Entitlement Status" },
  { key: "created_by_name", label: "Created By" },
  { key: "latest_customer_ref_no", label: "Customer Ref." },
  { key: "latest_vendor_ref_no", label: "Vendor Ref." },
  { key: "total_work_minutes", label: "Work Minutes", kind: "number" },
  { key: "problem_description", label: "Problem" },
  { key: "service_address", label: "Service Address" },
  { key: "internal_note", label: "Internal Note", sensitive: "private" },
  { key: "approval_remark_private", label: "Private Approval Note", sensitive: "private" },
  {
    key: "clock_in_at",
    label: "Latest Clock In",
    kind: "datetime",
    sensitive: "gps",
    noFilter: true,
  },
  {
    key: "clock_out_at",
    label: "Latest Clock Out",
    kind: "datetime",
    sensitive: "gps",
    noFilter: true,
  },
  {
    key: "clock_in_latitude",
    label: "Clock In Latitude",
    kind: "number",
    sensitive: "gps",
    noFilter: true,
  },
  {
    key: "clock_in_longitude",
    label: "Clock In Longitude",
    kind: "number",
    sensitive: "gps",
    noFilter: true,
  },
  {
    key: "clock_out_latitude",
    label: "Clock Out Latitude",
    kind: "number",
    sensitive: "gps",
    noFilter: true,
  },
  {
    key: "clock_out_longitude",
    label: "Clock Out Longitude",
    kind: "number",
    sensitive: "gps",
    noFilter: true,
  },
];
export type JobInquiryRow = Record<string, string | number | null> & { id: string };
export interface JobDetailsQuery {
  q: string;
  from: string;
  to: string;
  dateField: "created_at" | "completed_at" | "scheduled_start_at";
  filters: Record<string, string>;
  page: number;
  pageSize: number;
  sort: string;
  direction: "asc" | "desc";
}
export class InquiryInputError extends Error {
  readonly status = 400;
}
export function availableJobColumns(access: InquiryPermission): JobColumn[] {
  return JOB_COLUMNS.filter(
    (c) =>
      !c.sensitive || (c.sensitive === "private" ? access.view_private_notes : access.view_gps),
  );
}
export function defaultJobRange(now = new Date()): { from: string; to: string } {
  const to = malaysiaTodayIso(now);
  const start = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 2);
  return { from: start.toISOString().slice(0, 10), to };
}
function integer(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1 ||
    Number(value) > 1000000
  )
    throw new InquiryInputError("Invalid page.");
  return Number(value);
}
function checkRange(from: string, to: string): void {
  if ((from && !isValidIsoDate(from)) || (to && !isValidIsoDate(to)))
    throw new InquiryInputError("Enter a valid date.");
  if (from && to && from > to)
    throw new InquiryInputError("From date must be on or before To date.");
}
export function parseJobDetailsQuery(
  params: URLSearchParams,
  access: InquiryPermission,
  now = new Date(),
): JobDetailsQuery {
  const range = defaultJobRange(now),
    from = (params.get("from") ?? range.from).trim(),
    to = (params.get("to") ?? range.to).trim();
  checkRange(from, to);
  const dateField = params.get("dateField") ?? "created_at";
  if (!["created_at", "completed_at", "scheduled_start_at"].includes(dateField))
    throw new InquiryInputError("Invalid date field.");
  const allowed = availableJobColumns(access).filter((c) => !c.noFilter),
    sort = params.get("sort") ?? "created_at",
    direction = params.get("direction") ?? "desc";
  if (!allowed.some((c) => c.key === sort) || !["asc", "desc"].includes(direction))
    throw new InquiryInputError("Invalid sort.");
  const page = integer(params.get("page"), 1),
    pageSize = integer(params.get("pageSize"), 20);
  if (!(JOB_PAGE_SIZES as readonly number[]).includes(pageSize))
    throw new InquiryInputError("Choose 20, 50 or 100 rows.");
  const q = (params.get("q") ?? "").trim();
  if (q.length > 160) throw new InquiryInputError("Search is too long.");
  if (q.includes("*"))
    throw new InquiryInputError("Asterisks are not supported in search or text filters.");
  const serialized = params.get("filters") ?? "{}";
  if (serialized.length > 8000) throw new InquiryInputError("Too many filters.");
  let input: unknown;
  try {
    input = JSON.parse(serialized);
  } catch {
    throw new InquiryInputError("Invalid filters.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new InquiryInputError("Invalid filters.");
  const filters: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    const base = key.replace(/__(from|to)$/, ""),
      col = allowed.find((c) => c.key === base);
    if (!col || typeof raw !== "string" || raw.length > 160)
      throw new InquiryInputError("Invalid column filter.");
    const value = raw.trim();
    if (!value) continue;
    if (col.kind === "datetime" || col.kind === "date") {
      if (key === base || !isValidIsoDate(value))
        throw new InquiryInputError("Invalid date filter.");
    } else if (key !== base) throw new InquiryInputError("Invalid column filter.");
    if (
      col.kind === "number" &&
      (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647)
    )
      throw new InquiryInputError("Enter whole Work Minutes from 0 to 2,147,483,647.");
    if (!col.kind && !col.choices && value.includes("*"))
      throw new InquiryInputError("Asterisks are not supported in search or text filters.");
    if (col.choices && !col.choices.includes(value))
      throw new InquiryInputError("Invalid column value.");
    filters[key] = value;
  }
  for (const col of allowed.filter((c) => c.kind === "datetime" || c.kind === "date"))
    checkRange(filters[`${col.key}__from`] ?? "", filters[`${col.key}__to`] ?? "");
  return {
    q,
    from,
    to,
    dateField: dateField as JobDetailsQuery["dateField"],
    filters,
    page,
    pageSize,
    sort,
    direction: direction as JobDetailsQuery["direction"],
  };
}
export function jobDetailsParams(query: JobDetailsQuery): URLSearchParams {
  return new URLSearchParams({
    q: query.q,
    from: query.from,
    to: query.to,
    dateField: query.dateField,
    page: String(query.page),
    pageSize: String(query.pageSize),
    sort: query.sort,
    direction: query.direction,
    filters: JSON.stringify(query.filters),
  });
}
export function projectJobRow(
  raw: Record<string, unknown>,
  access: InquiryPermission,
): JobInquiryRow {
  const result: JobInquiryRow = { id: String(raw.id ?? "") };
  for (const c of availableJobColumns(access)) {
    const v = raw[c.key];
    result[c.key] = typeof v === "string" || typeof v === "number" ? v : null;
  }
  return result;
}
export function jobCellValue(row: JobInquiryRow, col: JobColumn): string | number {
  const value = row[col.key];
  if (value === null || value === undefined || value === "") return "";
  if (col.kind === "datetime") return formatMYDateTime(String(value));
  if (col.kind === "date") return String(value).split("-").reverse().join("/");
  return value;
}
