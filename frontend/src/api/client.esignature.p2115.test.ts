/**
 * P21-15 (ADR-140) — only the e-signature acts that re-enter a credential (the POSTs) are credential
 * endpoints: a 401 there is a wrong password or code — no refresh, no redirect, the server's message.
 * The READS on the same paths (`GET /esignature/me`, `GET /calibration-records/:id/esignatures`,
 * `GET /certificates/:id/esignatures`) are session reads: a 401 refreshes once and, when the session
 * cannot be renewed, goes to sign-in like every other read. Against a fake transport, so the REAL
 * interceptors run.
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
  window.history.pushState({}, "", "/dashboard/profile");
  go = jest.spyOn(browserNavigation, "go").mockImplementation(() => undefined);
});
afterEach(() => go.mockRestore());

const ID = "5a000000-0000-4000-8000-000000000001";

describe("P21-15 — e-signature credential endpoints are the POSTs only", () => {
  it.each([
    "/api/v1/esignature/me",
    "/api/v1/esignature/me/revoke",
    "/api/v1/esignature/documents",
    `/api/v1/calibration-records/${ID}/esignatures`,
    `/api/v1/certificates/${ID}/esignatures`,
  ])("a 401 on POST %s: no refresh, no redirect, the server's message", async (url) => {
    handler = () => ({ status: 401, data: { success: false, message: "Invalid password for e-signature." } });
    await expect(api.post(url, {})).rejects.toThrow("Invalid password for e-signature.");
    expect(calls).toEqual([`post ${url}`]);
    expect(go).not.toHaveBeenCalled();
  });

  it.each(["/api/v1/esignature/me", `/api/v1/calibration-records/${ID}/esignatures`, `/api/v1/certificates/${ID}/esignatures`])(
    "an expired session on GET %s refreshes once and, when it cannot, goes to sign-in",
    async (url) => {
      handler = () => ({ status: 401, data: { message: "Token expired" } });
      await expect(api.get(url)).rejects.toBeDefined();
      expect(calls).toEqual([`get ${url}`, "post /api/v1/auth/refresh"]);
      expect(go).toHaveBeenCalledWith("/login?callbackUrl=%2Fdashboard%2Fprofile");
    },
  );
});
