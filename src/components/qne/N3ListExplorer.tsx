import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { qneProxy } from "@/lib/qne/client";
import { unwrapPageList } from "@/lib/qne/envelope";
import type { ApiEnvelope, PageQueryResult } from "@/lib/qne/envelope";

interface Props {
  title: string;
  defaultPath: string; // e.g. "/api/customer"
  hint?: string;
  target?: "main" | "reporting";
  extraQuery?: Record<string, string | number>;
  /** Column keys to prioritise when the response fields are known. */
  preferredColumns?: string[];
}

/**
 * Generic paged list explorer for N3 Open API endpoints. Renders whatever
 * columns the response contains so it works across scopes without
 * hard-coding a schema. Path can be overridden from the UI while exploring.
 */
export function N3ListExplorer({
  title,
  defaultPath,
  hint,
  target = "main",
  extraQuery,
  preferredColumns,
}: Props) {
  const [path, setPath] = useState(defaultPath);
  const [search, setSearch] = useState("");
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    setPageNo(1);
  }, [path, search, pageSize]);

  const query = useQuery({
    queryKey: ["n3-list", target, path, search, pageNo, pageSize, extraQuery],
    queryFn: async () => {
      const env = await qneProxy<PageQueryResult<Record<string, unknown>>>(
        target,
        "GET",
        path,
        {
          query: {
            $top: pageSize,
            $skip: (pageNo - 1) * pageSize,
            ...(search ? { search } : {}),
            ...extraQuery,
          },
        },
      );
      // Some endpoints return a plain array in `data`; normalise.
      const anyEnv = env as ApiEnvelope<unknown>;
      if (Array.isArray(anyEnv.data)) {
        return { rows: anyEnv.data as Record<string, unknown>[], total: anyEnv.data.length };
      }
      return unwrapPageList(env);
    },
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;

  const columns = useMemo(() => {
    if (!rows.length) return [];
    const keys = new Set<string>();
    rows.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
    const all = Array.from(keys);
    if (preferredColumns?.length) {
      const known = preferredColumns.filter((k) => all.includes(k));
      const rest = all.filter((k) => !known.includes(k));
      return [...known, ...rest].slice(0, 8);
    }
    return all.slice(0, 8);
  }, [rows, preferredColumns]);

  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground">Endpoint</label>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="w-72 rounded-md border bg-background px-2 py-1 text-sm font-mono"
          />
          <button
            type="button"
            onClick={() => query.refetch()}
            className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
          >
            Reload
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="w-64 rounded-md border bg-background px-3 py-1.5 text-sm"
        />
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="rounded-md border bg-background px-2 py-1 text-sm"
        >
          {[10, 20, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            disabled={pageNo <= 1}
            onClick={() => setPageNo((p) => Math.max(1, p - 1))}
            className="rounded-md border px-2 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            Page {pageNo} / {totalPages} · {total} total
          </span>
          <button
            type="button"
            disabled={pageNo >= totalPages}
            onClick={() => setPageNo((p) => p + 1)}
            className="rounded-md border px-2 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      {query.isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {query.isError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {(query.error as Error).message}
        </p>
      )}
      {!query.isLoading && !query.isError && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No rows returned.</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="px-3 py-2 text-left font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t">
                  {columns.map((c) => (
                    <td key={c} className="px-3 py-2 align-top">
                      {formatCell(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
