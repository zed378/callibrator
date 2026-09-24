// F-05 — the one definition of the session cookies.
import {
  clearSessionCookies,
  loggedInCookieOptions,
  refreshCookieOptions,
  sessionCookieOptions,
  SESSION_MAX_AGE_SECONDS,
  writeSessionCookies,
} from "./authCookies";

const jar = () => ({ set: jest.fn(), delete: jest.fn() });

describe("authCookies", () => {
  it("the session window is the backend's 7 days", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(604800);
    expect(sessionCookieOptions()).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(refreshCookieOptions()).toMatchObject({ httpOnly: true, path: "/api/v1/auth/refresh" });
    expect(loggedInCookieOptions().httpOnly).toBe(false);
  });

  it("secure in production only", () => {
    const env = process.env as Record<string, string | undefined>;
    const before = env.NODE_ENV;
    env.NODE_ENV = "production";
    expect(sessionCookieOptions().secure).toBe(true);
    env.NODE_ENV = before;
    expect(sessionCookieOptions().secure).toBe(false);
  });

  it("writes only what it was given", () => {
    const j = jar();
    writeSessionCookies(j, { token: "t" });
    expect(j.set.mock.calls.map((c) => c[0])).toEqual(["auth_token", "auth_logged_in"]);

    const k = jar();
    writeSessionCookies(k, { token: "t", sessionId: "s", refreshToken: "r" });
    expect(k.set.mock.calls.map((c) => c[0])).toEqual([
      "auth_token",
      "auth_session",
      "auth_refresh",
      "auth_logged_in",
    ]);
  });

  it("clears every session cookie, the refresh cookie on its own path", () => {
    const j = jar();
    clearSessionCookies(j);
    expect(j.delete).toHaveBeenCalledWith({ name: "auth_refresh", path: "/api/v1/auth/refresh" });
    expect(j.delete.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(["auth_token", "auth_session", "auth_logged_in", "x_tenant_id", "impersonating"]),
    );
  });
});
