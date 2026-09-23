// Malaysian date-entry standard (WP3C UAT correction).
//
// Every user-visible date control in the WP3C/UAT surfaces displays and accepts
// DD/MM/YYYY, while the value carried in query state and sent to APIs stays the
// ISO `yyyy-mm-dd` the server already expects. Stored UTC timestamps and API
// contracts are untouched — this is a presentation/entry layer only.

const MY_OFFSET_MS = 8 * 60 * 60 * 1000;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Accepts d/m/yyyy, dd/mm/yyyy and the same with `-` or `.` separators.
const DISPLAY_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Is this a real calendar day in ISO `yyyy-mm-dd` form? */
export function isValidIsoDate(value: string | null | undefined): boolean {
  const m = ISO_RE.exec((value ?? "").trim());
  if (!m) return false;
  return isRealDate(Number(m[3]), Number(m[2]), Number(m[1]));
}

function isRealDate(d: number, mo: number, y: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1000 || y > 9999) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/**
 * Parse a user-typed Malaysian date into ISO `yyyy-mm-dd`.
 * Returns `null` for anything that is not a real calendar day (31/02/2026,
 * 13/13/2026, partial input, …), and `""` for a deliberately empty field.
 */
export function parseMalaysiaDate(text: string | null | undefined): string | null | "" {
  const raw = (text ?? "").trim();
  if (raw === "") return "";
  const m = DISPLAY_RE.exec(raw);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (!isRealDate(d, mo, y)) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** ISO `yyyy-mm-dd` -> `dd/mm/yyyy` (empty-safe, invalid-safe). */
export function formatMalaysiaDate(iso: string | null | undefined): string {
  const m = ISO_RE.exec((iso ?? "").trim());
  if (!m || !isValidIsoDate(iso)) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Today's Malaysia calendar day as ISO `yyyy-mm-dd`. */
export function malaysiaTodayIso(now: Date = new Date()): string {
  const my = new Date(now.getTime() + MY_OFFSET_MS);
  return `${my.getUTCFullYear()}-${pad(my.getUTCMonth() + 1)}-${pad(my.getUTCDate())}`;
}

/** First day of the current Malaysia month — where a fresh calendar opens. */
export function malaysiaCurrentMonthStartIso(now: Date = new Date()): string {
  return `${malaysiaTodayIso(now).slice(0, 7)}-01`;
}

/** Placeholder shown in every Malaysian date field. */
export const MALAYSIA_DATE_PLACEHOLDER = "dd/mm/yyyy";
