/**
 * @jest-environment node
 */
// F-05 live run (2026-09-29): a session opened through the catch-all proxy
// keeps its refresh token.
//
// POST /auth/mfa/login (every MFA user, so every platform operator) and
// POST /auth/impersonate answer through this proxy with a top-level
// `refreshToken` (backend auth.controller.js → response.util login()). The
// proxy removed it from the body (A-71) but never wrote it anywhere, so the
// refresh route found no `auth_refresh` cookie at the first expiry, cleared
// the session and sent the user to /login. The exact body shape below is what
// the backend sends (checked against the running backend in the live run).

const cookieStore = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => cookieStore),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const backendAnswers = (body: unknown) => {
  global.fetch = jest.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
  ) as jest.Mock;
};

const post = (path: string[]) =>
  POST(
    new NextRequest(`http://localhost/api/v1/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "mfa-purpose-token", code: "123456" }),
    }),
    { params: Promise.resolve({ path }) },
  );

const MFA_SIGN_IN = {
  success: true,
  status: 200,
  message: "Login successful",
  data: { id: "u-1", username: "ada" },
  token: "ACCESS.TOKEN.JWT",
  session: { id: "session-1" },
  refreshToken: "opaque-refresh-token",
};

const written = () => Object.fromEntries(cookieStore.set.mock.calls.map((c) => [c[0], c]));

describe("F-05: the catch-all proxy keeps a sign-in's refresh token", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cookieStore.get.mockReturnValue(undefined);
  });

  it.each([[["auth", "mfa", "login"]], [["auth", "impersonate"]]])(
    "POST /api/v1/%p writes auth_refresh on its own path and the renewable marker",
    async (path) => {
      backendAnswers(MFA_SIGN_IN);
      const body = await (await post(path)).json();

      const c = written();
      expect(c.auth_token[1]).toBe("ACCESS.TOKEN.JWT");
      expect(c.auth_session[1]).toBe("session-1");
      expect(c.auth_refresh[1]).toBe("opaque-refresh-token");
      expect(c.auth_refresh[2]).toMatchObject({ httpOnly: true, path: "/api/v1/auth/refresh" });
      expect(c.auth_renewable[1]).toBe("1");
      expect(c.auth_renewable[2]).toMatchObject({ httpOnly: true, path: "/" });
      // A-71 still holds: neither token reaches the browser.
      expect(JSON.stringify(body)).not.toContain("opaque-refresh-token");
      expect(JSON.stringify(body)).not.toContain("ACCESS.TOKEN.JWT");
    },
  );

  it("a sign-in without a refresh token writes no refresh cookie and no renewable marker", async () => {
    const { refreshToken: _r, ...noRefresh } = MFA_SIGN_IN;
    void _r;
    backendAnswers(noRefresh);
    await post(["auth", "mfa", "login"]);
    expect(Object.keys(written()).sort()).toEqual(["auth_logged_in", "auth_session", "auth_token"]);
  });

  it("a body with only a session id updates the session cookie alone", async () => {
    backendAnswers({ success: true, status: 200, message: "ok", data: {}, session: { id: "session-2" } });
    await post(["sessions", "current"]);
    expect(Object.keys(written())).toEqual(["auth_session"]);
  });
});
