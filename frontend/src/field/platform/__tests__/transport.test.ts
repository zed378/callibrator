/**
 * P22-10b — the engine's transport over the app's axios client, against a fake axios adapter (the
 * request as it leaves): the frozen body text sent byte for byte with its `Idempotency-Key` and
 * `X-Field-Client`, a photo as multipart with its fields; every HTTP answer an `Answer` (code,
 * message, `draftId`, `Retry-After` from the body or the header, the `Date`); no answer rejects; a
 * 401 is `SessionEnded`; `verify` reads the scope fingerprint.
 */
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { SessionEnded } from "../../engine/ports";
import type { FrozenRequest } from "../../engine/model";
import { createTransport } from "../transport";

const DATE = "Sat, 10 Oct 2026 02:00:00 GMT";
let seen: InternalAxiosRequestConfig[] = [];
let reply: (config: InternalAxiosRequestConfig) => { status: number; data?: unknown; headers?: Record<string, string> } | "network";

const adapter: AxiosAdapter = async (config) => {
  seen.push(config);
  const r = reply(config);
  if (r === "network") throw new AxiosError("Network Error", "ERR_NETWORK", config);
  const response = { data: r.data ?? {}, status: r.status, statusText: String(r.status), headers: r.headers ?? {}, config };
  if (r.status >= 400) throw new AxiosError("fail", "ERR_BAD_RESPONSE", config, {}, response);
  return response;
};

const client = axios.create({ adapter });
const transport = createTransport(client);
const frozen: FrozenRequest = { method: "PUT", path: "/api/v1/ipm/sessions/s1/results", idempotencyKey: "key-1", bodyText: '{"revision":2,"results":[]}', photo: null, hash: "h" };

beforeEach(() => {
  seen = [];
});

describe("P22-10b — the transport", () => {
  it("sends the frozen text byte for byte, with its key; a success is an Answer with the data and the Date", async () => {
    reply = () => ({ status: 200, data: { success: true, data: { id: "s1", revision: 3 } }, headers: { date: DATE } });
    const answer = await transport.send(frozen, null);
    expect(seen[0]).toMatchObject({ method: "put", url: "/api/v1/ipm/sessions/s1/results", data: '{"revision":2,"results":[]}' });
    expect(seen[0]?.headers["Idempotency-Key"]).toBe("key-1");
    expect(seen[0]?.headers["X-Field-Client"]).toBe("1");
    expect(seen[0]?.headers["Content-Type"]).toBe("application/json");
    expect(answer).toEqual({ status: 200, data: { id: "s1", revision: 3 }, code: null, message: "", draftId: null, retryAfterSec: null, serverDate: Date.parse(DATE) });
    reply = () => ({ status: 200, data: "not json" });
    expect((await transport.send({ ...frozen, bodyText: null }, null)).data).toBeNull();
    expect(seen[1]?.data).toBe("");
  });

  it("a photo as multipart with its fields", async () => {
    reply = () => ({ status: 201, data: { data: { id: "a1" } } });
    await transport.send({ ...frozen, method: "POST", path: "/api/v1/attachments", bodyText: null, photo: { photoId: "p1", fields: { resourceType: "inspectionsession", purpose: "ipm_evidence" } } }, new Blob(["jpeg"]));
    const form = seen[0]?.data as FormData;
    expect(form.get("resourceType")).toBe("inspectionsession");
    expect(form.get("purpose")).toBe("ipm_evidence");
    expect((form.get("file") as File).name).toBe("p1.jpg");
    await transport.send({ ...frozen, method: "POST", path: "/x", bodyText: null, photo: { photoId: "p2", fields: {} } }, null);
    expect((seen[1]?.data as FormData).get("file")).toBeNull();
  });

  it("refusals are Answers: code, message, draftId, Retry-After (body or header); no answer rejects; a 401 is SessionEnded", async () => {
    reply = () => ({ status: 409, data: { success: false, code: "IPM_DRAFT_EXISTS", message: "You already have a draft", draftId: "d1" } });
    expect(await transport.send(frozen, null)).toMatchObject({ status: 409, code: "IPM_DRAFT_EXISTS", message: "You already have a draft", draftId: "d1", data: null });
    reply = () => ({ status: 429, data: { retryAfter: 12 } });
    expect((await transport.send(frozen, null)).retryAfterSec).toBe(12);
    reply = () => ({ status: 503, headers: { "retry-after": "7" } });
    expect((await transport.send(frozen, null)).retryAfterSec).toBe(7);
    reply = () => ({ status: 503, headers: { "retry-after": "soon", date: "garbage" } });
    expect(await transport.send(frozen, null)).toMatchObject({ retryAfterSec: null, serverDate: null });
    reply = () => "network";
    await expect(transport.send(frozen, null)).rejects.toThrow("Network Error");
    reply = () => ({ status: 401 });
    await expect(transport.send(frozen, null)).rejects.toBeInstanceOf(SessionEnded);
  });

  it("read and verify: the fingerprint and the Date; a verify without one fails", async () => {
    reply = (c) => (c.url === "/api/v1/auth/verify" ? { status: 200, data: { data: { scopeFingerprint: "fp" } }, headers: { date: DATE } } : { status: 200, data: { data: { revision: 4 } } });
    expect(await transport.verify()).toEqual({ scopeFingerprint: "fp", serverDate: Date.parse(DATE) });
    expect((await transport.read("/api/v1/ipm/sessions/s1")).data).toEqual({ revision: 4 });
    expect(seen.map((c) => c.method)).toEqual(["post", "get"]);
    reply = () => ({ status: 200, data: { data: {} } });
    await expect(transport.verify()).rejects.toThrow("verify failed");
    reply = () => ({ status: 200, data: null });
    await expect(transport.verify()).rejects.toThrow();
  });
});
