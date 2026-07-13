import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { AdminOnly } from "@/components/qne/AdminOnly";
import { useSession } from "@/lib/qne/session-context";
import { getStoredToken } from "@/lib/qne/tokens";

export const Route = createFileRoute("/settings")({
  component: () => (
    <AdminOnly>
      <Settings />
    </AdminOnly>
  ),
});

type TabKey = "renewal" | "adhoc";

const TAB_LABEL: Record<TabKey, string> = {
  renewal: "Renewal Stock Mapping",
  adhoc: "Ad Hoc Stock Mapping",
};

interface SearchRow {
  stock_code: string;
  stock_name: string | null;
  description: string | null;
  is_active: boolean;
  mapping: {
    service_type: string;
    contract_days: number | null;
    is_active: boolean;
  } | null;
}

interface ConfiguredRow {
  stock_code: string;
  stock_name: string | null;
  description: string | null;
  service_type: string;
  contract_days: number | null;
  is_active: boolean;
  updated_at: string;
}

interface SearchResponse {
  query: string;
  tooShort: boolean;
  tenantHasSnapshots: boolean;
  rows: SearchRow[];
  hasMore: boolean;
  limit?: number;
  offset?: number;
}

async function authFetch(path: string, init: RequestInit = {}) {
  const token = getStoredToken();
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

function Settings() {
  const { session } = useSession();
  const tenant = session?.tenantCode ?? "—";
  const [tab, setTab] = useState<TabKey>("renewal");
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const bumpReload = useCallback(() => setReloadKey((k) => k + 1), []);
  const notify = useCallback(
    (kind: "ok" | "err", msg: string) => setToast({ kind, msg }),
    [],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure how N3 Stock Codes drive Service contracts for this Client
          (<span className="font-mono">{tenant}</span>). Renewal mappings define
          contract days; Ad Hoc mappings mark service-only items. Changes mark
          related contract snapshots stale — recalculate from the{" "}
          <Link to="/admin/snapshots" className="underline">
            Snapshot Console
          </Link>
          .
        </p>
      </div>

      <div className="flex gap-1 border-b">
        {(["renewal", "adhoc"] as TabKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === k
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABEL[k]}
          </button>
        ))}
      </div>

      {toast && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            toast.kind === "ok"
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {toast.msg}
        </div>
      )}

      <MappingTab
        key={tab}
        tab={tab}
        reloadKey={reloadKey}
        onSaved={(msg) => {
          notify("ok", msg);
          bumpReload();
        }}
        onError={(msg) => notify("err", msg)}
      />

      <ConfiguredMappings
        tab={tab}
        reloadKey={reloadKey}
        onChange={(msg) => {
          notify("ok", msg);
          bumpReload();
        }}
        onError={(msg) => notify("err", msg)}
      />

      <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3 text-sm">
        <span className="text-muted-foreground">
          After mapping changes, recalculate contracts from the Snapshot Console.
        </span>
        <Link
          to="/admin/snapshots"
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Recalculate Contracts
        </Link>
      </div>

      <AdminAllowlistPanel />
    </div>
  );
}

function MappingTab({
  tab,
  reloadKey,
  onSaved,
  onError,
}: {
  tab: TabKey;
  reloadKey: number;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [meta, setMeta] = useState<{ tooShort: boolean; hasMore: boolean; tenantHasSnapshots: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState<Record<string, number>>({}); // stock_code -> days input
  const [savingCode, setSavingCode] = useState<string | null>(null);

  const runSearch = useCallback(
    async (query: string, off: number, append: boolean) => {
      setBusy(true);
      try {
        const params = new URLSearchParams({
          mode: "search",
          q: query,
          limit: "50",
          offset: String(off),
        });
        const res = await fetch(`/api/settings/stock-mappings?${params}`, {
          headers: {
            ...(getStoredToken() ? { Authorization: `Bearer ${getStoredToken()}` } : {}),
          },
        });
        const json = (await res.json()) as SearchResponse & { error?: string };
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setMeta({
          tooShort: json.tooShort,
          hasMore: json.hasMore,
          tenantHasSnapshots: json.tenantHasSnapshots,
        });
        setRows((prev) => (append ? [...prev, ...json.rows] : json.rows));
        setOffset(off + json.rows.length);
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [onError],
  );

  // Re-run current query when reloadKey changes (e.g. after save) so mapping badges refresh.
  useEffect(() => {
    if (submittedQ.length >= 2) void runSearch(submittedQ, 0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = q.trim();
    setSubmittedQ(trimmed);
    if (trimmed.length < 2) {
      setRows([]);
      setMeta({ tooShort: true, hasMore: false, tenantHasSnapshots: true });
      return;
    }
    void runSearch(trimmed, 0, false);
  };

  const save = async (row: SearchRow) => {
    setSavingCode(row.stock_code);
    try {
      const body: Record<string, unknown> = {
        stock_code: row.stock_code,
        service_type: tab,
      };
      if (tab === "renewal") {
        const days = pending[row.stock_code] ?? row.mapping?.contract_days ?? 0;
        if (!Number.isInteger(days) || days < 1) {
          onError("Enter a whole number of days (≥ 1) before saving.");
          setSavingCode(null);
          return;
        }
        body.contract_days = days;
      }
      const res = await authFetch("/api/settings/stock-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      onSaved(`Saved mapping for ${row.stock_code}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingCode(null);
    }
  };

  return (
    <section className="space-y-3">
      <form onSubmit={onSearch} className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by Stock Code or Stock Name"
          className="w-96 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Searching…" : "Search"}
        </button>
        <span className="text-xs text-muted-foreground">
          Searches this Client's Stock Snapshots. Minimum 2 characters.
        </span>
      </form>

      {meta && !meta.tenantHasSnapshots && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Stock snapshots are empty for this Client. Run Stock Snapshot Sync
          first from the <Link to="/admin/snapshots" className="underline">Snapshot Console</Link>.
        </p>
      )}
      {meta?.tooShort && submittedQ.length > 0 && (
        <p className="text-xs text-muted-foreground">Enter at least 2 characters.</p>
      )}
      {meta && !meta.tooShort && rows.length === 0 && meta.tenantHasSnapshots && (
        <p className="text-sm text-muted-foreground">
          No Stock Code or Stock Name matches this search.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Stock Code</th>
                <th className="px-3 py-2 text-left">Stock Name</th>
                <th className="px-3 py-2 text-left">Mapping Type</th>
                {tab === "renewal" && <th className="px-3 py-2 text-left">Contract Days</th>}
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const currentType = r.mapping?.service_type ?? null;
                const isThisType =
                  (tab === "renewal" && currentType === "Renewal") ||
                  (tab === "adhoc" && currentType === "Ad Hoc");
                const otherType =
                  currentType &&
                  ((tab === "renewal" && currentType !== "Renewal") ||
                    (tab === "adhoc" && currentType !== "Ad Hoc"));
                const daysValue =
                  pending[r.stock_code] ??
                  (isThisType ? r.mapping?.contract_days ?? 365 : 365);
                return (
                  <tr key={r.stock_code} className="border-t align-top">
                    <td className="px-3 py-2 font-mono text-xs">{r.stock_code}</td>
                    <td className="px-3 py-2">
                      <div>{r.stock_name ?? <span className="text-muted-foreground">—</span>}</div>
                      {r.description && r.description !== r.stock_name && (
                        <div className="text-xs text-muted-foreground">{r.description}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isThisType ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {currentType}
                        </span>
                      ) : otherType ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                          Currently {currentType} — saving will change to{" "}
                          {tab === "renewal" ? "Renewal" : "Ad Hoc"}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not mapped</span>
                      )}
                    </td>
                    {tab === "renewal" && (
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={daysValue}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10);
                            setPending((p) => ({
                              ...p,
                              [r.stock_code]: Number.isFinite(n) ? n : 0,
                            }));
                          }}
                          className="w-24 rounded-md border bg-background px-2 py-1 text-sm"
                        />
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => save(r)}
                        disabled={savingCode === r.stock_code}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {savingCode === r.stock_code ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {meta?.hasMore && (
        <div>
          <button
            onClick={() => void runSearch(submittedQ, offset, true)}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            Load more
          </button>
        </div>
      )}
    </section>
  );
}

function ConfiguredMappings({
  tab,
  reloadKey,
  onChange,
  onError,
}: {
  tab: TabKey;
  reloadKey: number;
  onChange: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [rows, setRows] = useState<ConfiguredRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editDays, setEditDays] = useState<number>(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/settings/stock-mappings?mode=configured&type=${tab}`,
        {
          headers: {
            ...(getStoredToken() ? { Authorization: `Bearer ${getStoredToken()}` } : {}),
          },
        },
      );
      const json = (await res.json()) as { rows?: ConfiguredRow[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setRows(json.rows ?? []);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tab, onError]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const saveEdit = async (row: ConfiguredRow) => {
    if (!Number.isInteger(editDays) || editDays < 1) {
      onError("Contract Days must be a whole number ≥ 1.");
      return;
    }
    const res = await authFetch("/api/settings/stock-mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stock_code: row.stock_code,
        service_type: "renewal",
        contract_days: editDays,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      onError(json.error ?? `HTTP ${res.status}`);
      return;
    }
    setEditingCode(null);
    onChange(`Updated ${row.stock_code}.`);
  };

  const toggleActive = async (row: ConfiguredRow) => {
    const res = await authFetch("/api/settings/stock-mappings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stock_code: row.stock_code, is_active: !row.is_active }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      onError(json.error ?? `HTTP ${res.status}`);
      return;
    }
    onChange(`${!row.is_active ? "Enabled" : "Disabled"} ${row.stock_code}.`);
  };

  const remove = async (row: ConfiguredRow) => {
    if (!confirm(`Remove mapping for ${row.stock_code}?`)) return;
    const res = await authFetch(
      `/api/settings/stock-mappings?stock_code=${encodeURIComponent(row.stock_code)}`,
      { method: "DELETE" },
    );
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      onError(json.error ?? `HTTP ${res.status}`);
      return;
    }
    onChange(`Removed ${row.stock_code}.`);
  };

  const filtered = filter.trim()
    ? rows.filter((r) => {
        const f = filter.trim().toLowerCase();
        return (
          r.stock_code.toLowerCase().includes(f) ||
          (r.stock_name ?? "").toLowerCase().includes(f)
        );
      })
    : rows;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Configured {tab === "renewal" ? "Renewal" : "Ad Hoc"} Mappings
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({rows.length})
          </span>
        </h2>
        {rows.length > 5 && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter configured…"
            className="w-64 rounded-md border bg-background px-3 py-1.5 text-sm"
          />
        )}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Stock Code</th>
              <th className="px-3 py-2 text-left">Stock Name</th>
              {tab === "renewal" && <th className="px-3 py-2 text-left">Contract Days</th>}
              <th className="px-3 py-2 text-left">Active</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-xs text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-xs text-muted-foreground">
                  No {tab === "renewal" ? "Renewal" : "Ad Hoc"} mappings configured
                  {filter && " for this filter"}.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const editing = editingCode === r.stock_code;
                return (
                  <tr key={r.stock_code} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{r.stock_code}</td>
                    <td className="px-3 py-2">
                      {r.stock_name ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    {tab === "renewal" && (
                      <td className="px-3 py-2">
                        {editing ? (
                          <input
                            type="number"
                            min={1}
                            value={editDays}
                            onChange={(e) => setEditDays(parseInt(e.target.value, 10) || 0)}
                            className="w-24 rounded-md border bg-background px-2 py-1 text-sm"
                          />
                        ) : (
                          r.contract_days
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.is_active
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {r.is_active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        {tab === "renewal" &&
                          (editing ? (
                            <>
                              <button
                                onClick={() => saveEdit(r)}
                                className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingCode(null)}
                                className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingCode(r.stock_code);
                                setEditDays(r.contract_days ?? 365);
                              }}
                              className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                            >
                              Edit
                            </button>
                          ))}
                        <button
                          onClick={() => toggleActive(r)}
                          className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                        >
                          {r.is_active ? "Disable" : "Enable"}
                        </button>
                        <button
                          onClick={() => remove(r)}
                          className="rounded-md border px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                        >
                          Remove
                        </button>
                      </div>
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

// -------- Emergency Administrator Fallback (unchanged; hidden by default) ----

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
  const [fallbackEnabled, setFallbackEnabled] = useState<boolean | null>(null);

  const call = async (path: string, init: RequestInit = {}) => authFetch(path, init);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call("/api/admin/allowlist");
      const json = (await res.json()) as {
        admins?: AllowlistEntry[];
        error?: string;
        fallbackEnabled?: boolean;
      };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setRows(json.admins ?? []);
      setFallbackEnabled(Boolean(json.fallbackEnabled));
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

  if (fallbackEnabled === false) return null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    const res = await call("/api/admin/allowlist", {
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
    const res = await call(
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
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          Emergency Administrator Fallback
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          ServiceHub administration is granted to the current N3 company Owner.
          This allowlist is an emergency fallback, active only while{" "}
          <code className="mx-1 rounded bg-muted px-1">SERVICEHUB_ALLOWLIST_FALLBACK=1</code>
          is set.
        </p>
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
              <tr>
                <td colSpan={4} className="px-3 py-3 text-xs text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-3 text-xs text-muted-foreground">
                  No administrators yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const isSelf =
                  r.email.toLowerCase() === (currentUser?.email ?? "").toLowerCase();
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
