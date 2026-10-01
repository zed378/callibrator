/**
 * P9-25 (ADR-103): the typed client's transport (`apiFetch` over `api`) and `unwrap`.
 */
import { api } from "./client";
import { apiFetch, keepQuery, typedApi, unwrap } from "./typed";

jest.mock("./client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mocked = api as jest.Mocked<typeof api>;
const at = (path: string, init?: RequestInit) => new Request(`http://same-origin.invalid${path}`, init);

describe("apiFetch — a built Request, sent through api", () => {
  beforeEach(() => jest.clearAllMocks());

  it("GET and DELETE: the path, and the caller's own query object as axios params", async () => {
    mocked.get.mockResolvedValue({ ok: 1 });
    mocked.delete.mockResolvedValue(null);
    const res = await typedApi.GET("/api/v1/vendors", { params: { query: { page: 2, limit: 10 } } });
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/vendors", { params: { page: 2, limit: 10 } });
    expect(res.data).toEqual({ ok: 1 });

    await apiFetch(at("/api/v1/x"));
    expect(mocked.get).toHaveBeenLastCalledWith("/api/v1/x");
    await apiFetch(at("/api/v1/x", { method: "DELETE" }));
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/x");
  });

  it("DELETE with a query passes it as params", async () => {
    mocked.delete.mockResolvedValue(null);
    const request = at("/api/v1/x?a=1", { method: "DELETE" });
    keepQuery.onRequest?.({ request, params: { query: { a: 1 } } } as never);
    await apiFetch(request);
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/x", { params: { a: 1 } });
  });

  it("POST, PUT, PATCH: the parsed body; an empty body is undefined", async () => {
    mocked.post.mockResolvedValue({ id: "v1" });
    mocked.put.mockResolvedValue({});
    mocked.patch.mockResolvedValue({});
    const res = await apiFetch(at("/api/v1/x", { method: "POST", body: '{"b":2}' }));
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/x", { b: 2 });
    expect(await res.json()).toEqual({ id: "v1" });
    await apiFetch(at("/api/v1/x", { method: "PUT", body: '{"c":3}' }));
    expect(mocked.put).toHaveBeenCalledWith("/api/v1/x", { c: 3 });
    await apiFetch(at("/api/v1/x", { method: "PATCH" }));
    expect(mocked.patch).toHaveBeenCalledWith("/api/v1/x", undefined);
  });

  it("an undefined answer is JSON null; another method is refused", async () => {
    mocked.get.mockResolvedValue(undefined);
    expect(await (await apiFetch(at("/api/v1/x"))).json()).toBeNull();
    await expect(apiFetch(at("/api/v1/x", { method: "OPTIONS" }))).rejects.toThrow("Unsupported method OPTIONS");
  });

  it("a rejection from api (refresh failed, 4xx, 5xx — already normalised) propagates as it is", async () => {
    mocked.get.mockRejectedValueOnce(new Error("Forbidden: Insufficient permissions"));
    await expect(typedApi.GET("/api/v1/vendors")).rejects.toThrow("Forbidden: Insufficient permissions");
  });
});

describe("unwrap", () => {
  it("returns data, and refuses a success without a body", () => {
    expect(unwrap({ data: 1 })).toBe(1);
    expect(() => unwrap({ error: "x" })).toThrow("The API answered without a body");
  });
});
