// Pure, client-safe Malaysia-calendar range arithmetic for the Day / Week /
// Month calendar views.
//
// All helpers operate on `yyyy-mm-dd` Malaysia calendar day keys. No UTC
// conversion happens here — the calendar API converts a Malaysia day range to
// UTC instants server-side (see /api/workspace/calendar). Keeping this module
// timezone-free is what makes Day, Week and Month agree with each other.

export type CalendarView = "day" | "week" | "month";

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(dayKey: string): { y: number; m: number; d: number } | null {
  const m = DAY_RE.exec((dayKey ?? "").trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fromParts(y: number, mo0: number, d: number): string {
  const ms = Date.UTC(y, mo0, d);
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Days since epoch for a Malaysia calendar day key (calendar arithmetic only). */
export function dayIndex(dayKey: string): number {
  const p = parse(dayKey);
  if (!p) return 0;
  return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayMondayIndex(dayKey: string): number {
  const p = parse(dayKey);
  if (!p) return 0;
  const js = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 = Sunday
  return (js + 6) % 7;
}

/** Shift a day key by N calendar days. */
export function addDays(dayKey: string, days: number): string {
  const p = parse(dayKey);
  if (!p) return dayKey;
  return fromParts(p.y, p.m - 1, p.d + days);
}

/** Monday of the week containing `dayKey`. */
export function startOfWeek(dayKey: string): string {
  return addDays(dayKey, -weekdayMondayIndex(dayKey));
}

/** Sunday of the week containing `dayKey`. */
export function endOfWeek(dayKey: string): string {
  return addDays(startOfWeek(dayKey), 6);
}

/** Shift by whole weeks, keeping the same weekday. */
export function shiftWeek(dayKey: string, weeks: number): string {
  return addDays(dayKey, weeks * 7);
}

/** First day of the month containing `dayKey`. */
export function startOfMonth(dayKey: string): string {
  const p = parse(dayKey);
  if (!p) return dayKey;
  return fromParts(p.y, p.m - 1, 1);
}

/** Last day of the month containing `dayKey` (leap-year safe). */
export function endOfMonth(dayKey: string): string {
  const p = parse(dayKey);
  if (!p) return dayKey;
  return fromParts(p.y, p.m, 0);
}

/** Number of days in the month containing `dayKey`. */
export function daysInMonth(dayKey: string): number {
  const p = parse(dayKey);
  if (!p) return 0;
  return new Date(Date.UTC(p.y, p.m, 0)).getUTCDate();
}

/** Shift by whole months, clamping the day-of-month (31 Jan -1m -> 31 Dec). */
export function shiftMonth(dayKey: string, months: number): string {
  const p = parse(dayKey);
  if (!p) return dayKey;
  const targetFirst = fromParts(p.y, p.m - 1 + months, 1);
  const max = daysInMonth(targetFirst);
  const t = parse(targetFirst)!;
  return fromParts(t.y, t.m - 1, Math.min(p.d, max));
}

/** Inclusive list of day keys from `from` to `to`. */
export function enumerateDays(from: string, to: string): string[] {
  const out: string[] = [];
  const span = dayIndex(to) - dayIndex(from);
  if (span < 0 || span > 400) return out;
  for (let i = 0; i <= span; i++) out.push(addDays(from, i));
  return out;
}

/**
 * Monday-first grid covering the whole month, padded with leading/trailing
 * days from the neighbouring months so every row has exactly 7 cells.
 */
export function monthGridDays(dayKey: string): string[] {
  const first = startOfMonth(dayKey);
  const last = endOfMonth(dayKey);
  return enumerateDays(startOfWeek(first), endOfWeek(last));
}

/** Inclusive Malaysia day range the calendar API should be asked for. */
export function rangeForView(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === "week") return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
  if (view === "month") {
    // The month view renders a padded Monday-first grid, so fetch the padded
    // range — otherwise the outside-month cells would silently lie.
    const grid = monthGridDays(anchor);
    return { from: grid[0]!, to: grid[grid.length - 1]! };
  }
  return { from: anchor, to: anchor };
}

/** Prev/Next step for the active view. */
export function shiftForView(view: CalendarView, anchor: string, direction: -1 | 1): string {
  if (view === "week") return shiftWeek(anchor, direction);
  if (view === "month") return shiftMonth(anchor, direction);
  return addDays(anchor, direction);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** `dd/mm/yyyy`. */
export function displayDay(dayKey: string): string {
  const p = parse(dayKey);
  return p ? `${pad(p.d)}/${pad(p.m)}/${p.y}` : "—";
}

/** e.g. `18 Aug – 24 Aug 2026`. */
export function weekLabel(dayKey: string): string {
  const a = parse(startOfWeek(dayKey));
  const b = parse(endOfWeek(dayKey));
  if (!a || !b) return "—";
  const short = (n: number) => MONTHS[n - 1]!.slice(0, 3);
  const left = `${a.d} ${short(a.m)}${a.y !== b.y ? ` ${a.y}` : ""}`;
  return `${left} – ${b.d} ${short(b.m)} ${b.y}`;
}

/** e.g. `August 2026`. */
export function monthLabel(dayKey: string): string {
  const p = parse(dayKey);
  return p ? `${MONTHS[p.m - 1]} ${p.y}` : "—";
}

/** Long weekday + date heading, e.g. `Tue, 18 Aug 2026`. */
export function dayHeading(dayKey: string): string {
  const p = parse(dayKey);
  if (!p) return "—";
  const wd = WEEKDAY_SHORT[weekdayMondayIndex(dayKey)];
  return `${wd}, ${p.d} ${MONTHS[p.m - 1]!.slice(0, 3)} ${p.y}`;
}

/** Is `dayKey` inside the month containing `anchor`? */
export function isSameMonth(dayKey: string, anchor: string): boolean {
  return dayKey.slice(0, 7) === anchor.slice(0, 7);
}
