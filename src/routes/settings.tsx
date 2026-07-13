import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { AdminOnly } from "@/components/qne/AdminOnly";
import { qneGetList } from "@/lib/qne/client";
import { useSession } from "@/lib/qne/session-context";
import { getStoredToken } from "@/lib/qne/tokens";
import {
  loadStockMap,
  setMapping,
  type StockMap,
  type StockMappingType,
} from "@/lib/qne/stock-map";

export const Route = createFileRoute("/settings")({
  component: () => (
    <AdminOnly>
      <Settings />
    </AdminOnly>
  ),
});

interface Stock {
  code?: string;
  description?: string;
  [k: string]: unknown;
}

function Settings() {
  const { session } = useSession();
  const tenant = session?.tenantCode ?? "";
  const [map, setMap] = useState<StockMap>(() => loadStockMap(tenant));
  const [rows, setRows] = useState<Stock[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mappedCount = useMemo(() => Object.keys(map).length, [map]);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { rows } = await qneGetList<Stock>("main", "/api/Stocks/List", {
        $top: 50,
        $skip: 0,
        search: q,
      });
      setRows(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const update = (
    code: string,
    type: StockMappingType | "",
    days = 365,
  ) => {
    const next = setMapping(
      tenant,
      code,
      type === "" ? null : { type, ...(type === "maintenance" ? { durationDays: days } : {}) },
    );
    setMap({ ...next });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Mark N3 stock codes as <strong>Maintenance / Renewal</strong> (with a
          contract duration) or <strong>Ad-hoc Service</strong>. These mappings
          drive contract-status calculation in the Service Console. Settings are
          stored per tenant ({tenant || "—"}) in this browser.
          {" "}
          <span className="text-amber-700">
            Phase 2 will migrate this to Lovable Cloud with proper multi-tenant
            storage.
          </span>
        </p>
      </div>

      <div className="rounded-md border p-4">
        <div className="text-sm">
          <strong>{mappedCount}</strong> stock code(s) currently mapped for this tenant.
        </div>
      </div>

      <form onSubmit={search} className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search stock code / description…"
          className="w-80 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Search
        </button>
      </form>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Stock code</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-left">Mapping</th>
                <th className="px-3 py-2 text-left">Duration (days)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => {
                const code = String(s.code ?? "");
                const current = map[code];
                return (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{code}</td>
                    <td className="px-3 py-2">{String(s.description ?? "")}</td>
                    <td className="px-3 py-2">
                      <select
                        value={current?.type ?? ""}
                        onChange={(e) =>
                          update(
                            code,
                            e.target.value as StockMappingType | "",
                            current?.durationDays ?? 365,
                          )
                        }
                        className="rounded-md border bg-background px-2 py-1 text-xs"
                      >
                        <option value="">— none —</option>
                        <option value="maintenance">Maintenance / Renewal</option>
                        <option value="adhoc">Ad-hoc Service</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {current?.type === "maintenance" ? (
                        <input
                          type="number"
                          min={1}
                          value={current.durationDays ?? 365}
                          onChange={(e) =>
                            update(code, "maintenance", Number(e.target.value) || 365)
                          }
                          className="w-24 rounded-md border bg-background px-2 py-1 text-xs"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AdminAllowlistPanel />
    </div>
  );
}

interface AllowlistEntry {
  id: string;
  email: string;
  granted_by: string | null;
  is_bootstrap: boolean;
  created_at: string;
}

function AdminAllowlistPanel() {
  const { currentUser } = useSession();
  const [rows, setRows] = useState<AllowlistEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");

  const authFetch = async (path: string, init: RequestInit = {}) => {
    const token = getStoredToken();
    return fetch(path, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/admin/allowlist");
      const json = (await res.json()) as { admins?: AllowlistEntry[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setRows(json.admins ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    const res = await authFetch("/api/admin/allowlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail.trim() }),
    });
    if (res.ok) {
      setNewEmail("");
      await load();
    } else {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `HTTP ${res.status}`);
    }
  };

  const remove = async (email: string) => {
    if (!confirm(`Remove administrator access for ${email}?`)) return;
    const res = await authFetch(
      `/api/admin/allowlist?email=${encodeURIComponent(email)}`,
      { method: "DELETE" },
    );
    if (res.ok) await load();
    else {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `HTTP ${res.status}`);
    }
  };

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Administrator allowlist
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Interim gate — N3 does not yet expose an official role claim for
            ServiceHub. Only emails on this tenant-scoped allowlist can access
            Settings and Admin Tools. The first authenticated user of a tenant
            is auto-promoted as bootstrap administrator.
          </p>
        </div>
      </div>

      <form onSubmit={add} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="user@company.com"
          className="w-72 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Grant admin
        </button>
      </form>

      {error && (
        <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="mt-3 overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Source</th>
              <th className="px-3 py-2 text-left">Granted by</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-3 py-3 text-xs text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-3 text-xs text-muted-foreground">No administrators yet.</td></tr>
            ) : (
              rows.map((r) => {
                const isSelf = r.email.toLowerCase() === (currentUser?.email ?? "").toLowerCase();
                return (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.email}
                      {isSelf && (
                        <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                          You
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.is_bootstrap ? "bootstrap" : "allowlist"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.granted_by ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => remove(r.email)}
                        disabled={isSelf}
                        className="rounded-md border px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
