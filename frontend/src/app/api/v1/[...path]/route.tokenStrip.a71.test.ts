/**
 * @jest-environment node
 */
// A-71 — no response that reaches the browser carries an access token.
//
// The catch-all proxy answers the sign-ins that do not have a route of their
// own — POST /auth/mfa/login and POST /auth/impersonate — whose backend body
// carries the access token at the top-level `token` (response.util login()).
// It wrote that token into the httpOnly `auth_token` cookie AND passed the
// body through untouched, so any script on the page (an XSS) could read the
// bearer token the httpOnly cookie exists to hide.

const cookieStore = {
  get: jest.fn(),
  set: jest.fn(),
};

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => cookieStore),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const backendAnswers = (body: unknown, { ok = true, status = 200 } = {}) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  }) as jest.Mock;
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

const SIGN_IN = {
  success: true,
  status: 200,
  message: "Login successful",
  data: { id: "u-1", username: "ada" },
  token: "ACCESS.TOKEN.JWT",
  session: { id: "session-1", createdAt: "2026-09-24T00:00:00Z" },
};

describe("A-71: the proxy keeps the access token out of the browser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cookieStore.get.mockReturnValue(undefined);
  });

  it.each([
    [["auth", "mfa", "login"]],
    [["auth", "impersonate"]],
  ])("POST /api/v1/%p: the token becomes the httpOnly cookie and is gone from the body", async (path) => {
    backendAnswers(SIGN_IN);

    const res = await post(path);
    const body = await res.json();

    expect(cookieStore.set).toHaveBeenCalledWith(
      "auth_token",
      "ACCESS.TOKEN.JWT",
      expect.objectContaining({ httpOnly: true }),
    );
    expect(body).not.toHaveProperty("token");
    expect(JSON.stringify(body)).not.toContain("ACCESS.TOKEN.JWT");
    // Everything else the client reads is still there.
    expect(body).toEqual({
      success: true,
      status: 200,
      message: "Login successful",
      data: { id: "u-1", username: "ada" },
      session: { id: "session-1", createdAt: "2026-09-24T00:00:00Z" },
    });
  });

  it("a refresh token at the top level is removed too", async () => {
    backendAnswers({ ...SIGN_IN, refreshToken: "opaque-refresh" });

    const body = await (await post(["auth", "mfa", "login"])).json();

    expect(body).not.toHaveProperty("refreshToken");
    expect(body).not.toHaveProperty("token");
  });

  it("a body with no token is passed through byte for byte", async () => {
    const plain = { success: true, status: 200, message: "ok", data: [{ token: "a-nested-device-token" }] };
    backendAnswers(plain);

    const res = await post(["iot", "devices"]);

    expect(await res.json()).toEqual(plain);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("an error body is passed through as it is", async () => {
    backendAnswers({ success: false, status: 401, message: "Invalid MFA code" }, { ok: false, status: 401 });

    const res = await post(["auth", "mfa", "login"]);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, status: 401, message: "Invalid MFA code" });
  });
});
