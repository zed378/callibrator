/**
 * @jest-environment node
 */
// P10-16 (ADR-099) — a one-time password's first sign-in returns a
// password-change token, not a session. The login proxy must pass it through
// like the MFA step (202, token in the body) and write NO session cookie:
// that token is refused by every backend route but the password change.

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
      body: JSON.stringify({ user: "sys@mail.com", password: "one-time" }),
    }),
  );

describe("POST /api/v1/auth/login — first sign-in with a one-time password (P10-16)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes the password-change token through with 202 and sets no cookie", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        status: 200,
        message: "Password change required",
        data: { id: "u1", passwordChangeRequired: true },
        token: "pc-token",
        refreshToken: null,
        session: null,
      }),
    }) as jest.Mock;

    const res = await login();

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.token).toBe("pc-token");
    expect(body.data.passwordChangeRequired).toBe(true);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});
