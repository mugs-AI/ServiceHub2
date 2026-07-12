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
      const { rows } = await qneGetList<Stock>("main", "/api/stock", {
        pageNo: 1,
        pageSize: 50,
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
    </div>
  );
}
