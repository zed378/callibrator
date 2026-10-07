/**
 * P24-06 — the SQL-dump import's API service against the contract
 * (backend/src/routes/api/admin.openapi.ts): the paths, the multipart upload
 * with its progress and its own long timeout, rows in `data` and pagination in
 * the top-level `meta`.
 */
import { api } from "../client";
import { upstreamSqlImportService } from "./upstreamSqlImport.service";

jest.mock("../client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mocked = api as jest.Mocked<typeof api>;
const BASE = "/api/v1/admin/upstream-sql-imports";
const ID = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
const ok = (data: unknown, meta?: unknown) => ({ success: true, status: 200, message: "ok", data, ...(meta ? { meta } : {}) });

describe("upstreamSqlImportService (P24-06)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reads the settings, a page of runs and one run", async () => {
    mocked.get.mockResolvedValueOnce(ok({ maxUploadBytes: 1, realDataAllowed: false }));
    expect(await upstreamSqlImportService.settings()).toEqual({ maxUploadBytes: 1, realDataAllowed: false });
    mocked.get.mockResolvedValueOnce(ok([{ id: ID }], { total: 1, page: 2, limit: 5, totalPages: 1 }));
    expect(await upstreamSqlImportService.list(2, 5)).toEqual({ rows: [{ id: ID }], meta: { total: 1, page: 2, limit: 5, totalPages: 1 } });
    expect(mocked.get).toHaveBeenLastCalledWith(BASE, { params: { page: 2, limit: 5 } });
    mocked.get.mockResolvedValueOnce({ success: true, status: 200, message: "ok", meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });
    expect((await upstreamSqlImportService.list()).rows).toEqual([]);
    mocked.get.mockResolvedValueOnce(ok({ id: ID }));
    expect(await upstreamSqlImportService.get(ID)).toEqual({ id: ID });
    expect(mocked.get).toHaveBeenLastCalledWith(`${BASE}/${ID}`);
  });

  it("uploads multipart (dataClass, file) with the upload's timeout and reports progress only when the total is known", async () => {
    const seen: number[] = [];
    mocked.post.mockImplementationOnce(async (_url, _body, config) => {
      config?.onUploadProgress?.({ loaded: 25, total: 100 } as never);
      config?.onUploadProgress?.({ loaded: 30 } as never);
      return ok({ id: ID });
    });
    const file = new File(["-- dump"], "dump.sql");
    expect(await upstreamSqlImportService.upload(file, "synthetic", (f) => seen.push(f))).toEqual({ id: ID });
    const [url, body, config] = mocked.post.mock.calls[0] as [string, FormData, { timeout: number }];
    expect(url).toBe(BASE);
    expect(body.get("dataClass")).toBe("synthetic");
    expect(body.get("file")).toBeInstanceOf(File);
    expect(config.timeout).toBeGreaterThan(15 * 60 * 1000);
    expect(seen).toEqual([0.25]);
    mocked.post.mockImplementationOnce(async (_url, _body, config) => {
      config?.onUploadProgress?.({ loaded: 1, total: 1 } as never);
      return ok({ id: ID });
    });
    await upstreamSqlImportService.upload(file, "real");
  });

  it("cancels and retries a run by id", async () => {
    mocked.post.mockResolvedValueOnce(ok({ id: ID, status: "cancelled" }));
    expect(await upstreamSqlImportService.cancel(ID)).toEqual({ id: ID, status: "cancelled" });
    expect(mocked.post).toHaveBeenLastCalledWith(`${BASE}/${ID}/cancel`, {});
    mocked.post.mockResolvedValueOnce(ok({ id: ID, status: "uploaded" }));
    expect(await upstreamSqlImportService.retry(ID)).toEqual({ id: ID, status: "uploaded" });
    expect(mocked.post).toHaveBeenLastCalledWith(`${BASE}/${ID}/retry`, {});
  });
});
