// WP2C — compact, mobile-first "On-Site Attendance" card.
//
// This is NOT the legacy Field Operations workflow (which stays unmounted):
// it records only GPS Clock In and GPS Clock Out for the signed-in employee.
// Location is captured at those two moments only — never continuously.
//
// Every rule shown here is re-checked on the server: hiding a control is
// convenience, not authorisation, and the actor is always the authenticated
// session user.

import { useCallback, useEffect, useRef, useState } from "react";

import { formatMYDateTime } from "@/lib/format-date";
import {
  GPS_ERROR_MESSAGE,
  LOW_ACCURACY_THRESHOLD_M,
  formatElapsed,
  gpsResultFromError,
  gpsSummary,
  serverAlignedElapsedMs,
  serverClockOffsetMs,
} from "@/lib/qne/service-jobs/onsite-attendance";
import {
  hasMapAction,
  isAndroidDevice,
  isAppleMapsDevice,
  mapChoicesForPoint,
  sharePayload,
} from "@/lib/qne/service-jobs/attendance-map";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { AttendanceVisit, GpsResultCode } from "@/lib/qne/service-jobs/onsite-attendance";
import type { AttendanceMapPoint, MapDevice } from "@/lib/qne/service-jobs/attendance-map";
import { getStoredToken } from "@/lib/qne/tokens";

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface AttendanceState {
  jobNumber: string;
  blockedReason: string | null;
  canAct: boolean;
  canViewAll: boolean;
  visits: AttendanceVisit[];
  openVisit: AttendanceVisit | null;
  lastCompleted: AttendanceVisit | null;
  openOnOtherJob: { jobNumber: string | null } | null;
  serverNow: string;
}

interface Capture {
  gps_result: GpsResultCode;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
}

function currentDeviceUsesAppleMaps(): boolean {
  if (typeof navigator === "undefined") return false;
  return isAppleMapsDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
}

function MapAction({ label, point }: { label: "Map In" | "Map Out"; point: AttendanceMapPoint }) {
  const href = mapUrlForPoint(point, currentDeviceUsesAppleMaps());
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} in maps`}
      className="inline-flex min-h-10 items-center justify-center rounded-md border bg-card px-3 text-xs font-semibold text-foreground hover:bg-accent"
    >
      {label}
    </a>
  );
}

function capturePosition(): Promise<Capture> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({
      gps_result: "unsupported",
      latitude: null,
      longitude: null,
      accuracy: null,
    });
  }
  return new Promise<Capture>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const acc = pos.coords.accuracy;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const usable =
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          Number.isFinite(acc) &&
          acc >= 0 &&
          lat >= -90 &&
          lat <= 90 &&
          lng >= -180 &&
          lng <= 180;
        if (!usable) {
          // Accuracy evidence is part of the product — an unusable reading is
          // an exception, not a silent zero.
          resolve({
            gps_result: "unavailable",
            latitude: null,
            longitude: null,
            accuracy: null,
          });
          return;
        }
        resolve({
          gps_result: acc > LOW_ACCURACY_THRESHOLD_M ? "low_accuracy" : "ok",
          latitude: lat,
          longitude: lng,
          accuracy: acc,
        });
      },

      (err) =>
        resolve({
          gps_result: gpsResultFromError(err),
          latitude: null,
          longitude: null,
          accuracy: null,
        }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

export function OnSiteAttendanceCard({ jobId }: { jobId: string }) {
  const [state, setState] = useState<AttendanceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "clock_in" | "clock_out">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [offsetMs, setOffsetMs] = useState(0);

  const [pending, setPending] = useState<{
    action: "clock_in" | "clock_out";
    capture: Capture;
  } | null>(null);
  const [reason, setReason] = useState("");
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/onsite-attendance`, {
        headers: authHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      if (alive.current) {
        setState(body as AttendanceState);
        // Server time is authoritative — a wrong phone clock must not change
        // the elapsed time we display.
        setOffsetMs(serverClockOffsetMs(String(body?.serverNow ?? ""), Date.now()));
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Failed to load attendance");
    }
  }, [jobId]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  // Live elapsed display only while a session of this user is open.
  useEffect(() => {
    if (!state?.openVisit) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state?.openVisit]);

  const submit = useCallback(
    async (action: "clock_in" | "clock_out", capture: Capture, exceptionReason: string) => {
      setBusy(action);
      setError(null);
      try {
        const res = await fetch(`/api/workspace/jobs/${jobId}/onsite-attendance`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            action,
            gps_result: capture.gps_result,
            latitude: capture.latitude,
            longitude: capture.longitude,
            accuracy: capture.accuracy,
            exception_reason: exceptionReason,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setPending(null);
        setReason("");
        setNotice(
          action === "clock_in"
            ? `Clocked in · ${gpsSummary(body.gpsResult, capture.accuracy)}`
            : `Clocked out · ${gpsSummary(body.gpsResult, capture.accuracy)}`,
        );
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Attendance action failed");
      } finally {
        setBusy(null);
      }
    },
    [jobId, load],
  );

  const start = useCallback(
    async (action: "clock_in" | "clock_out") => {
      setBusy(action);
      setNotice(null);
      setError(null);
      const capture = await capturePosition();
      setBusy(null);
      if (capture.latitude === null || capture.longitude === null) {
        // Location missing — a reason is mandatory before we commit anything.
        setPending({ action, capture });
        return;
      }
      await submit(action, capture, "");
    },
    [submit],
  );

  if (!state && !error) {
    return (
      <section className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          On-Site Attendance
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
      </section>
    );
  }

  const open = state?.openVisit ?? null;
  const elapsed = open
    ? formatElapsed(serverAlignedElapsedMs(open.clock_in_at, offsetMs, Date.now()))
    : null;
  const openElsewhere = !!state?.openOnOtherJob && !open;
  const disabled = !!state?.blockedReason || !state?.canAct || !!busy;

  return (
    <section
      data-testid="onsite-attendance-card"
      className="w-full max-w-full overflow-x-hidden rounded-xl border bg-card p-3 shadow-sm sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          On-Site Attendance
        </h2>
        <span
          className={
            open
              ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800"
              : "rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
          }
        >
          {open ? "Clocked in" : "Not clocked in"}
        </span>
      </div>

      {state?.blockedReason && (
        <p className="mt-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          {state.blockedReason}
        </p>
      )}
      {state?.openOnOtherJob && !open && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          You still have an open visit on Job {state.openOnOtherJob.jobNumber ?? "(unknown)"}. Clock
          out there first.
        </p>
      )}

      {open && (
        <div className="mt-3 rounded-lg border bg-background p-3">
          <p className="text-xs text-muted-foreground">
            Clocked in {formatMYDateTime(open.clock_in_at)}
          </p>
          <p
            data-testid="onsite-elapsed"
            className="mt-1 font-mono text-2xl font-semibold tabular-nums"
            aria-live="polite"
          >
            {elapsed}
            <span className="sr-only">{tick}</span>
          </p>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {gpsSummary(open.clock_in_gps_result, open.clock_in_accuracy_m)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <MapAction
              label="Map In"
              point={{
                gpsResult: open.clock_in_gps_result,
                latitude: open.clock_in_latitude,
                longitude: open.clock_in_longitude,
                accuracy: open.clock_in_accuracy_m,
              }}
            />
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => void start("clock_in")}
          /* Open visit elsewhere: don't even ask the device for a location —
             the server conflict remains the authoritative fallback. */
          disabled={disabled || !!open || openElsewhere}
          className="min-h-12 w-full rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 sm:flex-1"
        >
          {busy === "clock_in" ? "Locating…" : "GPS Clock In"}
        </button>
        <button
          type="button"
          onClick={() => void start("clock_out")}
          disabled={disabled || !open}
          className="min-h-12 w-full rounded-lg border px-4 text-sm font-semibold hover:bg-accent disabled:opacity-50 sm:flex-1"
        >
          {busy === "clock_out" ? "Locating…" : "GPS Clock Out"}
        </button>
      </div>

      {notice && <p className="mt-2 break-words text-xs text-emerald-700">{notice}</p>}
      {error && (
        <p data-testid="onsite-error" className="mt-2 break-words text-xs text-destructive">
          {error}
        </p>
      )}

      {pending && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="break-words text-xs font-semibold text-amber-900">
            {GPS_ERROR_MESSAGE[pending.capture.gps_result]}
          </p>
          <label className="mt-2 block text-xs font-medium text-amber-900">
            Reason for missing location *
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
              placeholder="e.g. no GPS signal inside the customer's server room"
            />
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={!reason.trim() || !!busy}
              onClick={() => void submit(pending.action, pending.capture, reason.trim())}
              className="min-h-11 w-full rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50 sm:flex-1"
            >
              Continue without location
            </button>
            <button
              type="button"
              onClick={() => {
                setPending(null);
                setReason("");
              }}
              className="min-h-11 w-full rounded-lg border px-3 text-sm font-semibold hover:bg-accent sm:w-auto"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!!state?.visits.length && (
        <ul className="mt-3 space-y-2">
          {state.visits.slice(0, 8).map((v) => (
            <li key={v.id} className="rounded-lg border p-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="min-w-0 break-words font-medium">
                  {v.actor_name_snapshot ?? "(unknown)"}
                </span>
                <span className="text-muted-foreground">
                  {v.clock_out_at ? `${v.duration_minutes ?? 0} min` : "In progress"}
                </span>
              </div>
              <p className="mt-0.5 break-words text-muted-foreground">
                In {formatMYDateTime(v.clock_in_at)}
                {v.clock_out_at ? ` · Out ${formatMYDateTime(v.clock_out_at)}` : ""}
              </p>
              {/* Full GPS evidence: both clock events, plus the stored reason
                  for anyone the server already authorised to see this row. */}
              <p className="mt-0.5 break-words text-muted-foreground">
                Clock In: {gpsSummary(v.clock_in_gps_result, v.clock_in_accuracy_m)}
              </p>
              {v.clock_in_exception_reason && (
                <p className="mt-0.5 break-words text-amber-700">
                  Clock In reason: {v.clock_in_exception_reason}
                </p>
              )}
              {v.clock_out_at && (
                <p className="mt-0.5 break-words text-muted-foreground">
                  Clock Out: {gpsSummary(v.clock_out_gps_result, v.clock_out_accuracy_m)}
                </p>
              )}
              {v.clock_out_at && v.clock_out_exception_reason && (
                <p className="mt-0.5 break-words text-amber-700">
                  Clock Out reason: {v.clock_out_exception_reason}
                </p>
              )}
              {v.has_gps_exception && (
                <p className="mt-0.5 break-words font-medium text-amber-700">
                  GPS exception recorded
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <MapAction
                  label="Map In"
                  point={{
                    gpsResult: v.clock_in_gps_result,
                    latitude: v.clock_in_latitude,
                    longitude: v.clock_in_longitude,
                    accuracy: v.clock_in_accuracy_m,
                  }}
                />
                <MapAction
                  label="Map Out"
                  point={{
                    gpsResult: v.clock_out_gps_result,
                    latitude: v.clock_out_latitude,
                    longitude: v.clock_out_longitude,
                    accuracy: v.clock_out_accuracy_m,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {state && !state.canViewAll && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          You are seeing your own visits only.
        </p>
      )}
    </section>
  );
}
