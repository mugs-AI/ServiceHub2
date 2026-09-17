// WP2C — On-Site GPS Attendance: pure, environment-free rules.
//
// This module is deliberately separate from the legacy Field Operations logic
// in ./field-ops.ts (which stays frozen and unmounted). Nothing here touches
// Travel / Arrival / Leave Site / Work Sessions / Waiting.

export const ATTENDANCE_BLOCKED_STATUSES = ["Completed", "Cancelled", "Pending Approval"] as const;

export type GpsResultCode =
  | "ok"
  | "low_accuracy"
  | "permission_denied"
  | "timeout"
  | "unavailable"
  | "unsupported";

/** Accuracy worse than this is still stored, but flagged to the user. */
export const LOW_ACCURACY_THRESHOLD_M = 200;

export interface AttendanceJobLike {
  status: string;
  is_deleted: boolean;
}

/** Null when attendance is allowed, otherwise the user-facing reason. */
export function attendanceBlockedReason(job: AttendanceJobLike): string | null {
  if (job.is_deleted) return "This Job is deleted.";
  if ((ATTENDANCE_BLOCKED_STATUSES as readonly string[]).includes(job.status)) {
    return `On-site attendance is not available while the Job is ${job.status}.`;
  }
  return null;
}

/** Map a browser GeolocationPositionError code to our stored result code. */
export function gpsResultFromError(err: { code?: number } | null | undefined): GpsResultCode {
  switch (err?.code) {
    case 1:
      return "permission_denied";
    case 2:
      return "unavailable";
    case 3:
      return "timeout";
    default:
      return "unavailable";
  }
}

export const GPS_ERROR_MESSAGE: Record<GpsResultCode, string> = {
  ok: "GPS captured",
  low_accuracy: "Location captured but accuracy is poor",
  permission_denied: "Location permission was denied in this browser.",
  timeout: "Getting your location timed out.",
  unavailable: "Location is currently unavailable on this device.",
  unsupported: "This browser does not support location.",
};

export interface AttendanceCapture {
  gps_result: GpsResultCode;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  exception_reason?: string | null;
}

export function isLocationCaptured(c: AttendanceCapture): boolean {
  if (c.gps_result !== "ok" && c.gps_result !== "low_accuracy") return false;
  return (
    typeof c.latitude === "number" &&
    Number.isFinite(c.latitude) &&
    typeof c.longitude === "number" &&
    Number.isFinite(c.longitude)
  );
}

/** A missing location may only be committed with a non-empty reason. */
export function validateCapture(c: AttendanceCapture): { ok: true } | { ok: false; error: string } {
  if (isLocationCaptured(c)) return { ok: true };
  if (!String(c.exception_reason ?? "").trim()) {
    return { ok: false, error: "A reason is required when location is not captured." };
  }
  return { ok: true };
}

export const GPS_RESULT_CODES: readonly GpsResultCode[] = [
  "ok",
  "low_accuracy",
  "permission_denied",
  "timeout",
  "unavailable",
  "unsupported",
];

function finiteNumber(v: unknown): number | null {
  // Deliberately strict: null, "", booleans, arrays and objects are NOT
  // coerced to 0 — a bad payload must fail, never silently record 0°/0 m.
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Strict validation of a browser-supplied GPS payload. Returns the normalised
 * capture or a user-facing 400 reason. The server never trusts these values
 * for identity, only for evidence, and stores nothing it cannot validate.
 */
export function parseCapturePayload(
  body: Record<string, unknown>,
): { ok: true; capture: Required<AttendanceCapture> } | { ok: false; error: string } {
  const raw = body.gps_result;
  if (typeof raw !== "string" || !(GPS_RESULT_CODES as readonly string[]).includes(raw)) {
    return { ok: false, error: "Unknown GPS result code." };
  }
  const gps_result = raw as GpsResultCode;
  const exception_reason =
    typeof body.exception_reason === "string" ? body.exception_reason.trim().slice(0, 500) : "";

  const successful = gps_result === "ok" || gps_result === "low_accuracy";
  if (!successful) {
    // Failure codes never carry a captured position, whatever was posted.
    if (!exception_reason) {
      return { ok: false, error: "A reason is required when location is not captured." };
    }
    return {
      ok: true,
      capture: { gps_result, latitude: null, longitude: null, accuracy: null, exception_reason },
    };
  }

  const latitude = finiteNumber(body.latitude);
  const longitude = finiteNumber(body.longitude);
  if (latitude === null || longitude === null) {
    return { ok: false, error: "Latitude and longitude are required for a captured location." };
  }
  if (latitude < -90 || latitude > 90) return { ok: false, error: "Latitude is out of range." };
  if (longitude < -180 || longitude > 180) {
    return { ok: false, error: "Longitude is out of range." };
  }
  const accuracy = finiteNumber(body.accuracy);
  if (accuracy === null || accuracy < 0) {
    return { ok: false, error: "A valid accuracy value is required for a captured location." };
  }
  return { ok: true, capture: { gps_result, latitude, longitude, accuracy, exception_reason } };
}

/**
 * Difference between the server clock and this device's clock. Server
 * timestamps stay authoritative even when the phone clock is wrong.
 */
export function serverClockOffsetMs(serverNowIso: string, clientNowMs: number): number {
  const t = Date.parse(serverNowIso);
  return Number.isFinite(t) ? t - clientNowMs : 0;
}

/** Elapsed milliseconds since a server timestamp, measured on server time. */
export function serverAlignedElapsedMs(
  startIso: string,
  offsetMs: number,
  clientNowMs: number,
): number {
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, clientNowMs + offsetMs - start);
}


export interface AttendanceVisit {
  id: string;
  service_job_id: string;
  actor_user_id: string;
  actor_name_snapshot: string | null;
  clock_in_at: string;
  clock_out_at: string | null;
  duration_minutes: number | null;
  clock_in_latitude: number | null;
  clock_in_longitude: number | null;
  clock_in_accuracy_m: number | null;
  clock_in_gps_result: string | null;
  clock_in_exception_reason: string | null;
  clock_out_latitude: number | null;
  clock_out_longitude: number | null;
  clock_out_accuracy_m: number | null;
  clock_out_gps_result: string | null;
  clock_out_exception_reason: string | null;
  has_gps_exception: boolean;
}

export interface AttendanceViewer {
  actorUserId: string | null;
  isAdmin: boolean;
  assignedUserId: string | null;
}

/** Owner/Admin and the current Primary PIC may see every visit on the Job. */
export function canViewAllVisits(v: AttendanceViewer): boolean {
  if (v.isAdmin) return true;
  return !!v.actorUserId && v.actorUserId === v.assignedUserId;
}

/**
 * Ordinary teammates only ever receive their own visits — other people's
 * coordinates and exception reasons never leave the server for them.
 */
export function visibleVisits<T extends AttendanceVisit>(rows: T[], v: AttendanceViewer): T[] {
  if (canViewAllVisits(v)) return rows;
  if (!v.actorUserId) return [];
  return rows.filter((r) => r.actor_user_id === v.actorUserId);
}

export interface ActorAttendanceState {
  openVisit: AttendanceVisit | null;
  /** Open session on some OTHER Job (tenant-wide single-open invariant). */
  lastCompleted: AttendanceVisit | null;
  visitCount: number;
}

export function actorState(
  rows: AttendanceVisit[],
  actorUserId: string | null,
): ActorAttendanceState {
  const mine = actorUserId ? rows.filter((r) => r.actor_user_id === actorUserId) : [];
  const open = mine.find((r) => !r.clock_out_at) ?? null;
  const closed = mine
    .filter((r) => !!r.clock_out_at)
    .sort((a, b) => (a.clock_out_at! < b.clock_out_at! ? 1 : -1));
  return { openVisit: open, lastCompleted: closed[0] ?? null, visitCount: mine.length };
}

/** hh:mm:ss elapsed, never negative. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** "GPS captured · ±25 m" or a clearly flagged exception. */
export function gpsSummary(
  result: string | null | undefined,
  accuracy: number | null | undefined,
): string {
  const acc = Number.isFinite(Number(accuracy)) ? ` · ±${Math.round(Number(accuracy))} m` : "";
  if (result === "ok") return `GPS captured${acc}`;
  if (result === "low_accuracy") return `GPS captured (low accuracy)${acc}`;
  if (!result) return "No GPS recorded";
  return `GPS exception · ${GPS_ERROR_MESSAGE[result as GpsResultCode] ?? result}`;
}
