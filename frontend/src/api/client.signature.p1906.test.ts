/**
 * P23-02 (P19-06 § 8.2, G-R12) — a 401 from an IPM report signature (`POST
 * /api/v1/ipm/sessions/<id>/signatures`) is a wrong password or code: it neither refreshes the
 * session nor ends it; the caller gets the server's message. Any other path keeps the F-05
 * behaviour (one refresh). Against a fake transport, so the REAL interceptors run.
 */
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { AxiosError } from "axios";
import apiClient, { api, browserNavigation, __resetSessionStateForTests } from "./client";

const calls: string[] = [];
let handler: (config: InternalAxiosRequestConfig) => { status: number; data?: unknown };

const fakeAdapter: AxiosAdapter = async (config) => {
  calls.push(`${String(config.method)} ${String(config.url)}`);
  const { status, data = {} } = handler(config);
  const response: AxiosResponse = { data, status, statusText: String(status), headers: {}, config };
  if (status >= 400) throw new AxiosError(`Request failed with status code ${String(status)}`, "ERR_BAD_RESPONSE", config, {}, response);
  return response;
};

let go: jest.SpyInstance;
beforeAll(() => {
  apiClient.defaults.adapter = fakeAdapter;
});
beforeEach(() => {
  calls.length = 0;
  __resetSessionStateForTests();
  go = jest.spyOn(browserNavigation, "go").mockImplementation(() => undefined);
});
afterEach(() => go.mockRestore());

describe("P23-02 — the IPM signature is a credential endpoint", () => {
  it("a 401 on the signature: no refresh, no redirect, the server's message", async () => {
    handler = () => ({ status: 401, data: { success: false, message: "Invalid password for e-signature." } });
    await expect(api.post("/api/v1/ipm/sessions/5a000000-0000-4000-8000-000000000001/signatures", { kind: "performer" })).rejects.toThrow(
      "Invalid password for e-signature.",
    );
    expect(calls).toEqual(["post /api/v1/ipm/sessions/5a000000-0000-4000-8000-000000000001/signatures"]);
    expect(go).not.toHaveBeenCalled();
  });

  it("the pattern is exact: a 401 on another IPM path still refreshes once", async () => {
    handler = (config) => (config.url === "/api/v1/auth/refresh" ? { status: 401 } : { status: 401, data: { message: "Token expired" } });
    await expect(api.post("/api/v1/ipm/sessions/x/signatures/extra", {})).rejects.toBeDefined();
    expect(calls).toContain("post /api/v1/auth/refresh");
  });
});
