// Pure, client-safe scheduling rules for Service Jobs.
//
// Timezone policy: all appointments are entered and displayed in Malaysia
// time (Asia/Kuala_Lumpur, UTC+8, no DST) but ALWAYS stored as UTC timestamps.

export const SCHEDULE_TZ = "Asia/Kuala_Lumpur";
const MY_OFFSET_MS = 8 * 60 * 60 * 1000;

export type ScheduleAction =
  | "scheduled"
  | "rescheduled"
  | "unscheduled"
  | "conflict_override"
  | "cancelled";

/** Workflow statuses that may hold an appointment. */
export const SCHEDULABLE_STATUSES = [
  "Open",
  "Assigned",
  "In Progress",
  "Waiting Customer",
  "Waiting Vendor",
] as const;

/** Statuses that can never be scheduled. */
export const NON_SCHEDULABLE_STATUSES = [
  "Pending Approval",
  "Completed",
  "Cancelled",
] as const;

export function canScheduleJob(job: {
  status: string;
  is_deleted?: boolean | null;
  assigned_user_id?: string | null;
}): { ok: boolean; reason?: string } {
  if (job.is_deleted) return { ok: false, reason: "Deleted job cannot be scheduled." };
  if (job.status === "Draft") {
    return job.assigned_user_id
      ? { ok: true }
      : { ok: false, reason: "Assign a technician before scheduling this draft." };
  }
  if ((SCHEDULABLE_STATUSES as readonly string[]).includes(job.status)) return { ok: true };
  return { ok: false, reason: `${job.status} jobs cannot be scheduled.` };
}

/** Convert a Malaysia-local `yyyy-mm-ddTHH:mm` value to a UTC ISO string. */
export function myLocalToUtcIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const ms =
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) - MY_OFFSET_MS;
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/** Convert a UTC ISO string to a Malaysia-local `yyyy-mm-ddTHH:mm` value. */
export function utcIsoToMyLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const my = new Date(d.getTime() + MY_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${my.getUTCFullYear()}-${p(my.getUTCMonth() + 1)}-${p(my.getUTCDate())}T${p(my.getUTCHours())}:${p(my.getUTCMinutes())}`;
}

/** `yyyy-mm-dd` for the Malaysia calendar day of an instant (default: now). */
export function myDayKey(at: Date = new Date()): string {
  const my = new Date(at.getTime() + MY_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${my.getUTCFullYear()}-${p(my.getUTCMonth() + 1)}-${p(my.getUTCDate())}`;
}

/** [start, end) UTC ISO range covering a Malaysia calendar day (`yyyy-mm-dd`). */
export function myDayUtcRange(dayKey: string): { fromIso: string; toIso: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey.trim());
  const base = m
    ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - MY_OFFSET_MS
    : Date.UTC(1970, 0, 1);
  return {
    fromIso: new Date(base).toISOString(),
    toIso: new Date(base + 24 * 60 * 60 * 1000).toISOString(),
  };
}

/** Shift a `yyyy-mm-dd` Malaysia day key by N days. */
export function shiftDayKey(dayKey: string, days: number): string {
  const { fromIso } = myDayUtcRange(dayKey);
  return myDayKey(new Date(new Date(fromIso).getTime() + days * 86400000 + MY_OFFSET_MS));
}

/** Malaysia hour (0-23) of a UTC instant. */
export function myHour(iso: string): number {
  return new Date(new Date(iso).getTime() + MY_OFFSET_MS).getUTCHours();
}

export type DayPart = "morning" | "afternoon" | "evening" | "unscheduled";

export function dayPartOf(iso: string | null | undefined): DayPart {
  if (!iso) return "unscheduled";
  const h = myHour(iso);
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

export const DAY_PART_LABEL: Record<DayPart, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  unscheduled: "Unscheduled",
};

/** Half-open interval overlap: [aS,aE) ∩ [bS,bE) ≠ ∅ */
export function intervalsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return (
    new Date(aStart).getTime() < new Date(bEnd).getTime() &&
    new Date(bStart).getTime() < new Date(aEnd).getTime()
  );
}

export interface ScheduleWindowValidation {
  ok: boolean;
  error?: string;
  isPast?: boolean;
}

export function validateWindow(
  startIso: string | null,
  endIso: string | null,
  now: Date = new Date(),
): ScheduleWindowValidation {
  if (!startIso || !endIso) return { ok: false, error: "Start and end date/time are required." };
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return { ok: false, error: "Invalid date/time." };
  if (e <= s) return { ok: false, error: "End time must be after start time." };
  if (e - s > 14 * 24 * 60 * 60 * 1000) {
    return { ok: false, error: "Appointment cannot be longer than 14 days." };
  }
  return { ok: true, isPast: s < now.getTime() };
}

/** "1h 30m" */
export function formatDuration(startIso?: string | null, endIso?: string | null): string {
  if (!startIso || !endIso) return "—";
  const mins = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000,
  );
  if (!Number.isFinite(mins) || mins <= 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/* ------------------------------------------------------------------ *
 * Separate date + time field support (30-minute slots, Malaysia time)
 * ------------------------------------------------------------------ */

export const SLOT_MINUTES = 30;
export const SLOT_START_HOUR = 7; // 07:00 AM
export const SLOT_END_HOUR = 23; // last slot 11:30 PM

/** All selectable `HH:mm` slots in business range, 30-minute increments. */
export const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = SLOT_START_HOUR; h <= SLOT_END_HOUR; h++) {
    for (let m = 0; m < 60; m += SLOT_MINUTES) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

/** "14:30" -> "02:30 PM" */
export function slotLabel(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${m[2]} ${suffix}`;
}

/** Round a `HH:mm` up to the nearest selectable slot (clamped to range). */
export function snapToSlot(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return TIME_SLOTS[0]!;
  const total = Number(m[1]) * 60 + Number(m[2]);
  const snapped = Math.ceil(total / SLOT_MINUTES) * SLOT_MINUTES;
  const first = SLOT_START_HOUR * 60;
  const last = SLOT_END_HOUR * 60 + 30;
  const v = Math.min(Math.max(snapped, first), last);
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

/** Split a Malaysia-local `yyyy-mm-ddTHH:mm` into date + snapped time parts. */
export function splitLocal(local: string): { date: string; time: string } {
  if (!local) return { date: "", time: "" };
  return { date: local.slice(0, 10), time: snapToSlot(local.slice(11, 16)) };
}

export function joinLocal(date: string, time: string): string {
  return date && time ? `${date}T${time}` : "";
}

/** Add minutes to a Malaysia-local date/time pair, rolling the date over. */
export function addMinutesLocal(
  date: string,
  time: string,
  minutes: number,
): { date: string; time: string } {
  const iso = myLocalToUtcIso(joinLocal(date, time));
  if (!iso) return { date, time };
  const next = utcIsoToMyLocal(new Date(new Date(iso).getTime() + minutes * 60000).toISOString());
  return splitLocal(next);
}

/** Malaysia-local minutes between two date/time pairs. */
export function minutesBetweenLocal(
  aDate: string,
  aTime: string,
  bDate: string,
  bTime: string,
): number | null {
  const a = myLocalToUtcIso(joinLocal(aDate, aTime));
  const b = myLocalToUtcIso(joinLocal(bDate, bTime));
  if (!a || !b) return null;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

/** Next 30-minute slot from now, in Malaysia time. */
export function nextSlotNow(now: Date = new Date()): { date: string; time: string } {
  const local = utcIsoToMyLocal(now.toISOString());
  const { date, time } = splitLocal(local);
  // If "now" is past the last slot of the day, move to the first slot tomorrow.
  const raw = local.slice(11, 16);
  const total = Number(raw.slice(0, 2)) * 60 + Number(raw.slice(3, 5));
  if (total > SLOT_END_HOUR * 60 + 30) return { date: shiftDayKey(date, 1), time: TIME_SLOTS[0]! };
  if (total < SLOT_START_HOUR * 60) return { date, time: TIME_SLOTS[0]! };
  return { date, time };
}

/** `yyyy-mm-dd` -> `dd/mm/yyyy` (empty-safe). */
export function toDisplayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}
