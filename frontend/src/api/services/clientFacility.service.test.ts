/**
 * P22-09 — the client-facility service against the backend contract (P21-09b/c): paths, queries and
 * bodies of `schema.d.ts`; rows from `data`, paging from the top-level `meta`; empty answers as
 * empty lists.
 */
import { clientFacilityService as svc } from "./clientFacility.service";
import { api } from "../client";

jest.mock("../client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));

const mocked = api as jest.Mocked<typeof api>;
const ok = <T,>(data: T, meta?: unknown) => ({ success: true, status: 200, message: "ok", data, ...(meta ? { meta } : {}) });
const F = "5c000000-0000-4000-8000-000000000001";

describe("clientFacilityService (P22-09)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reads: options, the list (meta, or a fallback), the users, the user search, the roles — empty answers as []", async () => {
    mocked.get.mockResolvedValueOnce(ok(null));
    expect(await svc.options()).toEqual([]);
    mocked.get.mockResolvedValueOnce(ok([{ id: F }], { total: 1, page: 1, limit: 25, totalPages: 1 }));
    expect(await svc.list({ page: 1, limit: 25 })).toEqual({ rows: [{ id: F }], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } });
    mocked.get.mockResolvedValueOnce(ok(null));
    expect(await svc.list({})).toEqual({ rows: [], meta: { total: 0, page: 1, limit: 0, totalPages: 1 } });
    mocked.get.mockResolvedValueOnce(ok(null));
    expect(await svc.users(F)).toEqual([]);
    expect(mocked.get).toHaveBeenLastCalledWith(`/api/v1/client-facilities/${F}/users`);
    mocked.get.mockResolvedValueOnce(ok(null));
    expect(await svc.findUsers("te")).toEqual([]);
    expect(mocked.get).toHaveBeenLastCalledWith("/api/v1/users/all", { params: { page: 1, limit: 20, find: "te" } });
    mocked.get.mockResolvedValueOnce(ok(null));
    expect(await svc.roles()).toEqual([]);
    expect(mocked.get).toHaveBeenLastCalledWith("/api/v1/roles", { params: { page: "1", limit: "100" } });
  });

  it("writes: create, edit, status, delete, bind", async () => {
    mocked.post.mockResolvedValue(ok({ id: F }));
    mocked.patch.mockResolvedValue(ok({ id: F }));
    mocked.put.mockResolvedValue(ok({ userId: "u" }));
    mocked.delete.mockResolvedValue(ok(null));
    await svc.create({ name: "A", code: "A" });
    expect(mocked.post).toHaveBeenLastCalledWith("/api/v1/client-facilities", { name: "A", code: "A" });
    await svc.edit(F, { city: null });
    expect(mocked.patch).toHaveBeenLastCalledWith(`/api/v1/client-facilities/${F}`, { city: null });
    await svc.setStatus(F, { status: "inactive", reason: "Paused" });
    expect(mocked.post).toHaveBeenLastCalledWith(`/api/v1/client-facilities/${F}/status`, { status: "inactive", reason: "Paused" });
    await svc.remove(F);
    expect(mocked.delete).toHaveBeenLastCalledWith(`/api/v1/client-facilities/${F}`);
    await svc.bind("u", { clientFacilityId: F, reason: "New" });
    expect(mocked.put).toHaveBeenLastCalledWith("/api/v1/users/u/client-facility", { clientFacilityId: F, reason: "New" });
  });
});
