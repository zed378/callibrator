/**
 * P22-06 (ADR-126 § 8; `docs/UPSTREAM/09-REPORT-LAYOUTS.md` § 5) — an export reads its rows from the
 * paged API, never in one unbounded request, and says how big it is BEFORE it reads them all:
 *
 *  1. `measure` reads page 1 with `limit = 1`: `meta.total` is the size the page shows first;
 *  2. `readAll` reads the pages in order at `EXPORT_PAGE_SIZE` (the lists' maximum), reporting
 *     "rows read n / total" after each page, pausing `EXPORT_PAGE_PAUSE_MS` between pages (the
 *     list endpoints' rate limits still apply — the export paces itself rather than bursting), and
 *     stopping at once when its `AbortSignal` fires (Cancel).
 *
 * Every page is the caller's own read, so the server's scope applies to each one: a facility-bound
 * reader exports only its facility, and a facility filter only narrows (ADR-133 Am. 3 § 4).
 */

/** The lists' maximum page size (`limit` ≤ 200, P21-02a / P21-06). */
export const EXPORT_PAGE_SIZE = 200;
/** The pause between two pages. */
export const EXPORT_PAGE_PAUSE_MS = 150;
/** A hard ceiling on pages, so a server that never ends paging cannot loop forever (200 × 1,000 rows). */
export const EXPORT_MAX_PAGES = 1000;

export interface PageAnswer<T> {
  rows: T[];
  meta: { total: number; page: number; limit: number; totalPages: number } | null;
}

export type FetchPage<T> = (page: number, limit: number) => Promise<PageAnswer<T>>;

/** The export was cancelled by its user. */
export class ExportCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "ExportCancelled";
  }
}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new ExportCancelled();
};

const pause = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ExportCancelled());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** How many rows the export will hold (one row read). */
export const measure = async <T>(fetchPage: FetchPage<T>): Promise<number> => {
  const first = await fetchPage(1, 1);
  return first.meta?.total ?? first.rows.length;
};

export interface ReadOptions {
  signal?: AbortSignal;
  onProgress?: (read: number, total: number) => void;
  pageSize?: number;
  pauseMs?: number;
}

/** Every row, page by page, in the server's order. */
export const readAll = async <T>(fetchPage: FetchPage<T>, options: ReadOptions = {}): Promise<T[]> => {
  const { signal, onProgress, pageSize = EXPORT_PAGE_SIZE, pauseMs = EXPORT_PAGE_PAUSE_MS } = options;
  const rows: T[] = [];
  let total = 0;
  for (let page = 1; page <= EXPORT_MAX_PAGES; page += 1) {
    throwIfAborted(signal);
    if (page > 1) await pause(pauseMs, signal);
    const answer = await fetchPage(page, pageSize);
    throwIfAborted(signal);
    rows.push(...answer.rows);
    total = answer.meta?.total ?? rows.length;
    onProgress?.(rows.length, total);
    const pages = answer.meta?.totalPages ?? 1;
    if (answer.rows.length === 0 || page >= pages) break;
  }
  return rows;
};

/**
 * Runs `work` over `items` with at most `limit` in flight (photo fetches), reporting each one done.
 * A failed item resolves to null (a photo that cannot be had prints as "-", never fails the export).
 */
export const mapLimited = async <T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
  options: { signal?: AbortSignal; onDone?: (done: number) => void } = {},
): Promise<(R | null)[]> => {
  const results: (R | null)[] = new Array<R | null>(items.length).fill(null);
  let next = 0;
  let done = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      throwIfAborted(options.signal);
      const index = next;
      next += 1;
      try {
        results[index] = await work(items[index] as T);
      } catch {
        results[index] = null;
      }
      done += 1;
      options.onDone?.(done);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  throwIfAborted(options.signal);
  return results;
};

/** Hands bytes to the browser as a download; the Blob URL is released a minute later. */
export const downloadBytes = (bytes: BlobPart, fileName: string, type: string): void => {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
};
