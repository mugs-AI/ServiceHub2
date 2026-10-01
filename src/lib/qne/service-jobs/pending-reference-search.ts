export interface ReferenceFields {
  latest_customer_ref_no?: string | null;
  latest_vendor_ref_no?: string | null;
}

/** Quote PostgREST values and escape LIKE wildcards without deleting reference punctuation. */
export function pendingReferenceOr(raw: string): string | null {
  const needle = raw
    .trim()
    .slice(0, 100)
    .split("")
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join("")
    .trim();
  if (!needle) return null;
  // PostgREST aliases every asterisk to % for LIKE; use a quoted, escaped
  // regular-expression literal for references containing an asterisk.
  const operator = needle.includes("*") ? "imatch" : "ilike";
  const pattern = JSON.stringify(
    operator === "imatch"
      ? needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      : `%${needle.replace(/[\\%_]/g, "\\$&")}%`,
  );
  return [
    "job_number",
    "subject",
    "customer_name_snapshot",
    "latest_customer_ref_no",
    "latest_vendor_ref_no",
  ]
    .map((column) => `${column}.${operator}.${pattern}`)
    .join(",");
}

export function matchesPendingReference(
  row: ReferenceFields & {
    job_number: string;
    subject: string;
    customer_name?: string | null;
    customer_code?: string | null;
  },
  raw: string,
): boolean {
  const needle = raw.trim().slice(0, 100).toLowerCase();
  return [
    row.job_number,
    row.subject,
    row.customer_name,
    row.customer_code,
    row.latest_customer_ref_no,
    row.latest_vendor_ref_no,
  ].some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
}
