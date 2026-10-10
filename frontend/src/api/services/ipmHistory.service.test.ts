/**
 * P22-04 — the IPM history service against the backend contract (P21-03, P21-04; the paths,
 * methods, queries and bodies of `schema.d.ts`): rows from `data`, paging from the TOP-LEVEL `meta`;
 * every write on the session's own path with the body the contract names.
 */
import { ipmHistoryService as svc } from "./ipmHistory.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mocked = api as jest.Mocked<typeof api>;
const ok = <T,>(data: T, meta?: unknown) => ({ success: true, status: 200, message: "ok", data, ...(meta ? { meta } : {}) });
const META = { total: 41, page: 2, limit: 20, totalPages: 3 };
const ID = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
const session = { id: ID, status: "submitted" };
const path = `/api/v1/ipm/sessions/${ID}`;

describe("ipmHistoryService (P22-04)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("list: the query as params; rows from data, the top-level meta (and a fallback when absent)", async () => {
    mocked.get.mockResolvedValueOnce(ok([session], META));
    const query = { page: 2, limit: 20, deviceId: ID, effective: true, sort: "performedAt" as const };
    expect(await svc.list(query)).toEqual({ rows: [session], meta: META });
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/ipm/sessions", { params: query });
    mocked.get.mockResolvedValueOnce(ok(null));
    expect(await svc.list({})).toEqual({ rows: [], meta: { total: 0, page: 1, limit: 0, totalPages: 1 } });
  });

  it("get reads one session", async () => {
    mocked.get.mockResolvedValueOnce(ok(session));
    expect(await svc.get(ID)).toEqual(session);
    expect(mocked.get).toHaveBeenCalledWith(path);
  });

  it("correct, submit, void and discard POST the contract's bodies on the session's path", async () => {
    mocked.post.mockResolvedValue(ok(session));
    await svc.correct(ID, "Wrong date");
    expect(mocked.post).toHaveBeenLastCalledWith(`${path}/corrections`, { reason: "Wrong date" });
    await svc.submit(ID, 3);
    expect(mocked.post).toHaveBeenLastCalledWith(`${path}/submit`, { revision: 3 });
    await svc.voidSession(ID, "Duplicate visit");
    expect(mocked.post).toHaveBeenLastCalledWith(`${path}/void`, { reason: "Duplicate visit" });
    await svc.discard(ID, "Started by mistake");
    expect(mocked.post).toHaveBeenLastCalledWith(`${path}/discard`, { reason: "Started by mistake" });
    await svc.discard(ID);
    expect(mocked.post).toHaveBeenLastCalledWith(`${path}/discard`, {});
  });

  it("editHeader PATCHes the revision and the changed fields", async () => {
    mocked.patch.mockResolvedValueOnce(ok(session));
    await svc.editHeader(ID, { revision: 2, recommendation: "needs_repair" });
    expect(mocked.patch).toHaveBeenCalledWith(path, { revision: 2, recommendation: "needs_repair" });
  });
});
