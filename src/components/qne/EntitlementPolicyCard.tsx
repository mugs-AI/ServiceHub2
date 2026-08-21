// Owner/Admin Entitlement Policy card — Due Soon Window (whole days).
// Reads/writes /api/settings/entitlement-policy. The server remains the
// authority for tenant, validation and classification.

import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_DUE_SOON_DAYS,
  DUE_SOON_RANGE_MESSAGE,
  MAX_DUE_SOON_DAYS,
  MIN_DUE_SOON_DAYS,
  isValidDueSoonDays,
} from "@/lib/qne/entitlements/due-soon-policy";
import { getStoredToken } from "@/lib/qne/tokens";

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function EntitlementPolicyCard({
  onNotify,
}: {
  onNotify: (kind: "ok" | "err", msg: string) => void;
}) {
  const [saved, setSaved] = useState<number>(DEFAULT_DUE_SOON_DAYS);
  const [draft, setDraft] = useState<string>(String(DEFAULT_DUE_SOON_DAYS));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/entitlement-policy", { headers: authHeaders() });
      const body = (await res.json().catch(() => ({}))) as {
        dueSoonDays?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Failed to load entitlement policy");
      const value = isValidDueSoonDays(body.dueSoonDays)
        ? body.dueSoonDays
        : DEFAULT_DUE_SOON_DAYS;
      setSaved(value);
      setDraft(String(value));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load entitlement policy");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const trimmed = draft.trim();
    const parsed = /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
    if (!isValidDueSoonDays(parsed)) {
      setInvalid(DUE_SOON_RANGE_MESSAGE);
      return;
    }
    setInvalid(null);
    setSaving(true);
    try {
      const res = await fetch("/api/settings/entitlement-policy", {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ dueSoonDays: parsed }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        dueSoonDays?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Failed to save entitlement policy");
      // Show the persisted value returned by the server, not the local draft.
      const persisted = isValidDueSoonDays(body.dueSoonDays) ? body.dueSoonDays : parsed;
      setSaved(persisted);
      setDraft(String(persisted));
      setErr(null);
      onNotify("ok", `Due Soon Window saved — ${persisted} day(s).`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save entitlement policy";
      setErr(msg);
      onNotify("err", msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Entitlement Policy
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Entitlements become Due Soon when they are within this many Malaysia
        calendar days of expiry. Expired entitlements are always Overdue.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Changes take effect immediately. Snapshot recalculation is not required
        for the Due Soon boundary.
      </p>

      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Due Soon Window
            </span>
            <span className="mt-1 flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                step={1}
                min={MIN_DUE_SOON_DAYS}
                max={MAX_DUE_SOON_DAYS}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setInvalid(null);
                }}
                aria-label="Due Soon Window in days"
                className="w-28 rounded-md border bg-background px-3 py-2 text-sm text-foreground"
              />
              <span className="text-sm text-muted-foreground">days before expiry</span>
            </span>
          </label>

          <p className="text-xs text-muted-foreground">
            Currently in effect: <span className="font-medium">{saved}</span> day(s).
          </p>

          {invalid && <p className="text-xs text-destructive">{invalid}</p>}
          {err && <p className="text-xs text-destructive">{err}</p>}

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Due Soon Window"}
          </button>
        </div>
      )}
    </section>
  );
}
