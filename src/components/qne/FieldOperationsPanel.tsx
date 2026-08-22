// FIELD OPERATIONS panel (Run 7 Phase C/D/E/F/G/H).
//
// Mobile-first control surface for Travel, Arrival, Work Sessions, Waiting
// Customer / Vendor and Work Notes. The server is always the authority — this
// panel only hides actions that cannot possibly succeed.

import { useCallback, useEffect, useMemo, useState } from "react";

import { formatMYDateTime } from "@/lib/format-date";
import { getStoredToken } from "@/lib/qne/tokens";
import {
  FIELD_EVENT_LABEL,
  VISIBILITY_LABEL,
  VISIBILITIES,
  WORK_NOTE_TYPES,
  WORK_NOTE_TYPE_LABEL,
  availableFieldActions,
  canReadyForCompletion,
  fieldActionsBlocked,
  type FieldEvent,
} from "@/lib/qne/service-jobs/field-ops";
import { gpsRequestFor, type TravelGpsSettings } from "@/lib/qne/service-jobs/tenant-settings";
import {
  SUPPORT_MODES,
  SUPPORT_MODE_LABEL,
  isRemoteMode,
  supportModeLabel,
  usesTravel,
} from "@/lib/qne/service-jobs/support-mode";

export interface FieldStateResponse {
  jobStatus: string;
  isDeleted: boolean;
  job: {
    support_mode: string | null;
    travel_started_at: string | null;
    arrived_on_site_at: string | null;
    left_site_at: string | null;
    ready_for_completion_at: string | null;
    assigned_user_name_snapshot: string | null;
    scheduled_start_at: string | null;
    scheduled_end_at: string | null;
    assigned_user_id: string | null;
  };
  gps: TravelGpsSettings;
  state: {
    status: string;
    is_deleted: boolean;
    supportMode?: string | null;
    activeSession: { status: "active" | "paused" } | null;
    openWaiting: { customer: boolean; vendor: boolean };
    workNoteCount: number;
    travelStartedAt?: string | null;
    arrivedAt?: string | null;
    leftAt?: string | null;
  };
  permissions?: {
    canMutate: boolean;
    canSetSupportMode: boolean;
    supportModeLockReason: string | null;
  };
  blockedReason?: string | null;
  availableActions?: FieldEvent[];

  openSession: { id: string; started_at: string; status: string } | null;
  sessions: Array<{
    id: string;
    technician_name_snapshot: string | null;
    started_at: string;
    ended_at: string | null;
    status: string;
    pause_reason: string | null;
    duration_minutes: number | null;
  }>;
  waiting: Array<Record<string, string | null>>;
  notes: Array<{
    id: string;
    note_type: string;
    visibility: string;
    body: string;
    author_name_snapshot: string | null;
    created_at: string;
  }>;
  totalWorkMinutes: number;
}

function authHeaders(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function fmtMinutes(n: number): string {
  if (!n) return "0m";
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

interface Coords {
  latitude: number;
  longitude: number;
  accuracy: number;
}

async function readLocation(timeoutMs = 8000): Promise<Coords | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: Coords | null) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    navigator.geolocation.getCurrentPosition(
      (p) =>
        finish({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      () => finish(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
    setTimeout(() => finish(null), timeoutMs + 500);
  });
}

const BTN =
  "min-h-11 rounded-md border px-3 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-50";
const BTN_PRIMARY =
  "min-h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50";

export function FieldOperationsPanel({
  jobId,
  onChanged,
}: {
  jobId: string;
  onChanged: () => void | Promise<void>;
}) {
  const [data, setData] = useState<FieldStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FieldEvent | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/field`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setData(body as FieldStateResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load field operations.");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(
    async (action: FieldEvent, payload: Record<string, unknown> = {}) => {
      if (!data) return;
      setBusy(action);
      setError(null);
      setInfo(null);
      try {
        const need = gpsRequestFor(data.gps, action, data.job.support_mode);
        let location: Coords | null = null;
        if (need !== "none") location = await readLocation();
        if (need === "required" && !location && !payload.gps_exception_reason) {
          const reason = window.prompt(
            "Location is required for this action but could not be read. Enter an exception reason to continue:",
            "",
          );
          if (!reason || !reason.trim()) {
            setError("Location or an exception reason is required for this action.");
            return;
          }
          payload = { ...payload, gps_exception_reason: reason.trim() };
        }
        if (need === "optional" && !location) {
          setInfo("Location was not available — the action continued without it.");
        }

        const res = await fetch(`/api/workspace/jobs/${jobId}/field`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ action, ...payload, location }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setDialog(null);
        await load();
        await onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed.");
      } finally {
        setBusy(null);
      }
    },
    [data, jobId, load, onChanged],
  );

  // The server is the authority: prefer its action list, fall back to the
  // shared pure rules while an older response shape is in flight.
  const actions = useMemo<FieldEvent[]>(
    () => (data ? (data.availableActions ?? availableFieldActions(data.state)) : []),
    [data],
  );

  const saveSupportMode = useCallback(
    async (mode: string) => {
      setBusy("support_mode_set");
      setError(null);
      try {
        const res = await fetch(`/api/workspace/jobs/${jobId}/field`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ action: "support_mode_set", support_mode: mode }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        await load();
        await onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not set support mode.");
      } finally {
        setBusy(null);
      }
    },
    [jobId, load, onChanged],
  );


  if (loading && !data) {
    return (
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Field Operations
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">Loading field state…</p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Field Operations
        </h2>
        <p className="mt-2 text-sm text-destructive">{error ?? "Unavailable."}</p>
      </section>
    );
  }

  const blocked = data.blockedReason ?? fieldActionsBlocked(data.state);
  const canMutate = data.permissions?.canMutate ?? true;
  const travel = usesTravel(data.job.support_mode);
  const remote = isRemoteMode(data.job.support_mode);
  const ready = canReadyForCompletion(data.state);
  const session = data.state.activeSession;


  const stage = data.state.openWaiting.customer
    ? "Waiting Customer"
    : data.state.openWaiting.vendor
      ? "Waiting Vendor"
      : session?.status === "active"
        ? "Work in progress"
        : session?.status === "paused"
          ? "Work paused"
          : data.job.ready_for_completion_at
            ? "Ready for completion"
            : data.job.arrived_on_site_at && !data.job.left_site_at
              ? "On site"
              : data.job.travel_started_at && !data.job.arrived_on_site_at
                ? "Travelling"
                : "Not started";

  const visible = actions.filter((a) => {
    if (!travel && (a === "travel_started" || a === "arrived_on_site" || a === "leave_site")) {
      return false;
    }
    return true;
  });

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Field Operations
        </h2>
        <button type="button" onClick={() => void load()} className={BTN + " shrink-0 text-xs"}>
          Refresh
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Support mode" value={supportModeLabel(data.job.support_mode)} />
        <Stat label="Current stage" value={stage} />
        <Stat label="Support PIC" value={data.job.assigned_user_name_snapshot ?? "Unassigned"} />
        <Stat
          label="Appointment"
          value={
            data.job.scheduled_start_at
              ? formatMYDateTime(data.job.scheduled_start_at)
              : "Not scheduled"
          }
        />
        <Stat
          label="Travel"
          value={
            !travel
              ? "Not applicable (remote)"
              : data.job.travel_started_at
                ? formatMYDateTime(data.job.travel_started_at)
                : "Not started"
          }
        />
        <Stat
          label="Arrival"
          value={
            !travel
              ? "Not applicable (remote)"
              : data.job.arrived_on_site_at
                ? formatMYDateTime(data.job.arrived_on_site_at) +
                  (data.job.left_site_at
                    ? ` · left ${formatMYDateTime(data.job.left_site_at)}`
                    : "")
                : "Not arrived"
          }
        />
        <Stat
          label="Work session"
          value={session ? (session.status === "active" ? "Active" : "Paused") : "None open"}
        />
        <Stat label="Total work duration" value={fmtMinutes(data.totalWorkMinutes)} />
        <Stat
          label="Waiting customer"
          value={data.state.openWaiting.customer ? "Open" : "None"}
        />
        <Stat label="Waiting vendor" value={data.state.openWaiting.vendor ? "Open" : "None"} />
        <Stat label="Work notes" value={String(data.state.workNoteCount)} />
        <Stat label="Attachments" value={String(attachmentCount)} />
      </dl>

      {blocked && (
        <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {blocked} This section is read-only.
        </p>
      )}
      {!canMutate && !blocked && (
        <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Only the Primary PIC or an Owner / Administrator can record field actions. You can still
          follow progress here.
        </p>
      )}
      {remote && !blocked && (
        <p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          Remote support — travel, arrival and location are not required. Start Work directly.
        </p>
      )}
      {!data.job.support_mode && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">Support mode is not set.</p>
          <p className="mt-0.5 text-xs">
            Field actions stay locked until the Primary PIC or an Administrator records how this
            Job is being served.
          </p>
          {data.permissions?.canSetSupportMode && (
            <select
              className="input mt-2"
              defaultValue=""
              disabled={busy !== null}
              onChange={(e) => {
                if (e.target.value) void saveSupportMode(e.target.value);
              }}
            >
              <option value="" disabled>
                Select support mode…
              </option>
              {SUPPORT_MODES.map((m) => (
                <option key={m} value={m}>
                  {SUPPORT_MODE_LABEL[m]}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {info && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{info}</p>
      )}

      {!blocked && canMutate && (
        <div className="mt-4 flex flex-wrap gap-2">
          {visible.map((a) => {
            const needsForm =
              a === "waiting_customer_started" ||
              a === "waiting_vendor_started" ||
              a === "waiting_customer_resolved" ||
              a === "waiting_vendor_resolved";
            const primary = a === "work_started" || a === "work_resumed";
            return (
              <button
                key={a}
                type="button"
                disabled={busy !== null}
                onClick={() => (needsForm ? setDialog(a) : void post(a))}
                className={primary ? BTN_PRIMARY : BTN}
              >
                {busy === a ? "Working…" : FIELD_EVENT_LABEL[a]}
              </button>
            );
          })}

          {!ready.ok && data.state.status === "In Progress" && (
            <span className="self-center text-xs text-muted-foreground">
              Ready for Completion blocked: {ready.reason}
            </span>
          )}
        </div>
      )}

      <WorkNotes
        jobId={jobId}
        notes={data.notes}
        disabled={Boolean(blocked)}
        onAdded={async () => {
          await load();
          await onChanged();
        }}
      />

      <Sessions sessions={data.sessions} />
      <WaitingList rows={data.waiting} />

      {dialog && (
        <ActionDialog
          action={dialog}
          busy={busy !== null}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => void post(dialog, payload)}
        />
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-background/60 p-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function Sessions({ sessions }: { sessions: FieldStateResponse["sessions"] }) {
  if (sessions.length === 0) return null;
  return (
    <div className="mt-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Work sessions
      </h3>
      <ul className="mt-2 space-y-1">
        {sessions.map((s) => (
          <li key={s.id} className="rounded-md border bg-background/60 px-3 py-2 text-xs">
            <span className="font-semibold">{s.technician_name_snapshot ?? "—"}</span>{" "}
            {formatMYDateTime(s.started_at)} →{" "}
            {s.ended_at ? formatMYDateTime(s.ended_at) : "open"} ·{" "}
            <span className="uppercase">{s.status}</span>
            {typeof s.duration_minutes === "number" ? ` · ${fmtMinutes(s.duration_minutes)}` : ""}
            {s.pause_reason ? ` · ${s.pause_reason}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WaitingList({ rows }: { rows: FieldStateResponse["waiting"] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Waiting periods
      </h3>
      <ul className="mt-2 space-y-1">
        {rows.map((w) => (
          <li key={String(w.id)} className="rounded-md border bg-background/60 px-3 py-2 text-xs">
            <span className="font-semibold uppercase">{w.waiting_type}</span> ·{" "}
            {formatMYDateTime(w.started_at)} →{" "}
            {w.resolved_at ? formatMYDateTime(w.resolved_at) : "open"}
            <div className="mt-0.5 text-muted-foreground">{w.reason}</div>
            {w.vendor_ticket_number && (
              <div className="mt-0.5">Vendor ticket: {w.vendor_ticket_number}</div>
            )}
            {w.vendor_response && <div className="mt-0.5">Vendor response: {w.vendor_response}</div>}
            {w.resolution_note && <div className="mt-0.5">Resolved: {w.resolution_note}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorkNotes({
  jobId,
  notes,
  disabled,
  onAdded,
}: {
  jobId: string;
  notes: FieldStateResponse["notes"];
  disabled: boolean;
  onAdded: () => void | Promise<void>;
}) {
  const [type, setType] = useState<string>("diagnosis");
  const [visibility, setVisibility] = useState<string>("internal");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!body.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/work-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ note_type: type, visibility, body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setBody("");
      await onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add work note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Work notes ({notes.length})
      </h3>
      {!disabled && (
        <div className="mt-2 space-y-2 rounded-lg border bg-background/60 p-3">
          <div className="flex flex-wrap gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="min-h-11 rounded-md border bg-background px-2 text-sm"
            >
              {WORK_NOTE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {WORK_NOTE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="min-h-11 rounded-md border bg-background px-2 text-sm"
            >
              {VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABEL[v]}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="Describe the diagnosis, action taken or test result…"
            className="w-full rounded-md border bg-background p-2 text-sm"
          />
          {err && <p className="text-xs text-destructive">{err}</p>}
          <button
            type="button"
            disabled={saving || !body.trim()}
            onClick={() => void submit()}
            className={BTN_PRIMARY}
          >
            {saving ? "Saving…" : "Add work note"}
          </button>
        </div>
      )}
      <ul className="mt-2 space-y-1">
        {notes.map((n) => (
          <li key={n.id} className="rounded-md border bg-background/60 px-3 py-2 text-xs">
            <div className="flex flex-wrap gap-2 text-[10px] uppercase text-muted-foreground">
              <span className="font-semibold text-foreground">
                {WORK_NOTE_TYPE_LABEL[n.note_type as keyof typeof WORK_NOTE_TYPE_LABEL] ??
                  n.note_type}
              </span>
              <span>{n.visibility === "internal" ? "Internal" : "Visible to customer"}</span>
              <span>{formatMYDateTime(n.created_at)}</span>
              <span>{n.author_name_snapshot ?? ""}</span>
            </div>
            <div className="mt-1 whitespace-pre-wrap text-sm text-foreground">{n.body}</div>
          </li>
        ))}
        {notes.length === 0 && (
          <li className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            No work notes yet.
          </li>
        )}
      </ul>
    </div>
  );
}

function ActionDialog({
  action,
  busy,
  onClose,
  onSubmit,
}: {
  action: FieldEvent;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const isVendorStart = action === "waiting_vendor_started";
  const isCustomerStart = action === "waiting_customer_started";
  const isResolve = action.endsWith("_resolved");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-t-xl bg-card p-4 shadow-lg sm:rounded-xl">
        <h3 className="text-base font-semibold text-foreground">{FIELD_EVENT_LABEL[action]}</h3>
        <div className="mt-3 space-y-3">
          {(isCustomerStart || isVendorStart) && (
            <Field label="Reason" required>
              <textarea
                rows={2}
                className="w-full rounded-md border bg-background p-2 text-sm"
                onChange={(e) => set("reason", e.target.value)}
              />
            </Field>
          )}
          {isCustomerStart && (
            <>
              <Field label="Requested action or information" required>
                <textarea
                  rows={2}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  onChange={(e) => set("requested_action", e.target.value)}
                />
              </Field>
              <Field label="Contact method">
                <input
                  className="min-h-11 w-full rounded-md border bg-background px-2 text-sm"
                  onChange={(e) => set("contact_method", e.target.value)}
                />
              </Field>
              <Field label="Follow-up date">
                <input
                  type="date"
                  className="min-h-11 w-full rounded-md border bg-background px-2 text-sm"
                  onChange={(e) => set("follow_up_date", e.target.value)}
                />
              </Field>
            </>
          )}
          {isVendorStart && (
            <>
              <Field label="Vendor / Principal" required>
                <input
                  className="min-h-11 w-full rounded-md border bg-background px-2 text-sm"
                  onChange={(e) => set("vendor_name", e.target.value)}
                />
              </Field>
              <Field label="Vendor ticket number" required>
                <input
                  className="min-h-11 w-full rounded-md border bg-background px-2 text-sm"
                  onChange={(e) => set("vendor_ticket_number", e.target.value)}
                />
              </Field>
              <Field label="Vendor contact">
                <input
                  className="min-h-11 w-full rounded-md border bg-background px-2 text-sm"
                  onChange={(e) => set("vendor_contact", e.target.value)}
                />
              </Field>
              <Field label="Expected response date">
                <input
                  type="date"
                  className="min-h-11 w-full rounded-md border bg-background px-2 text-sm"
                  onChange={(e) => set("expected_response_date", e.target.value)}
                />
              </Field>
            </>
          )}
          {isResolve && (
            <Field label="Resolution note" required>
              <textarea
                rows={2}
                className="w-full rounded-md border bg-background p-2 text-sm"
                onChange={(e) => set("resolution_note", e.target.value)}
              />
            </Field>
          )}
          {action === "waiting_vendor_resolved" && (
            <Field label="Vendor response" required>
              <textarea
                rows={2}
                className="w-full rounded-md border bg-background p-2 text-sm"
                onChange={(e) => set("vendor_response", e.target.value)}
              />
            </Field>
          )}
          {action === "ready_for_completion" && (
            <p className="text-sm text-muted-foreground">
              This marks the Job ready for completion. Close any open work session first.
            </p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSubmit(form)}
            className={BTN_PRIMARY}
          >
            {busy ? "Working…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
