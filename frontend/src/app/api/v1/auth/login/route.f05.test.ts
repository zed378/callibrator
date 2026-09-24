/**
 * @jest-environment node
 */
// F-05 / F-62 — what the login route writes and what it hands the browser.
// Fixture: backend/src/utils/response.util.js login() → the envelope with
// `token` and `session` at the TOP level, the user in `data`.

const cookieStore = { set: jest.fn() };

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => cookieStore),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const login = () =>
  POST(
    new NextRequest("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: "ada", password: "Right-password-1" }),
    }),
  );

const backendLogin = (extra: Record<string, unknown> = {}) => ({
  success: true,
  status: 200,
  message: "Login successful",
  data: { id: "u1", username: "ada", roleId: "r1" },
  token: "access.jwt",
  session: { id: "sess-1", createdAt: "2026-09-24T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z" },
  ...extra,
});

const answer = (body: unknown, status = 200) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
  }) as jest.Mock;
};

beforeEach(() => jest.clearAllMocks());

describe("POST /api/v1/auth/login — cookies and body (F-05, F-62)", () => {
  it("F-62: the access token is written as an httpOnly cookie and NOT returned in the body", async () => {
    answer(backendLogin());

    const res = await login();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty("token");
    expect(JSON.stringify(body)).not.toContain("access.jwt");
    expect(body.data).toEqual({ id: "u1", username: "ada", roleId: "r1" });
    expect(body.session.id).toBe("sess-1");
    expect(cookieStore.set).toHaveBeenCalledWith(
      "auth_token",
      "access.jwt",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
    expect(cookieStore.set).toHaveBeenCalledWith(
      "auth_logged_in",
      "true",
      expect.objectContaining({ httpOnly: false }),
    );
  });

  it("F-05: a refresh token from the backend becomes an httpOnly cookie scoped to the refresh route, and never reaches the body", async () => {
    answer(backendLogin({ refreshToken: "opaque-refresh" }));

    const res = await login();
    const body = await res.json();

    expect(body).not.toHaveProperty("refreshToken");
    expect(cookieStore.set).toHaveBeenCalledWith(
      "auth_refresh",
      "opaque-refresh",
      expect.objectContaining({ httpOnly: true, path: "/api/v1/auth/refresh" }),
    );
  });

  it("F-05: the session cookies live for the backend session window (7 days), not the access token's", async () => {
    answer(backendLogin());

    await login();

    const [, , options] = cookieStore.set.mock.calls.find((c) => c[0] === "auth_token");
    expect(options.maxAge).toBe(7 * 24 * 60 * 60);
  });

  it("an MFA challenge (202) passes the temporary token through and writes no cookie", async () => {
    answer({ success: true, data: { mfaRequired: true }, token: "mfa.temp" }, 202);

    const res = await login();

    expect(res.status).toBe(202);
    expect((await res.json()).token).toBe("mfa.temp");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("a refused login passes the backend's status and message through", async () => {
    answer({ success: false, message: "Invalid credentials" }, 401);

    const res = await login();

    expect(res.status).toBe(401);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("an unreachable backend is a 500 that names the backend", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) as jest.Mock;
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await login();

    expect(res.status).toBe(500);
    expect((await res.json()).message).toContain("ECONNREFUSED");
    spy.mockRestore();
  });
});
