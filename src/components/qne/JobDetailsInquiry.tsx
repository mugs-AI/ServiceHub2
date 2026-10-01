import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { MalaysiaDateInput } from "./MalaysiaDateInput";
import { useTabs } from "@/lib/tabs";
import {
  availableJobColumns,
  JOB_PAGE_SIZES,
  jobCellValue,
  jobDetailsParams,
  parseJobDetailsQuery,
  type JobColumn,
  type JobDetailsQuery,
} from "@/lib/qne/inquiry/job-details";
import { useInquiryView } from "@/lib/qne/inquiry/InquiryViewProvider";
import { normalizeInquiryPreferences, orderedJobColumns } from "@/lib/qne/inquiry/preferences";
import { inquiryRequest } from "@/lib/qne/inquiry/client";
import { malaysiaTodayIso } from "@/lib/qne/malaysia-date";

const control = "min-h-11 rounded-md border bg-background px-3 text-sm";
export function JobDetailsInquiry() {
  const view = useInquiryView(),
    {
      access,
      accessError,
      reloadAccess: reload,
      token,
      identityKey,
      snapshot,
      update,
      loading,
      apply: applyQuery,
      clear,
    } = view;
  const { openJobTab } = useTabs();
  const {
    draft,
    query,
    selectedColumns: selected,
    columnOrder,
    data,
    hasApplied,
    stale,
  } = snapshot;
  const [validationError, setError] = useState(""),
    [exportError, setExportError] = useState(""),
    [exporting, setExporting] = useState(false);
  const error = validationError || view.error;
  const exportController = useRef<AbortController | null>(null);
  const permitted = access ? availableJobColumns(access) : [],
    columns = access ? orderedJobColumns(access, selected, columnOrder) : [];
  const setDraft = (next: JobDetailsQuery | ((d: JobDetailsQuery) => JobDetailsQuery)) =>
    update({ draft: typeof next === "function" ? next(draft) : next });
  const setQuery = (next: JobDetailsQuery | ((q: JobDetailsQuery) => JobDetailsQuery)) =>
    update({ query: typeof next === "function" ? next(query) : next });
  const setSelected = (next: string[] | ((keys: string[]) => string[])) =>
    update({ selectedColumns: typeof next === "function" ? next(selected) : next });
  useEffect(() => {
    exportController.current?.abort();
    setExporting(false);
    setExportError("");
    setError("");
    return () => {
      exportController.current?.abort();
    };
  }, [identityKey, access]);
  const mountedScroll = useRef(snapshot.scrollY);
  const scrollIdentity = useRef(identityKey);
  if (scrollIdentity.current !== identityKey) {
    scrollIdentity.current = identityKey;
    mountedScroll.current = 0;
  }
  useLayoutEffect(() => {
    const restoreY = mountedScroll.current;
    let y = restoreY;
    let departureScroll: number | null = null;
    const departing = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("a[href], button[title^='/jobs/'], [data-inquiry-job-link]")
      )
        departureScroll = window.scrollY;
    };
    document.addEventListener("click", departing, true);
    const frame = requestAnimationFrame(() => window.scrollTo(0, restoreY));
    const track = () => {
      y = window.scrollY;
    };
    window.addEventListener("scroll", track, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", track);
      document.removeEventListener("click", departing, true);
      update({ scrollY: departureScroll ?? y });
    };
  }, [identityKey, update]);
  const change = (patch: Partial<JobDetailsQuery>) =>
    setDraft((d) => ({ ...d, ...patch, page: 1 }));
  const filter = (key: string, value: string) =>
    setDraft((d) => ({ ...d, filters: { ...d.filters, [key]: value }, page: 1 }));
  const apply = () => {
    if (!access) return;
    try {
      applyQuery(parseJobDetailsQuery(jobDetailsParams({ ...draft, page: 1 }), access));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check your filters.");
    }
  };
  const reset = (all: boolean) => {
    if (!access) return;
    const defaults = normalizeInquiryPreferences(null, access);
    clear();
    const next = all ? defaults.draft : { ...defaults.draft, from: "", to: "" };
    update({
      draft: next,
      query: next,
      ...(all
        ? { selectedColumns: defaults.selectedColumns, columnOrder: defaults.columnOrder }
        : {}),
    });
    setError("");
    setExportError("");
  };
  const moveColumn = (key: string, direction: number) => {
    const order = orderedJobColumns(
        access!,
        permitted.map((c) => c.key),
        columnOrder,
      ).map((c) => c.key),
      index = order.indexOf(key),
      target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    update({ columnOrder: order });
  };
  const exportExcel = async () => {
    if (!hasApplied || !access?.can_export_excel || !data || loading || columns.length === 0)
      return;
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
            if (hasApplied) applyQuery(query);
          }}
          className={control}
        >
          Refresh
        </button>
      </header>
      {stale && (
        <p role="status" className="rounded-md border bg-amber-50 p-3 text-sm">
          Job changes are available. Use Refresh to update these results.
        </p>
      )}
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
          <button type="button" className={control} onClick={() => reset(false)}>
            Clear filters
          </button>
          <button type="button" className={control} onClick={() => reset(true)}>
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
            {(access
              ? orderedJobColumns(
                  access,
                  permitted.map((c) => c.key),
                  columnOrder,
                )
              : []
            ).map((c, index) => (
              <div key={c.key} className="flex min-w-0 items-center gap-1">
                <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(c.key)}
                    onChange={(e) =>
                      setSelected((keys) =>
                        e.target.checked ? [...keys, c.key] : keys.filter((k) => k !== c.key),
                      )
                    }
                  />
                  {c.label}
                </label>
                <button
                  type="button"
                  aria-label={`Move ${c.label} up`}
                  className="min-h-11 min-w-11 rounded border disabled:opacity-40"
                  disabled={index === 0}
                  onClick={() => moveColumn(c.key, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${c.label} down`}
                  className="min-h-11 min-w-11 rounded border disabled:opacity-40"
                  disabled={index === permitted.length - 1}
                  onClick={() => moveColumn(c.key, 1)}
                >
                  ↓
                </button>
              </div>
            ))}
          </div>
        </details>
        {access.can_export_excel && effective.can_export_excel && (
          <button
            className={control}
            disabled={
              exporting || loading || !data || !!error || !hasApplied || safeColumns.length === 0
            }
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
      {safeColumns.length === 0 && (
        <p role="status">Choose at least one column to display Jobs and export Excel.</p>
      )}
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
                    className="min-h-11 text-left font-semibold"
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
              safeColumns.length > 0 &&
              data.rows.map((row) => (
                <tr key={row.id} className="border-t hover:bg-accent/40">
                  {safeColumns.map((c) => (
                    <td
                      key={c.key}
                      className="max-w-80 whitespace-pre-wrap break-words p-3 align-top"
                    >
                      {c.key === "job_number" ? (
                        <button
                          data-inquiry-job-link
                          className="min-h-11 font-semibold text-primary underline"
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
            disabled={loading || !hasApplied || query.page <= 1}
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
