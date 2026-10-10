/** @jest-environment jsdom */
/**
 * P22-06 — the paged reads behind every export (09 § 5): the size from one row first; every page in
 * order at the lists' maximum, with progress after each; a pause between pages; Cancel before a
 * page, during the pause and after a page; a page ceiling; a bounded number of photo fetches in
 * flight, a failed one as null; the download as a Blob URL released later.
 */
import { EXPORT_MAX_PAGES, EXPORT_PAGE_SIZE, ExportCancelled, downloadBytes, mapLimited, measure, readAll, type PageAnswer } from "./pagedRead";

const pages = (total: number, limitSeen: number[] = []) => async (page: number, limit: number): Promise<PageAnswer<number>> => {
  limitSeen.push(limit);
  const start = (page - 1) * limit;
  const rows = Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, i) => start + i);
  return { rows, meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) } };
};

describe("P22-06 — paged reads", () => {
  it("measure reads one row and answers the total (or the rows when there is no meta)", async () => {
    const seen: number[] = [];
    expect(await measure(pages(450, seen))).toBe(450);
    expect(seen).toEqual([1]);
    expect(await measure(async () => ({ rows: [1, 2], meta: null }))).toBe(2);
  });

  it("readAll: every page in order at the maximum size, progress after each, a pause between pages", async () => {
    const seen: number[] = [];
    const progress: [number, number][] = [];
    const rows = await readAll(pages(450, seen), { onProgress: (d, t) => progress.push([d, t]), pauseMs: 1 });
    expect(rows).toHaveLength(450);
    expect(rows[449]).toBe(449);
    expect(seen).toEqual([EXPORT_PAGE_SIZE, EXPORT_PAGE_SIZE, EXPORT_PAGE_SIZE]);
    expect(progress).toEqual([
      [200, 450],
      [400, 450],
      [450, 450],
    ]);
  });

  it("stops on an empty page, on a missing meta, and at the page ceiling", async () => {
    expect(await readAll(async () => ({ rows: [], meta: { total: 9, page: 1, limit: 200, totalPages: 9 } }))).toEqual([]);
    expect(await readAll(async () => ({ rows: [1], meta: null }), { pauseMs: 0 })).toEqual([1]);
    let calls = 0;
    const endless = async () => {
      calls += 1;
      return { rows: [calls], meta: { total: 1e9, page: calls, limit: 1, totalPages: 1e9 } };
    };
    expect(await readAll(endless, { pauseMs: 0 })).toHaveLength(EXPORT_MAX_PAGES);
  });

  it("Cancel: before the first page, during the pause, and after a page", async () => {
    const before = new AbortController();
    before.abort();
    await expect(readAll(pages(10), { signal: before.signal })).rejects.toBeInstanceOf(ExportCancelled);

    const during = new AbortController();
    const reading = readAll(pages(450), { signal: during.signal, pauseMs: 10_000, onProgress: () => during.abort() });
    await expect(reading).rejects.toBeInstanceOf(ExportCancelled);

    const after = new AbortController();
    await expect(
      readAll(
        async (page, limit) => {
          after.abort();
          return pages(450)(page, limit);
        },
        { signal: after.signal },
      ),
    ).rejects.toThrow("cancelled");
  });

  it("mapLimited: at most `limit` in flight, results in order, a failure as null, progress per item, Cancel", async () => {
    let inFlight = 0;
    let most = 0;
    const done: number[] = [];
    const results = await mapLimited(
      [1, 2, 3, 4, 5, 6],
      2,
      async (n) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        if (n === 4) throw new Error("no photo");
        return n * 10;
      },
      { onDone: (d) => done.push(d) },
    );
    expect(results).toEqual([10, 20, 30, null, 50, 60]);
    expect(most).toBe(2);
    expect(done).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await mapLimited([], 4, async () => 1)).toEqual([]);
    const abort = new AbortController();
    await expect(
      mapLimited([1, 2, 3], 1, async (n) => {
        abort.abort();
        return n;
      }, { signal: abort.signal }),
    ).rejects.toBeInstanceOf(ExportCancelled);
  });

  it("downloadBytes hands a Blob URL to a clicked link and releases it a minute later", () => {
    jest.useFakeTimers();
    const create = jest.fn(() => "blob:x");
    const revoke = jest.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    downloadBytes(new Uint8Array([1]), "a.xlsx", "application/x");
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith("blob:x");
    click.mockRestore();
    jest.useRealTimers();
  });
});
