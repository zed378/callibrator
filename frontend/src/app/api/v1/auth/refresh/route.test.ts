/**
 * @jest-environment node
 */
// F-05 — the Next refresh route. Its fixture is the EXACT body the backend
// sends (auth.controller.js refresh → success(res, result.data);
// auth.service.js refreshUserToken): the rotated credentials INSIDE `data`.
// The generic proxy looked for them at the top level, which is why a refresh
// never reached the cookie.

const jar = new Map<string, string>();
const cookieStore = {
  get: jest.fn((name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined)),
  set: jest.fn(),
  delete: jest.fn(),
};

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => cookieStore),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

/** backend/src/services/auth.service.js refreshUserToken, through success(). */
const backendRefreshBody = {
  success: true,
  status: 200,
  message: "Token refreshed successfully",
  data: {
    token: "new.access.jwt",
    refreshToken: "new-opaque-refresh",
    session: { id: "sess-2", user_id: "u1", expired_at: "2026-10-01T00:00:00Z" },
  },
};

const refresh = () =>
  POST(
    new NextRequest("http://localhost/api/v1/auth/refresh", {
      method: "POST",
      headers: { "user-agent": "browser-ua", "x-forwarded-for": "6.6.6.6, 203.0.113.9" },
    }),
  );

const setNames = () => cookieStore.set.mock.calls.map((c) => c[0]);
const deleted = () =>
  cookieStore.delete.mock.calls.map((c) => (typeof c[0] === "string" ? c[0] : c[0].name));

beforeEach(() => {
  jest.clearAllMocks();
  jar.clear();
  jar.set("auth_refresh", "old-opaque-refresh");
  jar.set("auth_session", "sess-1");
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
});

describe("POST /api/v1/auth/refresh (F-05)", () => {
  it("sends the refresh cookie and session id to the backend, never anything from the body", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => backendRefreshBody,
    }) as jest.Mock;

    await refresh();

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/auth\/refresh$/);
    expect(JSON.parse(init.body)).toEqual({
      refreshToken: "old-opaque-refresh",
      sessionId: "sess-1",
    });
    expect(init.headers["X-Forwarded-For"]).toBe("203.0.113.9");
  });

  it("writes the rotated token, session and refresh token from data.* and returns no token", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => backendRefreshBody,
    }) as jest.Mock;

    const res = await refresh();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, status: 200, message: "Token refreshed successfully" });
    expect(JSON.stringify(body)).not.toContain("new.access.jwt");
    expect(cookieStore.set).toHaveBeenCalledWith(
      "auth_token",
      "new.access.jwt",
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
    expect(cookieStore.set).toHaveBeenCalledWith(
      "auth_session",
      "sess-2",
      expect.objectContaining({ httpOnly: true }),
    );
    expect(cookieStore.set).toHaveBeenCalledWith(
      "auth_refresh",
      "new-opaque-refresh",
      expect.objectContaining({ httpOnly: true, path: "/api/v1/auth/refresh" }),
    );
    expect(setNames()).toContain("auth_logged_in");
  });

  it("no refresh cookie → 401 and every session cookie cleared, without calling the backend", async () => {
    jar.delete("auth_refresh");
    global.fetch = jest.fn() as jest.Mock;

    const res = await refresh();

    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(deleted()).toEqual(
      expect.arrayContaining([
        "auth_token",
        "auth_session",
        "auth_refresh",
        "auth_logged_in",
        "x_tenant_id",
        "impersonating",
      ]),
    );
  });

  it("refused by the backend (revoked / expired) → 401, cookies cleared before the client navigates", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false, message: "Invalid or expired refresh token" }),
    }) as jest.Mock;

    const res = await refresh();

    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe("Invalid or expired refresh token");
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(deleted()).toEqual(expect.arrayContaining(["auth_token", "auth_refresh"]));
  });

  it("a 200 without the rotated credentials is treated as a refusal, not written", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      // The shape the generic proxy expected — top level. Not what the backend sends.
      json: async () => ({ success: true, token: "top.level.jwt" }),
    }) as jest.Mock;

    const res = await refresh();

    expect(res.status).toBe(401);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("a backend 5xx keeps the cookies (a fault is not a verdict on the session)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ success: false, message: "Service unavailable" }),
    }) as jest.Mock;

    const res = await refresh();

    expect(res.status).toBe(503);
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("an unreachable backend → 502, cookies kept", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) as jest.Mock;

    const res = await refresh();

    expect(res.status).toBe(502);
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("an unparseable backend answer is a refusal", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    }) as jest.Mock;

    const res = await refresh();

    expect(res.status).toBe(401);
  });
});
