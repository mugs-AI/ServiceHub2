import {
  availableJobColumns,
  jobDetailsParams,
  parseJobDetailsQuery,
  type JobColumn,
  type JobDetailsQuery,
} from "./job-details";
import type { InquiryPermission } from "./permissions";

export interface InquiryIdentity {
  tenantCode: string;
  userId: string;
}
export interface InquiryPreferences {
  version: 1;
  draft: JobDetailsQuery;
  applied: JobDetailsQuery;
  selectedColumns: string[];
  columnOrder: string[];
}
export function inquiryPreferenceKey(identity: InquiryIdentity): string {
  return `sh2:inquiry:job-details:v1:${encodeURIComponent(JSON.stringify([identity.tenantCode, identity.userId]))}`;
}
function object(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}
function cleanQuery(raw: unknown, access: InquiryPermission, now: Date): JobDetailsQuery {
  const defaults = parseJobDetailsQuery(new URLSearchParams(), access, now),
    input = object(raw);
  const allowed = availableJobColumns(access).filter((c) => !c.noFilter);
  const result = { ...defaults };
  // Validate fields separately so one malformed preference does not discard other controls.
  for (const key of ["q", "dateField", "page", "pageSize", "sort", "direction"] as const) {
    const value = input[key];
    if (typeof value !== "string" && typeof value !== "number") continue;
    try {
      Object.assign(
        result,
        parseJobDetailsQuery(jobDetailsParams({ ...result, [key]: value }), access, now),
      );
    } catch {
      /* retain safe default */
    }
  }
  try {
    Object.assign(
      result,
      parseJobDetailsQuery(
        jobDetailsParams({
          ...result,
          from: typeof input.from === "string" ? input.from : result.from,
          to: typeof input.to === "string" ? input.to : result.to,
        }),
        access,
        now,
      ),
    );
  } catch {
    /* discard malformed date range */
  }
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(object(input.filters))) {
    if (
      typeof value !== "string" ||
      !allowed.some((c) => c.key === key.replace(/__(from|to)$/, ""))
    )
      continue;
    try {
      Object.assign(
        filters,
        parseJobDetailsQuery(
          jobDetailsParams({ ...defaults, filters: { ...filters, [key]: value } }),
          access,
          now,
        ).filters,
      );
    } catch {
      /* discard invalid or denied filter */
    }
  }
  return { ...result, filters };
}
function cleanKeys(raw: unknown, permitted: readonly JobColumn[], fallback: string[]): string[] {
  return Array.isArray(raw)
    ? [
        ...new Set(
          raw.filter(
            (key): key is string => typeof key === "string" && permitted.some((c) => c.key === key),
          ),
        ),
      ]
    : fallback;
}
export function normalizeInquiryPreferences(
  raw: unknown,
  access: InquiryPermission,
  now = new Date(),
): InquiryPreferences {
  const record = object(raw),
    input = record.version === 1 ? record : {};
  const permitted = availableJobColumns(access),
    keys = permitted.map((c) => c.key);
  const order = cleanKeys(input.columnOrder, permitted, keys);
  return {
    version: 1,
    draft: cleanQuery(input.draft, access, now),
    applied: cleanQuery(input.applied, access, now),
    selectedColumns: cleanKeys(
      input.selectedColumns,
      permitted,
      permitted.filter((c) => c.default).map((c) => c.key),
    ),
    columnOrder: [...order, ...keys.filter((key) => !order.includes(key))],
  };
}
export function loadInquiryPreferences(
  storage: Pick<Storage, "getItem">,
  identity: InquiryIdentity,
  access: InquiryPermission,
  now = new Date(),
): InquiryPreferences {
  try {
    return normalizeInquiryPreferences(
      JSON.parse(storage.getItem(inquiryPreferenceKey(identity)) ?? "null"),
      access,
      now,
    );
  } catch {
    return normalizeInquiryPreferences(null, access, now);
  }
}
export function saveInquiryPreferences(
  storage: Pick<Storage, "setItem">,
  identity: InquiryIdentity,
  value: InquiryPreferences,
): void {
  try {
    storage.setItem(
      inquiryPreferenceKey(identity),
      JSON.stringify({
        version: 1,
        draft: value.draft,
        applied: value.applied,
        selectedColumns: value.selectedColumns,
        columnOrder: value.columnOrder,
      }),
    );
  } catch {
    /* Preferences remain usable when browser storage is unavailable. */
  }
}
export function orderedJobColumns(
  access: InquiryPermission,
  selected: readonly string[],
  order: readonly string[],
): JobColumn[] {
  const permitted = availableJobColumns(access),
    keys = [...new Set([...order, ...permitted.map((c) => c.key)])];
  return keys.flatMap((key) => {
    const col = permitted.find((c) => c.key === key);
    return col && selected.includes(key) ? [col] : [];
  });
}
