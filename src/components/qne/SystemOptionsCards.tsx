// WP4 — System Options cards mounted on /settings.
// Only controls backed by current server workflows are editable:
//   • Travel & GPS → /api/settings/tenant (consumed by Job field actions)
//   • Inquiry & Export Access → /api/settings/reports (WP5 server resolver)
//   • Attachment policy → /api/settings/tenant jobAttachments (enforced by
//     the Job attachment upload route, never above the hard caps)
// Completion policy is enforced by fixed server rules, so it stays read-only.

import { useCallback, useEffect, useState } from "react";

import {
  INQUIRY_SCOPE_LABEL,
  NORMAL_USER_DEFAULT,
  validateInquiryPermission,
  type InquiryKey,
  type InquiryPermission,
} from "@/lib/qne/inquiry/permissions";
import {
  DEFAULT_TENANT_SETTINGS,
  GPS_EVENTS,
  GPS_MODES,
  GPS_MODE_LABEL,
  type TravelGpsSettings,
} from "@/lib/qne/service-jobs/tenant-settings";
import {
  ALLOWED_EXTENSION_KEYS,
  POLICY_BOUNDS,
  validateJobAttachmentLimits,
  type JobAttachmentLimits,
} from "@/lib/qne/storage/attachment-policy";
import { getStoredToken } from "@/lib/qne/tokens";

type Notify = (kind: "ok" | "err", msg: string) => void;

function authHeaders(json = false): Record<string, string> {
  const token = getStoredToken();
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function OptionCard({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-32 rounded-xl border bg-card p-4 shadow-sm sm:p-5"
    >
      <h3 id={`${id}-title`} className="text-base font-semibold text-foreground">
        {title}
      </h3>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const GPS_EVENT_LABEL: Record<(typeof GPS_EVENTS)[number], string> = {
  travel_started: "Travel started",
  arrived_on_site: "Arrived on site",
  work_started: "Work started",
  leave_site: "Leave site",
};

export function TravelGpsCard({ onNotify }: { onNotify: Notify }) {
  const [value, setValue] = useState<TravelGpsSettings>(DEFAULT_TENANT_SETTINGS.travelGps);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/tenant", { headers: authHeaders() });
        const body = (await res.json().catch(() => ({}))) as {
          settings?: { travelGps?: TravelGpsSettings };
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? "Failed to load settings");
        if (!off && body.settings?.travelGps) setValue(body.settings.travelGps);
      } catch (e) {
        if (!off) onNotify("err", e instanceof Error ? e.message : "Failed to load settings");
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, [onNotify]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/tenant", {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify({ area: "travel_gps", settings: { travelGps: value } }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        settings?: { travelGps?: TravelGpsSettings };
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      if (body.settings?.travelGps) setValue(body.settings.travelGps);
      onNotify("ok", "Travel & GPS saved.");
    } catch (e) {
      onNotify("err", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <OptionCard
      id="opt-travel-gps"
      title="Travel & GPS"
      description="Controls when technicians are asked for location during Job field actions."
    >
      <fieldset disabled={loading || saving} className="space-y-3" data-testid="travel-gps-card">
        <label className="block text-sm">
          <span className="font-medium">Location requests</span>
          <select
            className="mt-1 block h-11 w-full rounded-md border bg-background px-3 text-sm"
            value={value.mode}
            onChange={(e) =>
              setValue({ ...value, mode: e.target.value as TravelGpsSettings["mode"] })
            }
          >
            {GPS_MODES.map((m) => (
              <option key={m} value={m}>
                {GPS_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {GPS_EVENTS.map((ev) => (
            <label key={ev} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                disabled={value.mode === "off"}
                checked={value.events[ev]}
                onChange={(e) =>
                  setValue({ ...value, events: { ...value.events, [ev]: e.target.checked } })
                }
              />
              {GPS_EVENT_LABEL[ev]}
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={save}
          className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Travel & GPS"}
        </button>
      </fieldset>
    </OptionCard>
  );
}

export function AttachmentPolicyCard({ onNotify }: { onNotify: Notify }) {
  const [value, setValue] = useState<JobAttachmentLimits>(DEFAULT_TENANT_SETTINGS.jobAttachments);
  const [saved, setSaved] = useState<JobAttachmentLimits | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/tenant", { headers: authHeaders() });
        const body = (await res.json().catch(() => ({}))) as {
          settings?: { jobAttachments?: JobAttachmentLimits };
          isAdmin?: boolean;
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? "Failed to load attachment policy");
        if (off) return;
        const v = body.settings?.jobAttachments ?? DEFAULT_TENANT_SETTINGS.jobAttachments;
        setValue(v);
        setSaved(v);
        setIsAdmin(Boolean(body.isAdmin));
      } catch (e) {
        if (!off) setLoadError(e instanceof Error ? e.message : "Failed to load attachment policy");
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, []);

  const check = validateJobAttachmentLimits(value);
  const dirty = saved !== null && JSON.stringify(saved) !== JSON.stringify(value);
  const B = POLICY_BOUNDS;

  function toggleExt(ext: string, on: boolean) {
    const set = new Set(value.allowedExtensions);
    if (on) set.add(ext);
    else set.delete(ext);
    setValue({ ...value, allowedExtensions: ALLOWED_EXTENSION_KEYS.filter((k) => set.has(k)) });
  }

  async function save() {
    if (!check.ok) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/tenant", {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify({
          area: "attachment_policy",
          settings: { jobAttachments: check.value },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        settings?: { jobAttachments?: JobAttachmentLimits };
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      const v = body.settings?.jobAttachments ?? check.value;
      setValue(v);
      setSaved(v);
      onNotify("ok", "Attachment policy saved. It applies to new uploads.");
    } catch (e) {
      onNotify("err", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const num = (
    k: "maxFileMB" | "maxFiles" | "maxTotalMB",
    label: string,
    unit: string,
    b: { min: number; max: number },
  ) => (
    <label className="block text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={b.min}
          max={b.max}
          step={1}
          className="h-11 w-24 rounded-md border bg-background px-3 text-sm"
          value={Number.isFinite(value[k]) ? value[k] : ""}
          onChange={(e) =>
            setValue({ ...value, [k]: e.target.value === "" ? NaN : Number(e.target.value) })
          }
          aria-describedby={`att-${k}-range`}
        />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      <span id={`att-${k}-range`} className="text-[11px] text-muted-foreground">
        {b.min}–{b.max}
      </span>
    </label>
  );

  return (
    <OptionCard
      id="opt-attachments"
      title="Attachment policy"
      description="Applies to new Job uploads to Google Drive. You can lower the limits below the system maximum; existing files stay available."
    >
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      <fieldset
        disabled={loading || saving || !isAdmin}
        className="space-y-3"
        data-testid="attachment-policy-card"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {num("maxFileMB", "Per file", "MB", B.maxFileMB)}
          {num("maxFiles", "Files per Job", "files", B.maxFiles)}
          {num("maxTotalMB", "Total per Job", "MB", B.maxTotalMB)}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Allowed file types</p>
          <div className="mt-1 grid grid-cols-3 gap-1 sm:grid-cols-5">
            {ALLOWED_EXTENSION_KEYS.map((ext) => (
              <label key={ext} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={value.allowedExtensions.includes(ext)}
                  onChange={(e) => toggleExt(ext, e.target.checked)}
                />
                .{ext}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Programs, scripts, macro-enabled Office files and videos are always blocked. Attachments
            are internal only.
          </p>
        </div>
        {!check.ok && <p className="text-xs text-destructive">{check.error}</p>}
        {!isAdmin && !loading && (
          <p className="text-xs text-muted-foreground">
            Only an Owner or Administrator can change this.
          </p>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!check.ok || !dirty}
          className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : dirty ? "Save attachment policy" : "Saved"}
        </button>
      </fieldset>
    </OptionCard>
  );
}

export function CompletionPolicyCard() {
  return (
    <OptionCard
      id="opt-completion"
      title="Completion & Acknowledgement"
      description="Completion rules applied to every Job."
    >
      <ul
        className="list-disc space-y-1 pl-5 text-sm text-foreground"
        data-testid="completion-policy"
      >
        <li>Completion needs a resolution note and is saved in one step.</li>
        <li>
          Ticking “Follow-up required” keeps the Job in Follow-up Open until it is cleared with a
          note.
        </li>
        <li>Completed work can only be reopened through an approved reopen request.</li>
        <li>Customer acknowledgement capture is not yet available.</li>
      </ul>
    </OptionCard>
  );
}

interface InquiryRow {
  key: InquiryKey;
  label: string;
  normalUser: InquiryPermission;
}

const DIMENSIONS: {
  k: "can_view" | "can_export_excel" | "view_private_notes" | "view_gps";
  label: string;
}[] = [
  { k: "can_view", label: "View" },
  { k: "can_export_excel", label: "Export to Excel" },
  { k: "view_private_notes", label: "Private notes" },
  { k: "view_gps", label: "GPS locations" },
];

function InquiryEditor({
  row,
  onNotify,
  onSaved,
}: {
  row: InquiryRow;
  onNotify: Notify;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<InquiryPermission>(row.normalUser);
  const [saved, setSaved] = useState<InquiryPermission>(row.normalUser);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const check = validateInquiryPermission(value);
  const dirty = JSON.stringify(saved) !== JSON.stringify(value);
  const hintId = `inquiry-${row.key}-view-hint`;

  function toggle(k: (typeof DIMENSIONS)[number]["k"], on: boolean) {
    // Turning View off also clears everything that depends on it.
    if (k === "can_view" && !on) setValue({ ...NORMAL_USER_DEFAULT });
    else setValue({ ...value, [k]: on });
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/settings/reports", {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify({ key: row.key, role: "normal_user", permission: value }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        normalUser?: InquiryPermission;
      };
      if (!res.ok) throw new Error(body.error ?? `Save failed (HTTP ${res.status})`);
      const next = body.normalUser ?? value;
      setValue(next);
      setSaved(next);
      onNotify("ok", `${row.label} access saved.`);
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setSaveError(msg);
      onNotify("err", msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border p-3" data-testid={`inquiry-${row.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{row.label}</h4>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
          Owner/Admin: full access, all Jobs (fixed)
        </span>
      </div>
      <p className="mt-2 text-xs font-medium text-muted-foreground">Normal User</p>
      <fieldset disabled={saving} className="mt-1 space-y-2">
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {DIMENSIONS.map((d) => {
            const locked = d.k !== "can_view" && !value.can_view;
            return (
              <label
                key={d.k}
                className={`flex min-h-11 items-center gap-2 text-sm ${locked ? "text-muted-foreground" : ""}`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={value[d.k]}
                  disabled={locked}
                  aria-describedby={locked ? hintId : undefined}
                  onChange={(e) => toggle(d.k, e.target.checked)}
                />
                {d.label}
              </label>
            );
          })}
        </div>
        {!value.can_view && (
          <p id={hintId} className="text-xs text-muted-foreground" data-testid="inquiry-view-hint">
            Tick View first — Export, Private notes, GPS locations and All company Jobs unlock once
            View is on.
          </p>
        )}
        <label className="block text-sm">
          <span className="text-xs text-muted-foreground">Job scope</span>
          <select
            className="mt-1 block h-11 w-full rounded-md border bg-background px-3 text-sm sm:w-64"
            value={value.scope}
            disabled={!value.can_view}
            aria-describedby={!value.can_view ? hintId : undefined}
            onChange={(e) =>
              setValue({ ...value, scope: e.target.value as InquiryPermission["scope"] })
            }
          >
            <option value="own">{INQUIRY_SCOPE_LABEL.own}</option>
            <option value="all">{INQUIRY_SCOPE_LABEL.all}</option>
          </select>
        </label>
        {!check.ok && <p className="text-xs text-destructive">{check.error}</p>}
        {saveError && (
          <p role="alert" className="text-xs text-destructive">
            {saveError}
          </p>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!check.ok || !dirty}
          className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : dirty ? "Save access" : "Saved"}
        </button>
      </fieldset>
    </div>
  );
}

export function InquiryAccessCard({ onNotify }: { onNotify: Notify }) {
  const [rows, setRows] = useState<InquiryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/reports", { headers: authHeaders() });
      const body = (await res.json().catch(() => ({}))) as {
        inquiries?: InquiryRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Failed to load inquiry access");
      setRows(body.inquiries ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load inquiry access");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <OptionCard
      id="opt-inquiry"
      title="Inquiry & Export Access"
      description="Who can use the upcoming Job inquiry screens. New access starts closed."
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!rows && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      <div className="space-y-3">
        {rows?.map((r) => (
          <InquiryEditor
            key={`${r.key}:${JSON.stringify(r.normalUser)}`}
            row={r}
            onNotify={onNotify}
            onSaved={() => void load()}
          />
        ))}
      </div>
    </OptionCard>
  );
}
