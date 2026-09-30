import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { MalaysiaDateInput } from "./MalaysiaDateInput";
import { useTabs } from "@/lib/tabs";
import {
  availableJobColumns,
  defaultJobRange,
  JOB_COLUMNS,
  JOB_PAGE_SIZES,
  jobCellValue,
  jobDetailsParams,
  parseJobDetailsQuery,
  type JobColumn,
  type JobDetailsQuery,
} from "@/lib/qne/inquiry/job-details";
import type { JobDetailsPage } from "@/lib/qne/inquiry/job-details.server";
import { useInquiryAccess } from "@/lib/qne/inquiry/use-inquiry-access";
import { inquiryRequest } from "@/lib/qne/inquiry/client";
import { malaysiaTodayIso } from "@/lib/qne/malaysia-date";

const control = "min-h-11 rounded-md border bg-background px-3 text-sm";
function initialQuery(): JobDetailsQuery {
  return {
    ...defaultJobRange(),
    q: "",
    dateField: "created_at",
    filters: {},
    page: 1,
    pageSize: 20,
    sort: "created_at",
    direction: "desc",
  };
}

export function JobDetailsInquiry() {
  const { access, error: accessError, reload, token, identity } = useInquiryAccess(),
    { openJobTab } = useTabs();
  const [draft, setDraft] = useState(initialQuery),
    [query, setQuery] = useState(initialQuery),
    [selected, setSelected] = useState(JOB_COLUMNS.filter((c) => c.default).map((c) => c.key));
  const [data, setData] = useState<JobDetailsPage | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [exportError, setExportError] = useState(""),
    [exporting, setExporting] = useState(false);
  const contextKey = `${token ?? ""}:${identity}`;
  const [appliedContext, setAppliedContext] = useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const hasApplied = appliedContext === contextKey;
  const exportController = useRef<AbortController | null>(null);
  const permitted = access ? availableJobColumns(access) : [],
    columns = permitted.filter((c) => selected.includes(c.key));
  useEffect(() => {
    exportController.current?.abort();
    setExporting(false);
    setData(null);
    if (!access?.can_view || !hasApplied) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void inquiryRequest(`/api/inquiries/job-details?${jobDetailsParams(query)}`, token, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((body) => {
        if (!controller.signal.aborted) setData(body);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Unable to load Jobs.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      exportController.current?.abort();
    };
  }, [access, query, token, hasApplied, refreshRevision]);
  useEffect(() => {
    if (!access) return;
    const allowed = availableJobColumns(access);
    const clean = (value: JobDetailsQuery): JobDetailsQuery => {
      const filters = Object.fromEntries(
        Object.entries(value.filters).filter(([key]) =>
          allowed.some((c) => c.key === key.replace(/__(from|to)$/, "")),
        ),
      );
      const sort = allowed.some((c) => c.key === value.sort && !c.noFilter)
        ? value.sort
        : "created_at";
      return Object.keys(filters).length === Object.keys(value.filters).length &&
        sort === value.sort
        ? value
        : { ...value, filters, sort, page: 1 };
    };
    setDraft(clean);
    setQuery(clean);
    setSelected((keys) => keys.filter((k) => allowed.some((c) => c.key === k)));
  }, [access]);
  const change = (patch: Partial<JobDetailsQuery>) =>
    setDraft((value) => ({ ...value, ...patch, page: 1 }));
  const filter = (key: string, value: string) =>
    setDraft((d) => ({ ...d, filters: { ...d.filters, [key]: value }, page: 1 }));
  const apply = () => {
    if (!access) return;
    try {
      setQuery(parseJobDetailsQuery(jobDetailsParams({ ...draft, page: 1 }), access));
      setAppliedContext(contextKey);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check your filters.");
    }
  };
  const exportExcel = async () => {
    if (!hasApplied || !access?.can_view || !data || loading) return;
    exportController.current?.abort();
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setExportError("");
    try {
      const response = await inquiryRequest(
        `/api/inquiries/job-details/export?${jobDetailsParams(query)}`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ columns: columns.map((c) => c.key) }),
          signal: controller.signal,
        },
      );
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `Job_Details_${malaysiaTodayIso()}.xlsx`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!controller.signal.aborted)
        setExportError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  };
  if (accessError)
    return (
      <div role="alert" className="space-y-3">
        <p>{accessError}</p>
        <button onClick={reload} className={control}>
          Retry
        </button>
      </div>
    );
  if (!access) return <p role="status">Checking inquiry access…</p>;
  if (!access.can_view)
    return (
      <div>
        <h1 className="text-2xl font-semibold">Job Details Inquiry</h1>
        <p className="mt-3">You do not have access to this inquiry.</p>
      </div>
    );
  const effective = data?.access ?? access,
    safeColumns = columns.filter(
      (c) =>
        !c.sensitive ||
        (c.sensitive === "private" ? effective.view_private_notes : effective.view_gps),
    ),
    pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / query.pageSize));
  return (
    <div className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Job Details Inquiry</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {effective.scope === "own" ? "Own Jobs · current Primary PIC" : "All company Jobs"} ·
            Malaysia time
          </p>
        </div>
        <button
          onClick={() => {
            reload();
            if (hasApplied) setRefreshRevision((v) => v + 1);
          }}
          className={control}
        >
          Refresh
        </button>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
        className="space-y-3 rounded-lg border bg-card p-3"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-semibold">
            Search
            <input
              className={`${control} mt-1 w-full`}
              value={draft.q}
              onChange={(e) => change({ q: e.target.value })}
              maxLength={160}
              placeholder="Job, customer or subject"
            />
          </label>
          <label className="text-xs font-semibold">
            Date field
            <select
              className={`${control} mt-1 w-full`}
              value={draft.dateField}
              onChange={(e) =>
                change({ dateField: e.target.value as JobDetailsQuery["dateField"] })
              }
            >
              <option value="created_at">Created</option>
              <option value="completed_at">Completed</option>
              <option value="scheduled_start_at">Scheduled</option>
            </select>
          </label>
          <MalaysiaDateInput
            id="inquiry-from"
            label="From"
            value={draft.from}
            onChange={(from) => change({ from })}
          />
          <MalaysiaDateInput
            id="inquiry-to"
            label="To"
            value={draft.to}
            onChange={(to) => change({ to })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={`${control} bg-primary text-primary-foreground`}>
            Apply filters
          </button>
          <button
            type="button"
            className={control}
            onClick={() => {
              const next = { ...initialQuery(), from: "", to: "" };
              setDraft(next);
            }}
          >
            Clear filters
          </button>
          <button
            type="button"
            className={control}
            onClick={() => {
              const next = initialQuery();
              setDraft(next);
            }}
          >
            Reset · 3 months
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Apply filters to update the grid. Excel uses the applied filters and selected columns,
          across all pages (maximum 10,000 Jobs).
        </p>
      </form>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <details className="max-w-full rounded-md border bg-card p-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Columns ({safeColumns.length})
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {permitted.map((c) => (
              <label key={c.key} className="flex min-h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(c.key)}
                  disabled={c.key === "job_number"}
                  onChange={(e) =>
                    setSelected((keys) =>
                      e.target.checked ? [...keys, c.key] : keys.filter((k) => k !== c.key),
                    )
                  }
                />
                {c.label}
              </label>
            ))}
          </div>
        </details>
        {access.can_export_excel && effective.can_export_excel && (
          <button
            className={control}
            disabled={exporting || loading || !data || !!error}
            onClick={() => void exportExcel()}
          >
            {exporting ? "Preparing Excel…" : "Export Excel"}
          </button>
        )}
      </div>
      {(error || exportError) && (
        <p
          role="alert"
          className="rounded-md border border-destructive p-3 text-sm text-destructive"
        >
          {error || exportError}
        </p>
      )}
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {loading
          ? "Loading Jobs…"
          : data
            ? `${data.total.toLocaleString()} Jobs · Page ${query.page} of ${pageCount}`
            : !hasApplied
              ? "Apply filters to load Jobs."
              : ""}
      </p>
      <div className="w-full min-w-0 overflow-x-auto rounded-lg border" data-testid="inquiry-grid">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted">
            <tr>
              {safeColumns.map((c) => (
                <th
                  key={c.key}
                  className="min-w-48 p-3 align-top"
                  scope="col"
                  aria-sort={
                    query.sort === c.key
                      ? query.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    disabled={c.noFilter}
                    className="min-h-9 text-left font-semibold"
                    onClick={() => {
                      const next: JobDetailsQuery = {
                        ...query,
                        page: 1,
                        sort: c.key,
                        direction:
                          query.sort === c.key && query.direction === "asc" ? "desc" : "asc",
                      };
                      setDraft((d) => ({ ...d, sort: next.sort, direction: next.direction }));
                      setQuery(next);
                    }}
                  >
                    {c.label}
                    {query.sort === c.key ? (query.direction === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                  <ColumnFilter column={c} filters={draft.filters} onChange={filter} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data &&
              !loading &&
              data.rows.map((row) => (
                <tr key={row.id} className="border-t hover:bg-accent/40">
                  {safeColumns.map((c) => (
                    <td
                      key={c.key}
                      className="max-w-80 whitespace-pre-wrap break-words p-3 align-top"
                    >
                      {c.key === "job_number" ? (
                        <button
                          className="min-h-9 font-semibold text-primary underline"
                          onClick={() => openJobTab(row.id, String(row.job_number ?? "Job"))}
                        >
                          {row.job_number}
                        </button>
                      ) : jobCellValue(row, c) === "" ? (
                        "—"
                      ) : (
                        jobCellValue(row, c)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && data?.rows.length === 0 && (
              <tr>
                <td colSpan={safeColumns.length} className="p-6 text-center text-muted-foreground">
                  No Jobs match the applied filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          Rows per page
          <select
            className={control}
            value={query.pageSize}
            onChange={(e) => {
              const pageSize = Number(e.target.value);
              setQuery((q) => ({ ...q, page: 1, pageSize }));
              setDraft((d) => ({ ...d, pageSize }));
            }}
          >
            {JOB_PAGE_SIZES.map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button
            className={control}
            disabled={loading || query.page <= 1}
            onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}
          >
            Previous
          </button>
          <button
            className={control}
            disabled={loading || !data || query.page >= pageCount}
            onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function ColumnFilter({
  column,
  filters,
  onChange,
}: {
  column: JobColumn;
  filters: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  if (column.noFilter)
    return <p className="text-xs font-normal text-muted-foreground">Latest visit</p>;
  if (column.kind === "date" || column.kind === "datetime")
    return (
      <div className="space-y-1 font-normal">
        <MalaysiaDateInput
          aria-label={`${column.label} from`}
          value={filters[`${column.key}__from`] ?? ""}
          onChange={(v) => onChange(`${column.key}__from`, v)}
        />
        <MalaysiaDateInput
          aria-label={`${column.label} to`}
          value={filters[`${column.key}__to`] ?? ""}
          onChange={(v) => onChange(`${column.key}__to`, v)}
        />
      </div>
    );
  const props = {
    "aria-label": `Filter ${column.label}`,
    className: `${control} w-full font-normal`,
    value: filters[column.key] ?? "",
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange(column.key, e.target.value),
  };
  return column.choices ? (
    <select {...props}>
      <option value="">All</option>
      {column.choices.map((v) => (
        <option key={v}>{v}</option>
      ))}
    </select>
  ) : (
    <input
      {...props}
      maxLength={160}
      inputMode={column.kind === "number" ? "numeric" : "text"}
      placeholder={column.kind === "number" ? "Equals" : "Contains"}
    />
  );
}
