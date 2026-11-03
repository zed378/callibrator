/**
 * P21-15 (ADR-140) — the public e-signature page's server read: the backend's one public route with
 * the token, never cached, the client's address forwarded; the four outcomes; the specimen data URI.
 */
import { readPublicEsignature, specimenDataUri } from "./publicEsignature.server";

const ok = (body: unknown, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

describe("readPublicEsignature", () => {
  it("asks the public route with the id and token, no-store, with the client's address; ok with the verdict", async () => {
    const fetchImpl = jest.fn(async () => ok({ data: { verdict: "valid" } }));
    const outcome = await readPublicEsignature("a/b", "t+1", new Headers({ "x-forwarded-for": "203.0.113.9" }), fetchImpl as unknown as typeof fetch);
    expect(outcome).toEqual({ kind: "ok", verdict: { verdict: "valid" } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/public\/esignatures\/a%2Fb\?token=t%2B1$/);
    expect(init.cache).toBe("no-store");
  });

  it.each([
    [ok(null, 404), "not_found"],
    [ok(null, 429), "rate_limited"],
    [ok(null, 500), "failed"],
    [ok({ data: null }), "failed"],
  ])("%#: answers %s", async (response, kind) => {
    expect((await readPublicEsignature("x", "", new Headers(), (async () => response) as unknown as typeof fetch)).kind).toBe(kind);
  });

  it("an unreachable backend is failed", async () => {
    expect(await readPublicEsignature("x", "", new Headers(), (async () => Promise.reject(new Error("down"))) as unknown as typeof fetch)).toEqual({ kind: "failed" });
  });

  it("specimenDataUri: a base64 SVG data URI", () => {
    expect(specimenDataUri("<svg/>")).toBe(`data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`);
  });
});
