/**
 * The rsync image import's client (upstreamImport.service.ts) against the contract's paths:
 * rows in `data`, the total in a top-level `meta`; the credential is sent, never read back.
 */
jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});

import { api } from "@/api/client";
import { LIVE_STATUSES, upstreamImportService } from "./upstreamImport.service";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const BASE = "/api/v1/admin/upstream-file-imports";
const ID = "5f0c2b8e-3a4d-4c6b-9e1f-7a8b9c0d1e2f";
const ok = (data: unknown, meta?: unknown) => ({ success: true, status: 200, message: "ok", data, ...(meta ? { meta } : {}) });

beforeEach(() => jest.clearAllMocks());

describe("upstreamImportService", () => {
  it("lists from data with the total from meta; an empty answer is an empty page", async () => {
    get.mockResolvedValueOnce(ok([{ id: ID }], { total: 7, page: 2, limit: 5, totalPages: 2 }));
    expect(await upstreamImportService.list(2, 5)).toEqual({ rows: [{ id: ID }], total: 7 });
    expect(get).toHaveBeenCalledWith(BASE, { params: { page: 2, limit: 5 } });
    get.mockResolvedValueOnce({ success: true, status: 200, message: "ok" });
    expect(await upstreamImportService.list()).toEqual({ rows: [], total: 0 });
  });

  it("reads the configuration and one import", async () => {
    get.mockResolvedValueOnce(ok({ realDataAllowed: false }));
    expect(await upstreamImportService.config()).toEqual({ realDataAllowed: false });
    get.mockResolvedValueOnce(ok({ id: ID }));
    expect(await upstreamImportService.get(ID)).toEqual({ id: ID });
    expect(get.mock.calls.at(-1)?.[0]).toBe(`${BASE}/${ID}`);
  });

  it("checks, starts and cancels at the contract's paths", async () => {
    post.mockResolvedValue(ok({ status: "ok" }));
    await upstreamImportService.check({ host: "h", username: "u", authMethod: "key", privateKey: "k", remotePath: "/p", fileClasses: ["front"] } as never);
    expect(post).toHaveBeenLastCalledWith(`${BASE}/check-connection`, expect.objectContaining({ host: "h" }));
    await upstreamImportService.start({ host: "h" } as never);
    expect(post).toHaveBeenLastCalledWith(BASE, { host: "h" });
    await upstreamImportService.cancel(ID);
    expect(post).toHaveBeenLastCalledWith(`${BASE}/${ID}/cancel`, {});
    expect(LIVE_STATUSES).toEqual(["pending", "transferring", "ingesting"]);
  });
});
