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

function currentMapDevice(): MapDevice {
  if (typeof navigator === "undefined") return { apple: false, android: false, canShare: false };
  return {
    apple: isAppleMapsDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    android: isAndroidDevice(navigator.userAgent, navigator.platform),
    canShare: typeof navigator.share === "function",
  };
}

interface ChooserTarget {
  label: "Map In" | "Map Out";
  point: AttendanceMapPoint;
}

/** Opens the ServiceHub-owned chooser — never a forced single map app. */
function MapAction({
  label,
  point,
  onOpen,
  tone = "plain",
  placeholder = false,
}: {
  label: "Map In" | "Map Out";
  point: AttendanceMapPoint;
  onOpen: (target: ChooserTarget) => void;
  /** WP3A — light peach treatment for the compact visit rows. */
  tone?: "plain" | "peach";
  /** Render a disabled chip instead of nothing when there is no valid point. */
  placeholder?: boolean;
}) {
  const base =
    "inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border px-3 text-xs font-semibold";
  const peach =
    "border-orange-200 bg-orange-100 text-orange-900 hover:bg-orange-200 dark:border-orange-900/50 dark:bg-orange-900/30 dark:text-orange-100";
  const plain = "bg-card text-foreground hover:bg-accent";
  if (!hasMapAction(point)) {
    if (!placeholder) return null;
    return (
      <span
        aria-disabled="true"
        className={`${base} cursor-not-allowed opacity-40 ${tone === "peach" ? peach : plain}`}
      >
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen({ label, point })}
      aria-haspopup="dialog"
      aria-label={`${label} — choose a maps app`}
      className={`${base} ${tone === "peach" ? peach : plain}`}
    >
      {label}
    </button>
  );
}

function MapChooserDialog({
  target,
  onClose,
}: {
  target: ChooserTarget | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const choices = target ? mapChoicesForPoint(target.point, currentMapDevice()) : null;

  const copyLink = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("Location link copied.");
    } catch {
      setCopied("Could not copy the link on this device.");
    }
  }, []);

  const shareLink = useCallback(
    async (label: "Map In" | "Map Out", point: AttendanceMapPoint) => {
      const payload = sharePayload(label, point);
      if (!payload) return;
      try {
        await navigator.share(payload);
      } catch {
        // Cancelled or unsupported — fall back to a link the user can paste.
        await copyLink(payload.url);
      }
    },
    [copyLink],
  );

  return (
    <Dialog
      open={!!target}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(null);
          onClose();
        }
      }}
    >
      <DialogContent className="bottom-0 top-auto max-h-[85vh] w-full max-w-full translate-y-0 overflow-y-auto rounded-t-2xl p-4 sm:bottom-auto sm:top-[50%] sm:max-w-sm sm:translate-y-[-50%] sm:rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Open {target?.label ?? "location"} in</DialogTitle>
          <DialogDescription className="text-xs">
            Choose where to open this location. Your device decides which installed app handles the
            hand-off.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {(choices ?? []).map((choice) =>
            choice.kind === "link" ? (
              <a
                key={choice.id}
                href={choice.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border bg-card px-3 text-sm font-semibold text-foreground hover:bg-accent"
              >
                {choice.label}
              </a>
            ) : (
              <button
                key={choice.id}
                type="button"
                onClick={() => {
                  if (choice.kind === "share" && target) {
                    void shareLink(target.label, target.point);
                  } else {
                    void copyLink(choice.href);
                  }
                }}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border bg-card px-3 text-sm font-semibold text-foreground hover:bg-accent"
              >
                {choice.label}
              </button>
            ),
          )}
          {copied && <p className="break-words text-xs text-muted-foreground">{copied}</p>}
          <button
            type="button"
            onClick={() => {
              setCopied(null);
              onClose();
            }}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
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
  // Only one chooser may be open at a time across this card.
  const [chooser, setChooser] = useState<ChooserTarget | null>(null);

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
              onOpen={setChooser}
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
                  onOpen={setChooser}
                  label="Map In"
                  point={{
                    gpsResult: v.clock_in_gps_result,
                    latitude: v.clock_in_latitude,
                    longitude: v.clock_in_longitude,
                    accuracy: v.clock_in_accuracy_m,
                  }}
                />
                <MapAction
                  onOpen={setChooser}
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
      <MapChooserDialog target={chooser} onClose={() => setChooser(null)} />

      {state && !state.canViewAll && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          You are seeing your own visits only.
        </p>
      )}
    </section>
  );
}
