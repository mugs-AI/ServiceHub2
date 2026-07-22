// Shared Malaysia date/time formatting.
//
// All user-facing dates in the app MUST use these helpers so we present a
// single, consistent locale (Malaysia — Asia/Kuala_Lumpur, dd/mm/yyyy).
// Database timestamps remain ISO/UTC; this is a presentation-only layer.

const TZ = "Asia/Kuala_Lumpur";

function toDate(input: string | Date | null | undefined): Date | null {
  if (input == null || input === "") return null;
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** dd/mm/yyyy — e.g. 19/07/2026 */
export function formatMY(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** dd/mm/yyyy, hh:mm AM/PM — e.g. 19/07/2026, 08:26 PM */
export function formatMYDateTime(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "";
  const date = formatMY(d);
  // en-US gives 12-hour with uppercase AM/PM.
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `${date}, ${time}`;
}
