// WP0E-R — Owner/Admin cancellation policy controls.
// Reads and writes the server-resolved tenant settings envelope through
// /api/settings/tenant. Writes are Owner/Admin-only server-side.

import { useCallback, useEffect, useState } from "react";

import {
  CANCEL_APPROVAL_MODES,
  CANCEL_APPROVAL_MODE_LABEL,
  CANCEL_REQUESTER_POLICIES,
  CANCEL_REQUESTER_POLICY_LABEL,
  DEFAULT_CANCELLATION_SETTINGS,
  type CancelApprovalMode,
  type CancelRequesterPolicy,
  type CancellationSettings,
} from "@/lib/qne/service-jobs/cancellation";
import { getStoredToken } from "@/lib/qne/tokens";

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function CancellationSettingsCard({
  onNotify,
}: {
  onNotify: (kind: "ok" | "err", msg: string) => void;
}) {
  const [value, setValue] = useState<CancellationSettings>(DEFAULT_CANCELLATION_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/tenant", { headers: authHeaders() });
      const body = (await res.json().catch(() => ({}))) as {
        settings?: { cancellation?: CancellationSettings };
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Failed to load settings");
      setValue(body.settings?.cancellation ?? DEFAULT_CANCELLATION_SETTINGS);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/tenant", {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ area: "cancellation_policy", settings: { cancellation: value } }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to save settings");
      onNotify("ok", "Cancellation policy saved.");
      await load();
    } catch (e) {
      onNotify("err", e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Service Job Cancellation Policy
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        A reason is always mandatory. These rules are enforced on the server.
      </p>

      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Who may request cancellation
            </span>
            <select
              value={value.requesterPolicy}
              onChange={(e) =>
                setValue((v) => ({
                  ...v,
                  requesterPolicy: e.target.value as CancelRequesterPolicy,
                }))
              }
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground"
            >
              {CANCEL_REQUESTER_POLICIES.map((p) => (
                <option key={p} value={p}>
                  {CANCEL_REQUESTER_POLICY_LABEL[p]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Approval mode
            </span>
            <select
              value={value.approvalMode}
              onChange={(e) =>
                setValue((v) => ({ ...v, approvalMode: e.target.value as CancelApprovalMode }))
              }
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground"
            >
              {CANCEL_APPROVAL_MODES.map((m) => (
                <option key={m} value={m}>
                  {CANCEL_APPROVAL_MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}

      <div className="mt-4">
        <button
          type="button"
          onClick={save}
          disabled={saving || loading}
          className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Cancellation Policy"}
        </button>
      </div>
    </section>
  );
}
