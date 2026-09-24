/**
 * F-05 / F-07 / F-14 — the API client's response interceptor, against a fake
 * transport (an axios adapter), so the REAL interceptors run.
 *
 * F-05: a 401 used to do `window.location.href = "/login"` and clear nothing;
 * proxy.ts then bounced /login back to /dashboard on the surviving cookie. Now
 * a 401 renews the session once through the Next refresh route and retries,
 * and a session that cannot be renewed lands on /login once — after the
 * refresh route has cleared the cookies.
 */
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { AxiosError } from "axios";
import apiClient, {
  api,
  browserNavigation,
  describeApiError,
  sessionExpiredRedirect,
  __resetSessionStateForTests,
} from "./client";
import { useAccessDeniedStore } from "@/stores/accessDeniedStore";
import { API_TIMEOUT, BACKEND_TIMEOUT_MS } from "@/constants";

type Handler = (config: InternalAxiosRequestConfig) => {
  status: number;
  data?: unknown;
  headers?: Record<string, string>;
};

const calls: { method?: string; url?: string; data?: unknown }[] = [];
let handler: Handler;

const fakeAdapter: AxiosAdapter = async (config) => {
  calls.push({ method: config.method, url: config.url, data: config.data });
  const { status, data = {}, headers = {} } = handler(config);
  const response: AxiosResponse = {
    data,
    status,
    statusText: String(status),
    headers,
    config,
  };
  if (status >= 400) {
    throw new AxiosError(
      `Request failed with status code ${status}`,
      "ERR_BAD_RESPONSE",
      config,
      {},
      response,
    );
  }
  return response;
};

let assign: jest.SpyInstance;

beforeAll(() => {
  apiClient.defaults.adapter = fakeAdapter;
});

beforeEach(() => {
  calls.length = 0;
  __resetSessionStateForTests();
  useAccessDeniedStore.setState({ isOpen: false, message: null, refusals: 0 });
  window.history.pushState({}, "", "/dashboard/devices?page=2");
  assign = jest.spyOn(browserNavigation, "go").mockImplementation(() => undefined);
});

afterEach(() => {
  assign.mockRestore();
});

describe("F-05: an expired session is refreshed once and the request retried", () => {
  it("401 → POST /api/v1/auth/refresh → the original request is retried and resolves", async () => {
    let devicesCalls = 0;
    handler = (config) => {
      if (config.url === "/api/v1/devices") {
        devicesCalls += 1;
        return devicesCalls === 1
          ? { status: 401, data: { success: false, message: "Token expired" } }
          : { status: 200, data: { success: true, data: [{ id: "d1" }] } };
      }
      if (config.url === "/api/v1/auth/refresh") {
        return { status: 200, data: { success: true } };
      }
      return { status: 404 };
    };

    const res = await api.get<{ data: { id: string }[] }>("/api/v1/devices");

    expect(res.data).toEqual([{ id: "d1" }]);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "get /api/v1/devices",
      "post /api/v1/auth/refresh",
      "get /api/v1/devices",
    ]);
    expect(assign).not.toHaveBeenCalled();
  });

  it("concurrent 401s share ONE refresh (the backend rotates the refresh token)", async () => {
    const seen = new Map<string, number>();
    handler = (config) => {
      const url = config.url as string;
      seen.set(url, (seen.get(url) ?? 0) + 1);
      if (url === "/api/v1/auth/refresh") return { status: 200, data: { success: true } };
      return seen.get(url) === 1 ? { status: 401 } : { status: 200, data: { ok: url } };
    };

    const results = await Promise.all([
      api.get("/api/v1/a"),
      api.get("/api/v1/b"),
      api.get("/api/v1/c"),
    ]);

    expect(results).toEqual([{ ok: "/api/v1/a" }, { ok: "/api/v1/b" }, { ok: "/api/v1/c" }]);
    expect(seen.get("/api/v1/auth/refresh")).toBe(1);
  });

  it("a request that is refused again after a successful refresh is not refreshed twice", async () => {
    handler = (config) =>
      config.url === "/api/v1/auth/refresh"
        ? { status: 200, data: { success: true } }
        : { status: 401, data: { message: "Still no" } };

    await expect(api.get("/api/v1/devices")).rejects.toThrow("Still no");
    expect(calls.filter((c) => c.url === "/api/v1/auth/refresh")).toHaveLength(1);
    expect(calls.filter((c) => c.url === "/api/v1/devices")).toHaveLength(2);
  });
});

describe("F-05: a session that cannot be refreshed lands on /login once", () => {
  it("refresh refused (401) → navigates to /login with the page to return to, once", async () => {
    handler = () => ({ status: 401, data: { success: false, message: "Session expired" } });

    await Promise.allSettled([api.get("/api/v1/a"), api.get("/api/v1/b")]);

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(
      "/login?callbackUrl=%2Fdashboard%2Fdevices%3Fpage%3D2",
    );
    // No hard navigation to a bare /login before the cookies are cleared: the
    // refresh route (which clears them on refusal) was consulted first.
    expect(calls.filter((c) => c.url === "/api/v1/auth/refresh")).toHaveLength(1);
  });

  it("refresh unreachable (502) → no navigation: the session may be fine", async () => {
    handler = (config) =>
      config.url === "/api/v1/auth/refresh" ? { status: 502 } : { status: 401 };

    await expect(api.get("/api/v1/devices")).rejects.toBeInstanceOf(Error);
    expect(assign).not.toHaveBeenCalled();
  });

  it("a 401 from a credential endpoint (wrong password) is an answer, not an expired session", async () => {
    handler = () => ({ status: 401, data: { message: "Invalid credentials" } });

    await expect(
      api.post("/api/v1/auth/login", { user: "ada", password: "x" }),
    ).rejects.toThrow("Invalid credentials");
    expect(calls).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it("off a protected page there is nowhere to send the user — no navigation (no /login → /login loop)", () => {
    expect(sessionExpiredRedirect("/login")).toBeNull();
    expect(sessionExpiredRedirect("/")).toBeNull();
    expect(sessionExpiredRedirect("/verify/CERT-1")).toBeNull();
    expect(sessionExpiredRedirect("/dashboardish")).toBeNull();
    expect(sessionExpiredRedirect("/dashboard")).toBe("/login?callbackUrl=%2Fdashboard");
  });
});

describe("F-07: every rejection carries status, message and the X-Request-Id", () => {
  it("describeApiError reads the backend's message, status, code and request id", async () => {
    handler = () => ({
      status: 409,
      data: {
        success: false,
        message: "This certificate is in draft and must be submitted first",
        code: "INVALID_STATE",
      },
      headers: { "x-request-id": "req-123" },
    });

    const err = await api.get("/api/v1/certificates/1").catch((e: unknown) => e);

    expect(describeApiError(err)).toEqual({
      status: 409,
      code: "INVALID_STATE",
      message: "This certificate is in draft and must be submitted first",
      requestId: "req-123",
      kind: "http",
    });
  });

  it("a request with no answer is a network failure; a timeout is a timeout", () => {
    const network = new AxiosError("Network Error", "ERR_NETWORK");
    expect(describeApiError(network)).toMatchObject({ status: null, kind: "network" });
    const timeout = new AxiosError("timeout of 35000ms exceeded", "ECONNABORTED");
    expect(describeApiError(timeout)).toMatchObject({ status: null, kind: "timeout" });
    expect(describeApiError(new Error("boom"))).toMatchObject({ kind: "unknown", message: "boom" });
    expect(describeApiError("??")).toMatchObject({ kind: "unknown", message: "Request failed" });
  });

  it("a refused ACTION (403 on a mutation) opens the access-denied modal", async () => {
    handler = () => ({ status: 403, data: { message: "You may not delete devices" } });

    await api.delete("/api/v1/devices/1").catch(() => undefined);

    expect(useAccessDeniedStore.getState()).toMatchObject({
      isOpen: true,
      message: "You may not delete devices",
      refusals: 1,
    });
  });

  it("a refused READ is left to the screen — no modal (background reads must not pop one)", async () => {
    handler = () => ({ status: 403, data: { message: "no" } });

    await api.get("/api/v1/health").catch(() => undefined);

    expect(useAccessDeniedStore.getState().isOpen).toBe(false);
  });

  it("a 403 that is a redirect code (A-123) is a redirect, not the modal", async () => {
    handler = () => ({ status: 403, data: { code: "PASSWORD_CHANGE_REQUIRED" } });

    await api.post("/api/v1/devices", {}).catch(() => undefined);

    expect(useAccessDeniedStore.getState().isOpen).toBe(false);
    expect(assign).toHaveBeenCalledWith("/dashboard/change-password");
  });
});

describe("request interceptor", () => {
  it("drops the JSON Content-Type for a FormData body so the browser sets the boundary", async () => {
    let sent: InternalAxiosRequestConfig | undefined;
    handler = (config) => {
      sent = config;
      return { status: 200, data: {} };
    };
    const form = new FormData();
    form.append("file", "x");

    await api.post("/api/v1/attachments", form);

    // (Whatever the transport then derives from the FormData, it is not the
    // client's JSON default — which strips multer's boundary.)
    expect(sent?.headers?.["Content-Type"]).not.toBe("application/json");
  });

  it("keeps the JSON Content-Type for an ordinary body", async () => {
    let sent: InternalAxiosRequestConfig | undefined;
    handler = (config) => {
      sent = config;
      return { status: 200, data: {} };
    };

    await api.put("/api/v1/devices/1", { name: "x" });
    await api.patch("/api/v1/devices/1", { name: "y" });

    expect(sent?.headers?.["Content-Type"]).toBe("application/json");
  });
});

describe("F-14: the client outlasts the server", () => {
  it("the client timeout is longer than the backend's 30 s, so the backend's 408 is what arrives", () => {
    expect(BACKEND_TIMEOUT_MS).toBe(30000);
    expect(API_TIMEOUT).toBeGreaterThan(BACKEND_TIMEOUT_MS);
    expect(apiClient.defaults.timeout).toBe(API_TIMEOUT);
  });
});
