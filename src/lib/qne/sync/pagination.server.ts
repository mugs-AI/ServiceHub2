// Reusable paginated Supabase loader.
//
// PostgREST silently caps any single `.select()` at the project's default
// row limit (1000). Every full-dataset loader in ServiceHub2 must page
// through the store until a short page is returned, keep tenant filtering
// on every page, and use deterministic ordering. Callers that expect a
// complete tenant dataset MUST route through `loadAllPaginated` (or use
// `assertNotTruncated` when a single-shot query is genuinely bounded).

export const DEFAULT_PAGE_SIZE = 1000;

export interface PaginatedFetchResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Load every row for a query in stable page-sized windows. `fetchPage`
 * receives the inclusive [from, to] range and MUST apply tenant filters
 * plus a deterministic `.order(...)` on every call. Stops when a page
 * comes back shorter than `pageSize`.
 */
export async function loadAllPaginated<T>(
  label: string,
  fetchPage: (from: number, to: number) => PromiseLike<PaginatedFetchResult<T>>,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  if (pageSize <= 0) throw new Error(`[${label}] pageSize must be > 0`);
  const rows: T[] = [];
  // Cap iterations so a broken fetchPage cannot infinite-loop the worker.
  const MAX_PAGES = 10_000;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) {
      throw new Error(`[${label}] paginated load failed: ${error.message}`);
    }
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) return rows;
  }
  throw new Error(`[${label}] paginated load exceeded ${MAX_PAGES} pages — aborting`);
}

/**
 * Fails loudly when a caller performs a single `.select().limit(N)` for a
 * dataset that is supposed to be complete and receives exactly N rows —
 * PostgREST cannot signal whether more rows exist beyond that boundary.
 * Use `loadAllPaginated` instead whenever the dataset is unbounded.
 */
export function assertNotTruncated(
  rowCount: number,
  pageLimit: number,
  label: string,
): void {
  if (rowCount >= pageLimit) {
    throw new Error(
      `[${label}] Dataset load may be truncated — received ${rowCount} rows at page limit ${pageLimit} without paginated continuation`,
    );
  }
}
