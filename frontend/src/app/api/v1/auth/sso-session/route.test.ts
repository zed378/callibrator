/**
 * @jest-environment node
 */
// A-60 — /api/v1/auth/sso-session used to write whatever `token` the browser
// posted into the httpOnly auth cookie, unverified. It now accepts only the
// one-time SSO code and takes the tokens from the backend's exchange.

const cookieStore = {
  set: jest.fn(),
};

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => cookieStore),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const CODE = "abcdefghijklmnopqrstuvwxyz0123456789-_ABCDE"; // 43 base64url chars

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest("http://localhost/api/v1/auth/sso-session", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const backendAnswers = (status: number, payload: unknown) =>
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  });

describe("POST /api/v1/auth/sso-session (A-60)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as jest.Mock;
  });

  it("sso-session refuses a posted raw token", async () => {
    const res = await post({ token: "eyJhbGciOiJSUzI1NiJ9.eyJpZCI6IngifQ.sig" });

    expect(res.status).toBe(400);
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a token posted alongside a malformed code", async () => {
    const res = await post({ token: "jwt", session: "s", code: "short" });

    expect(res.status).toBe(400);
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    const res = await post("not json");

    expect(res.status).toBe(400);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("exchanges the code server-to-server and sets the same cookies as login", async () => {
    backendAnswers(200, {
      success: true,
      message: "Login successful",
      data: { id: "u1", email: "a@b.c", tenantId: "t1" },
      token: "access-jwt",
      session: { id: "session-1" },
    });

    const res = await post(
      { code: CODE },
      { "user-agent": "browser-ua", "x-forwarded-for": "203.0.113.9" },
    );

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/auth\/sso\/exchange$/),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ code: CODE }),
        headers: expect.objectContaining({
          "User-Agent": "browser-ua",
          "X-Forwarded-For": "203.0.113.9",
        }),
      }),
    );

    const set = Object.fromEntries(
      cookieStore.set.mock.calls.map(([name, value, opts]) => [name, { value, opts }]),
    );
    expect(set.auth_token).toEqual({
      value: "access-jwt",
      opts: expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    });
    expect(set.auth_session).toEqual({
      value: "session-1",
      opts: expect.objectContaining({ httpOnly: true }),
    });
    expect(set.auth_logged_in).toEqual({
      value: "true",
      opts: expect.objectContaining({ httpOnly: false }),
    });

    // The access token stays in the httpOnly cookie; it is not handed to JS.
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      status: 200,
      message: "Login successful",
      data: { id: "u1", email: "a@b.c", tenantId: "t1" },
    });
    expect(JSON.stringify(json)).not.toContain("access-jwt");
  });

  it("A-16: the SSO proxy does not forward a browser-supplied X-Forwarded-For verbatim", async () => {
    backendAnswers(401, { success: false, message: "Invalid or expired SSO code" });

    await post({ code: CODE }, { "x-forwarded-for": "6.6.6.6, 203.0.113.9" });

    const sent = (global.fetch as jest.Mock).mock.calls[0][1].headers;
    expect(sent["X-Forwarded-For"]).toBe("203.0.113.9");

    (global.fetch as jest.Mock).mockClear();
    backendAnswers(401, { success: false });
    await post({ code: CODE }, { "x-forwarded-for": "forged" });
    expect((global.fetch as jest.Mock).mock.calls[0][1].headers).not.toHaveProperty(
      "X-Forwarded-For",
    );
  });

  it("sets no cookie when the backend refuses the code", async () => {
    backendAnswers(401, { success: false, message: "Invalid or expired SSO code" });

    const res = await post({ code: CODE });

    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe("Invalid or expired SSO code");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the backend refusal has no body", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => {
        throw new Error("no body");
      },
    });

    const res = await post({ code: CODE });

    expect(res.status).toBe(429);
    expect((await res.json()).message).toBe("SSO sign-in failed");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("answers 502 and sets no cookie when a 2xx carries no usable session", async () => {
    backendAnswers(200, { success: true, token: "access-jwt", session: null });

    const res = await post({ code: CODE });

    expect(res.status).toBe(502);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("answers 502 when a 2xx does not report success", async () => {
    backendAnswers(200, { success: false });

    const res = await post({ code: CODE });

    expect(res.status).toBe(502);
    expect((await res.json()).message).toBe("SSO sign-in failed");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("uses defaults when the backend omits message and data", async () => {
    backendAnswers(200, { success: true, token: "access-jwt", session: { id: "s" } });

    const res = await post({ code: CODE });

    expect(await res.json()).toEqual({
      success: true,
      status: 200,
      message: "Login successful",
      data: null,
    });
  });

  it("answers 502 and sets no cookie when the backend is unreachable", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await post({ code: CODE });

    expect(res.status).toBe(502);
    expect(cookieStore.set).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
