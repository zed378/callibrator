/**
 * P22-10c1 — the field app's reads and its one write, through the app's real API client (the
 * typed client over `api`, an axios adapter standing in for the network): the paths and queries
 * sent, rows from `data` and the total from the top-level `meta`, the `view=field` row cut to the
 * contract's keys, the cap's 400 read as a refusal, the catalogue's `If-None-Match` / 304, and the
 * wipe's body. (A mock proves the client, not the contract: the routes' own suites and the browser
 * suite prove the server side.)
 */
import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import apiClient, { __resetSessionStateForTests } from "@/api/client";
import { FIELD_DEVICE_SUMMARY_KEYS } from "@callibrator/contracts/deviceValues";
import { createFieldApi, toFieldDevice } from "../fieldApi";
import { user } from "./fieldHelpers";

type Reply = { status: number; data?: unknown; headers?: Record<string, string> };
let handler: (config: InternalAxiosRequestConfig) => Reply;
const calls: { method?: string; url?: string; params?: unknown; data?: unknown; headers?: Record<string, unknown> }[] = [];

const adapter: AxiosAdapter = async (config) => {
  calls.push({ method: config.method, url: config.url, params: config.params, data: config.data, headers: { ...config.headers } as Record<string, unknown> });
  const { status, data = {}, headers = {} } = handler(config);
  const response: AxiosResponse = { data, status, statusText: String(status), headers, config };
  const valid = config.validateStatus ? config.validateStatus(status) : status < 400;
  if (!valid) throw new AxiosError(`Request failed with status code ${String(status)}`, "ERR_BAD_RESPONSE", config, {}, response);
  return response;
};

const api = createFieldApi(apiClient);
let original: typeof apiClient.defaults.adapter;

beforeAll(() => {
  original = apiClient.defaults.adapter;
  apiClient.defaults.adapter = adapter;
});
afterAll(() => {
  apiClient.defaults.adapter = original;
});
beforeEach(() => {
  calls.length = 0;
  __resetSessionStateForTests();
  window.history.pushState({}, "", "/field");
});

describe("whoAmI — POST /auth/verify", () => {
  it("reads the user, the role and the scope", async () => {
    handler = () => ({
      status: 200,
      data: { success: true, data: { id: "u1", tenantId: "t1", role: { name: "TENANT_ADMIN", roleLevel: 8 }, clientFacilityId: null, scopeFingerprint: "fp" } },
    });
    expect(await api.whoAmI()).toEqual({ id: "u1", tenantId: "t1", roleName: "TENANT_ADMIN", roleLevel: 8, clientFacilityId: null, scopeFingerprint: "fp" });
    expect(calls[0]).toMatchObject({ method: "post", url: "/api/v1/auth/verify" });
  });

  it("a session without a role reads as level 0; one that names no user is refused", async () => {
    handler = () => ({ status: 200, data: { success: true, data: { id: "u1", tenantId: "t1", role: null, clientFacilityId: "f1", scopeFingerprint: "fp" } } });
    expect(await api.whoAmI()).toMatchObject({ roleName: null, roleLevel: 0, clientFacilityId: "f1" });
    handler = () => ({ status: 200, data: { success: true, data: { id: "u1" } } });
    await expect(api.whoAmI()).rejects.toThrow("did not name its user");
    handler = () => ({ status: 200, data: { success: true, data: null } });
    await expect(api.whoAmI()).rejects.toThrow("did not name its user");
  });
});

describe("facilities", () => {
  it("a bound user reads its own (mine); an unbound user the options", async () => {
    handler = (c) =>
      c.url === "/api/v1/client-facilities/mine"
        ? { status: 200, data: { success: true, data: { id: "f1", name: "RS", code: "RS1", kind: "hospital", isSelf: false, status: "active" } } }
        : { status: 200, data: { success: true, data: [{ id: "f2", name: "Klinik", code: "K1", status: "active", isSelf: false }] } };
    expect(await api.facilities(user({ clientFacilityId: "f1" }))).toEqual([{ id: "f1", name: "RS", code: "RS1", status: "active" }]);
    expect(await api.facilities(user())).toEqual([{ id: "f2", name: "Klinik", code: "K1", status: "active" }]);
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/client-facilities/mine", "/api/v1/client-facilities/options"]);
    handler = () => ({ status: 200, data: { success: true, data: null } });
    expect(await api.facilities(user({ clientFacilityId: "f1" }))).toEqual([]);
  });
});

describe("the working set reads", () => {
  it("facilitySize reads meta.total of a one-row field page; a missing meta falls back to the rows", async () => {
    handler = () => ({ status: 200, data: { success: true, data: [{ id: "d1" }], meta: { total: 321 } } });
    expect(await api.facilitySize("f1")).toEqual({ ok: true, total: 321 });
    expect(calls[0]).toMatchObject({ url: "/api/v1/calibration-devices", params: { clientFacilityId: "f1", view: "field", page: 1, limit: 1, sort: "id" } });
    handler = () => ({ status: 200, data: { success: true, data: [] } });
    expect(await api.facilitySize("f1")).toEqual({ ok: true, total: 0 });
  });

  it("the cap's 400 FIELD_WORKING_SET_TOO_LARGE is a refusal with the server's message; any other error is thrown", async () => {
    handler = () => ({ status: 400, data: { success: false, code: "FIELD_WORKING_SET_TOO_LARGE", message: "This selection has 2500 devices", data: null } });
    expect(await api.facilitySize("f1")).toEqual({ ok: false, tooLarge: true, message: "This selection has 2500 devices" });
    handler = () => ({ status: 400, data: { success: false, code: "OTHER", message: "no", data: null } });
    await expect(api.facilitySize("f1")).rejects.toThrow();
  });

  it("devicePage keeps exactly the contract's keys of each row", async () => {
    handler = () => ({ status: 200, data: { success: true, data: [{ id: "d1", name: "Pump", registrant: "SECRET", notes: "x" }], meta: { total: 1 } } });
    const page = await api.devicePage("f1", 2, 200);
    expect(page.total).toBe(1);
    expect(Object.keys(page.rows[0] ?? {})).toEqual([...FIELD_DEVICE_SUMMARY_KEYS]);
    expect(page.rows[0]).toMatchObject({ id: "d1", name: "Pump", qrCode: null });
    expect(calls[0]?.params).toEqual({ clientFacilityId: "f1", view: "field", page: 2, limit: 200, sort: "id" });
    expect(toFieldDevice(null).id).toBeNull();
  });

  it("rooms reads every page of kind=room", async () => {
    let n = 0;
    handler = () => {
      n += 1;
      const data = Array.from({ length: n === 1 ? 100 : 3 }, (_, i) => ({ id: `r${String(n)}-${String(i)}`, name: `Room ${String(i)}`, code: "c" }));
      return { status: 200, data: { success: true, data, meta: { total: 103 } } };
    };
    const rooms = await api.rooms();
    expect(rooms).toHaveLength(103);
    expect(rooms[0]).toEqual({ id: "r1-0", name: "Room 0" });
    expect(calls.map((c) => c.params)).toEqual([
      { kind: "room", page: 1, limit: 100 },
      { kind: "room", page: 2, limit: 100 },
    ]);
  });

  it("rooms stops at the total even when the page is full", async () => {
    handler = () => ({ status: 200, data: { success: true, data: Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: "R" })), meta: { total: 100 } } });
    expect(await api.rooms()).toHaveLength(100);
    expect(calls).toHaveLength(1);
  });
});

describe("catalogue — If-None-Match / ETag (F-79)", () => {
  it("sends the ETag it holds; 304 is 'not modified'; 200 hands back the document and the new ETag", async () => {
    handler = () => ({ status: 304 });
    expect(await api.catalogue('"e1"')).toEqual({ notModified: true });
    expect(calls[0]?.headers?.["If-None-Match"]).toBe('"e1"');
    handler = () => ({ status: 200, data: { success: true, data: { versions: [] } }, headers: { etag: '"e2"' } });
    expect(await api.catalogue(null)).toEqual({ notModified: false, etag: '"e2"', document: { versions: [] } });
    expect(calls[1]?.headers?.["If-None-Match"]).toBeUndefined();
    handler = () => ({ status: 200, data: "not json" });
    expect(await api.catalogue(null)).toEqual({ notModified: false, etag: null, document: null });
  });
});

describe("recordWipe — POST /field/wipes", () => {
  it("sends the counts only", async () => {
    handler = () => ({ status: 201, data: { success: true, data: { wipedUserId: "u2", captures: 2, photos: 5, recordedAt: "2026-10-12T00:00:00.000Z" } } });
    await api.recordWipe("u2", 2, 5);
    expect(calls[0]).toMatchObject({ method: "post", url: "/api/v1/field/wipes" });
    expect(JSON.parse(String(calls[0]?.data))).toEqual({ wipedUserId: "u2", captures: 2, photos: 5 });
  });
});
