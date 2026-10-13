/** @jest-environment node */
/**
 * P22-08 — the public device page's server read (ADR-138; P19-07 § 10): the backend's one public route,
 * never cached, with the client's address and the original scheme forwarded (A-16, A-310), the token
 * URL-encoded in the path; the four outcomes.
 */
import { readPublicDevice } from "../publicDevice.server";
import { API_BASE_URL } from "@/constants";

const DATA = {
  device: { name: "Pump", type: null, manufacturer: null, model: null },
  facility: { name: "Facility One" },
  calibration: { status: "current", nextDueDate: null },
  lastIpmDate: null,
  report: null,
};

const answer = (status: number, body: unknown): Response =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

describe("readPublicDevice (P22-08)", () => {
  it("asks the public route, no-store, with the forwarded address and scheme; a 200 is the device", async () => {
    const fetchImpl = jest.fn(async () => answer(200, { success: true, data: DATA }));
    const incoming = new Headers({ "x-forwarded-for": "198.51.100.7", "x-forwarded-proto": "https", host: "kalibrasi.example.test" });
    expect(await readPublicDevice("a/b c", incoming, fetchImpl as unknown as typeof fetch)).toEqual({ kind: "ok", device: DATA });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(`${API_BASE_URL}/api/v1/public/devices/a%2Fb%20c`);
    expect(init.cache).toBe("no-store");
    expect(init.headers).toMatchObject({ Accept: "application/json", "X-Forwarded-For": "198.51.100.7", "X-Forwarded-Proto": "https", "X-Forwarded-Host": "kalibrasi.example.test" });
  });

  it.each([
    [404, { success: false }, "not_found"],
    [429, { success: false }, "rate_limited"],
    [500, { success: false }, "failed"],
    [200, { success: true, data: null }, "failed"],
  ])("%i → %s", async (status, body, kind) => {
    expect((await readPublicDevice("t", new Headers(), (async () => answer(status, body)) as unknown as typeof fetch)).kind).toBe(kind);
  });

  it("an unreachable backend is a failure, never a throw", async () => {
    expect(await readPublicDevice("t", new Headers(), (async () => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch)).toEqual({ kind: "failed" });
  });

  it("the default fetch is the global one", async () => {
    const spy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(answer(404, {}));
    expect((await readPublicDevice("t", new Headers())).kind).toBe("not_found");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
