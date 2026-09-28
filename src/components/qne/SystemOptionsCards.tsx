// WP4 — System Options cards mounted on /settings.
// Only controls backed by current server workflows are editable:
//   • Travel & GPS → /api/settings/tenant (consumed by Job field actions)
//   • Inquiry & Export Access → /api/settings/reports (WP5 server resolver)
// Attachment and Completion policies are enforced by fixed server rules
// today, so they are shown read-only rather than as fake controls.

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
  ACCEPT_ATTRIBUTE,
  MAX_ACTIVE_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  formatBytes,
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

export function AttachmentPolicyCard() {
  return (
    <OptionCard
      id="opt-attachments"
      title="Attachment policy"
      description="Enforced by the server for every Job upload. Files are stored in the connected Google Drive."
    >
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3" data-testid="attachment-policy">
        <div className="rounded-md bg-muted/40 p-3">
          <dt className="text-xs text-muted-foreground">Max per file</dt>
          <dd className="font-semibold">{formatBytes(MAX_FILE_BYTES)}</dd>
        </div>
        <div className="rounded-md bg-muted/40 p-3">
          <dt className="text-xs text-muted-foreground">Files per Job</dt>
          <dd className="font-semibold">{MAX_ACTIVE_FILES}</dd>
        </div>
        <div className="rounded-md bg-muted/40 p-3">
          <dt className="text-xs text-muted-foreground">Total per Job</dt>
          <dd className="font-semibold">{formatBytes(MAX_TOTAL_BYTES)}</dd>
        </div>
      </dl>
      <p className="mt-2 break-words text-xs text-muted-foreground">
        Allowed types: {ACCEPT_ATTRIBUTE.split(",").join(", ")}. Attachments are internal only.
      </p>
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

function InquiryEditor({ row, onNotify }: { row: InquiryRow; onNotify: Notify }) {
  const [value, setValue] = useState<InquiryPermission>(row.normalUser);
  const [saving, setSaving] = useState(false);
  const check = validateInquiryPermission(value);

  function toggle(k: (typeof DIMENSIONS)[number]["k"], on: boolean) {
    // Turning View off also clears everything that depends on it.
    if (k === "can_view" && !on) setValue({ ...NORMAL_USER_DEFAULT });
    else setValue({ ...value, [k]: on });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/reports", {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify({ key: row.key, role: "normal_user", permission: value }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      onNotify("ok", `${row.label} access saved.`);
    } catch (e) {
      onNotify("err", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border p-3" data-testid={`inquiry-${row.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{row.label}</h4>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
          Owner/Admin: full access, all Jobs
        </span>
      </div>
      <p className="mt-2 text-xs font-medium text-muted-foreground">Normal User</p>
      <fieldset disabled={saving} className="mt-1 space-y-2">
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {DIMENSIONS.map((d) => (
            <label key={d.k} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={value[d.k]}
                disabled={d.k !== "can_view" && !value.can_view}
                onChange={(e) => toggle(d.k, e.target.checked)}
              />
              {d.label}
            </label>
          ))}
        </div>
        <label className="block text-sm">
          <span className="text-xs text-muted-foreground">Job scope</span>
          <select
            className="mt-1 block h-11 w-full rounded-md border bg-background px-3 text-sm sm:w-64"
            value={value.scope}
            disabled={!value.can_view}
            onChange={(e) =>
              setValue({ ...value, scope: e.target.value as InquiryPermission["scope"] })
            }
          >
            <option value="own">{INQUIRY_SCOPE_LABEL.own}</option>
            <option value="all">{INQUIRY_SCOPE_LABEL.all}</option>
          </select>
        </label>
        {!check.ok && <p className="text-xs text-destructive">{check.error}</p>}
        <button
          type="button"
          onClick={save}
          disabled={!check.ok}
          className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save access"}
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
          <InquiryEditor key={r.key} row={r} onNotify={onNotify} />
        ))}
      </div>
    </OptionCard>
  );
}
