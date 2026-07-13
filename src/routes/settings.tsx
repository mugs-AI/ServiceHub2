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
type CycleUnit = "day" | "month" | "year";

const TAB_LABEL: Record<TabKey, string> = {
  renewal: "Renewal Stock Mapping",
  adhoc: "Ad Hoc Stock Mapping",
};

interface MappingSummary {
  service_type: string;
  contract_days: number | null;
  subscription_category: string | null;
  renewal_cycle_value: number | null;
  renewal_cycle_unit: string | null;
  is_active: boolean;
}

interface SearchRow {
  stock_code: string;
  stock_name: string | null;
  description: string | null;
  is_active: boolean;
  mapping: MappingSummary | null;
}

interface ConfiguredRow {
  stock_code: string;
  stock_name: string | null;
  description: string | null;
  service_type: string;
  contract_days: number | null;
  subscription_category: string | null;
  renewal_cycle_value: number | null;
  renewal_cycle_unit: string | null;
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

interface CategoryRow {
  id: string;
  name: string;
  display_order: number;
  is_active: boolean;
  is_system: boolean;
  updated_at?: string;
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

function formatCycle(value: number | null, unit: string | null): string {
  if (!value || !unit) return "—";
  const plural = value === 1 ? unit : `${unit}s`;
  return `${value} ${plural}`;
}

function Settings() {
  const { session } = useSession();
  const tenant = session?.tenantCode ?? "—";
  const [tab, setTab] = useState<TabKey>("renewal");
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [categoriesReloadKey, setCategoriesReloadKey] = useState(0);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const bumpReload = useCallback(() => setReloadKey((k) => k + 1), []);
  const bumpCategories = useCallback(
    () => setCategoriesReloadKey((k) => k + 1),
    [],
  );
  const notify = useCallback(
    (kind: "ok" | "err", msg: string) => setToast({ kind, msg }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/settings/subscription-categories");
        const json = (await res.json()) as { rows?: CategoryRow[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setCategories(json.rows ?? []);
      } catch (err) {
        if (!cancelled) notify("err", err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [categoriesReloadKey, notify]);

  const activeCategories = categories.filter((c) => c.is_active);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure how N3 Stock Codes drive renewable services for this Client
          (<span className="font-mono">{tenant}</span>). Renewal mappings assign
          a Subscription Category (e.g. Maintenance, Hosting, N3 Subscription)
          and a Renewal Cycle. Ad Hoc mappings mark service-only items. Changes
          mark related snapshots stale — recalculate from the{" "}
          <Link to="/admin/snapshots" className="underline">
            Snapshot Console
          </Link>
          .
        </p>
      </div>

      <SubscriptionCategoriesPanel
        rows={categories}
        onChanged={(msg) => {
          notify("ok", msg);
          bumpCategories();
        }}
        onError={(msg) => notify("err", msg)}
      />

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
        categories={activeCategories}
        reloadKey={reloadKey}
        onSaved={(msg) => {
          notify("ok", msg);
          bumpReload();
        }}
        onError={(msg) => notify("err", msg)}
      />

      <ConfiguredMappings
        tab={tab}
        categories={activeCategories}
        reloadKey={reloadKey}
        onChange={(msg) => {
          notify("ok", msg);
          bumpReload();
        }}
        onError={(msg) => notify("err", msg)}
      />

      <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3 text-sm">
        <span className="text-muted-foreground">
          After mapping changes, recalculate snapshots from the Snapshot Console.
        </span>
        <Link
          to="/admin/snapshots"
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Open Snapshot Console
        </Link>
      </div>

      <AdminAllowlistPanel />
    </div>
  );
}

// -------- Subscription Categories --------

function SubscriptionCategoriesPanel({
  rows,
  onChanged,
  onError,
}: {
  rows: CategoryRow[];
  onChanged: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await authFetch("/api/settings/subscription-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setNewName("");
      onChanged(`Added category "${name}".`);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row: CategoryRow) => {
    try {
      const res = await authFetch("/api/settings/subscription-categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, is_active: !row.is_active }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      onChanged(`${row.is_active ? "Disabled" : "Enabled"} "${row.name}".`);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (row: CategoryRow) => {
    if (row.is_system) return;
    if (!confirm(`Remove category "${row.name}"?`)) return;
    try {
      const res = await authFetch(
        `/api/settings/subscription-categories?id=${encodeURIComponent(row.id)}`,
        { method: "DELETE" },
      );
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      onChanged(`Removed "${row.name}".`);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">Subscription Categories</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Categories group renewable services. Every Renewal mapping is assigned
        to one category. System categories can be disabled but not deleted.
      </p>

      <form onSubmit={add} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          className="w-72 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !newName.trim()}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Add category
        </button>
      </form>

      <div className="mt-3 overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-3 text-xs text-muted-foreground">
                  No categories yet — defaults will appear on first load.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.is_system ? "System" : "Custom"}
                  </td>
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
                      <button
                        onClick={() => toggle(r)}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      >
                        {r.is_active ? "Disable" : "Enable"}
                      </button>
                      <button
                        onClick={() => remove(r)}
                        disabled={r.is_system}
                        className="rounded-md border px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// -------- Mapping search + save --------

interface PendingRenewal {
  category: string;
  cycleValue: number;
  cycleUnit: CycleUnit;
}

function MappingTab({
  tab,
  categories,
  reloadKey,
  onSaved,
  onError,
}: {
  tab: TabKey;
  categories: CategoryRow[];
  reloadKey: number;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [meta, setMeta] = useState<{
    tooShort: boolean;
    hasMore: boolean;
    tenantHasSnapshots: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState<Record<string, PendingRenewal>>({});
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
        const res = await authFetch(`/api/settings/stock-mappings?${params}`);
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

  const getPending = (r: SearchRow): PendingRenewal => {
    if (pending[r.stock_code]) return pending[r.stock_code];
    const m = r.mapping;
    return {
      category: m?.subscription_category ?? categories[0]?.name ?? "",
      cycleValue: m?.renewal_cycle_value ?? 1,
      cycleUnit: ((m?.renewal_cycle_unit as CycleUnit) ?? "year"),
    };
  };

  const updatePending = (code: string, patch: Partial<PendingRenewal>) => {
    setPending((prev) => ({
      ...prev,
      [code]: { ...getPendingForCode(prev[code], code), ...patch },
    }));
  };

  const getPendingForCode = (
    existing: PendingRenewal | undefined,
    _code: string,
  ): PendingRenewal =>
    existing ?? {
      category: categories[0]?.name ?? "",
      cycleValue: 1,
      cycleUnit: "year",
    };

  const save = async (row: SearchRow) => {
    setSavingCode(row.stock_code);
    try {
      const body: Record<string, unknown> = {
        stock_code: row.stock_code,
        service_type: tab,
      };
      if (tab === "renewal") {
        const p = getPending(row);
        if (!p.category) {
          onError("Select a Subscription Category before saving.");
          setSavingCode(null);
          return;
        }
        if (!Number.isInteger(p.cycleValue) || p.cycleValue < 1) {
          onError("Renewal Cycle Value must be a whole number ≥ 1.");
          setSavingCode(null);
          return;
        }
        body.subscription_category = p.category;
        body.renewal_cycle_value = p.cycleValue;
        body.renewal_cycle_unit = p.cycleUnit;
        // Legacy: also send days when unit === "day".
        if (p.cycleUnit === "day") body.contract_days = p.cycleValue;
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
          first from the{" "}
          <Link to="/admin/snapshots" className="underline">
            Snapshot Console
          </Link>
          .
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
                <th className="px-3 py-2 text-left">Current Mapping</th>
                {tab === "renewal" && (
                  <>
                    <th className="px-3 py-2 text-left">Category</th>
                    <th className="px-3 py-2 text-left">Renewal Cycle</th>
                  </>
                )}
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
                const p = tab === "renewal" ? getPending(r) : null;
                return (
                  <tr key={r.stock_code} className="border-t align-top">
                    <td className="px-3 py-2 font-mono text-xs">{r.stock_code}</td>
                    <td className="px-3 py-2">
                      <div>
                        {r.stock_name ?? <span className="text-muted-foreground">—</span>}
                      </div>
                      {r.description && r.description !== r.stock_name && (
                        <div className="text-xs text-muted-foreground">{r.description}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isThisType ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {currentType}
                          {r.mapping?.subscription_category
                            ? ` · ${r.mapping.subscription_category}`
                            : ""}
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
                    {tab === "renewal" && p && (
                      <>
                        <td className="px-3 py-2">
                          <select
                            value={p.category}
                            onChange={(e) =>
                              updatePending(r.stock_code, { category: e.target.value })
                            }
                            className="w-48 rounded-md border bg-background px-2 py-1 text-sm"
                          >
                            {categories.length === 0 && (
                              <option value="">No categories</option>
                            )}
                            {categories.map((c) => (
                              <option key={c.id} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={p.cycleValue}
                              onChange={(e) =>
                                updatePending(r.stock_code, {
                                  cycleValue: parseInt(e.target.value, 10) || 0,
                                })
                              }
                              className="w-20 rounded-md border bg-background px-2 py-1 text-sm"
                            />
                            <select
                              value={p.cycleUnit}
                              onChange={(e) =>
                                updatePending(r.stock_code, {
                                  cycleUnit: e.target.value as CycleUnit,
                                })
                              }
                              className="rounded-md border bg-background px-2 py-1 text-sm"
                            >
                              <option value="day">Day</option>
                              <option value="month">Month</option>
                              <option value="year">Year</option>
                            </select>
                          </div>
                        </td>
                      </>
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

// -------- Configured mappings list --------

function ConfiguredMappings({
  tab,
  categories,
  reloadKey,
  onChange,
  onError,
}: {
  tab: TabKey;
  categories: CategoryRow[];
  reloadKey: number;
  onChange: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [rows, setRows] = useState<ConfiguredRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState<string>("");
  const [editCycleValue, setEditCycleValue] = useState<number>(1);
  const [editCycleUnit, setEditCycleUnit] = useState<CycleUnit>("year");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(
        `/api/settings/stock-mappings?mode=configured&type=${tab}`,
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
    if (!editCategory) {
      onError("Select a Subscription Category.");
      return;
    }
    if (!Number.isInteger(editCycleValue) || editCycleValue < 1) {
      onError("Renewal Cycle Value must be a whole number ≥ 1.");
      return;
    }
    const body: Record<string, unknown> = {
      stock_code: row.stock_code,
      service_type: "renewal",
      subscription_category: editCategory,
      renewal_cycle_value: editCycleValue,
      renewal_cycle_unit: editCycleUnit,
    };
    if (editCycleUnit === "day") body.contract_days = editCycleValue;
    const res = await authFetch("/api/settings/stock-mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
          (r.stock_name ?? "").toLowerCase().includes(f) ||
          (r.subscription_category ?? "").toLowerCase().includes(f)
        );
      })
    : rows;

  const colspan = tab === "renewal" ? 6 : 4;

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
              {tab === "renewal" && (
                <>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-left">Renewal Cycle</th>
                </>
              )}
              <th className="px-3 py-2 text-left">Active</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colspan} className="px-3 py-3 text-xs text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={colspan} className="px-3 py-3 text-xs text-muted-foreground">
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
                      <>
                        <td className="px-3 py-2">
                          {editing ? (
                            <select
                              value={editCategory}
                              onChange={(e) => setEditCategory(e.target.value)}
                              className="w-40 rounded-md border bg-background px-2 py-1 text-sm"
                            >
                              {categories.map((c) => (
                                <option key={c.id} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            r.subscription_category ?? (
                              <span className="text-muted-foreground">—</span>
                            )
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {editing ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={1}
                                value={editCycleValue}
                                onChange={(e) =>
                                  setEditCycleValue(parseInt(e.target.value, 10) || 0)
                                }
                                className="w-20 rounded-md border bg-background px-2 py-1 text-sm"
                              />
                              <select
                                value={editCycleUnit}
                                onChange={(e) =>
                                  setEditCycleUnit(e.target.value as CycleUnit)
                                }
                                className="rounded-md border bg-background px-2 py-1 text-sm"
                              >
                                <option value="day">Day</option>
                                <option value="month">Month</option>
                                <option value="year">Year</option>
                              </select>
                            </div>
                          ) : (
                            formatCycle(r.renewal_cycle_value, r.renewal_cycle_unit)
                          )}
                        </td>
                      </>
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
                                setEditCategory(
                                  r.subscription_category ?? categories[0]?.name ?? "",
                                );
                                setEditCycleValue(r.renewal_cycle_value ?? 1);
                                setEditCycleUnit(
                                  ((r.renewal_cycle_unit as CycleUnit) ?? "year"),
                                );
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

// -------- Emergency Administrator Fallback --------

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
