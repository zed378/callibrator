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

// What the /sso-callback page's same-origin fetch carries (F-09).
const SAME_ORIGIN = { origin: "http://localhost", "sec-fetch-site": "same-origin" };

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest("http://localhost/api/v1/auth/sso-session", {
      method: "POST",
      headers: { "content-type": "application/json", ...SAME_ORIGIN, ...headers },
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

// F-09 — the frontend audit's card for the same endpoint. A-60 made the route
// exchange a one-time code instead of storing a posted token; F-09 adds that
// only a page on this origin may call it. Each Definition-of-Done case, named.
describe("POST /api/v1/auth/sso-session (F-09)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as jest.Mock;
  });

  it("F-09 valid: a same-origin code the backend confirms writes the cookies", async () => {
    backendAnswers(200, { success: true, token: "access-jwt", session: { id: "s-1" } });

    const res = await post({ code: CODE });

    expect(res.status).toBe(200);
    expect(cookieStore.set).toHaveBeenCalledWith("auth_token", "access-jwt", expect.anything());
  });

  it("F-09 forged: a token the backend does not confirm writes no cookie", async () => {
    // A forged or guessed code — the backend's exchange is the verifier.
    backendAnswers(401, { success: false, message: "Invalid or expired SSO code" });

    const res = await post({ code: "F".repeat(43) });

    expect(res.status).toBe(401);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("F-09 replayed: a code spent once writes no cookie the second time", async () => {
    backendAnswers(200, { success: true, token: "access-jwt", session: { id: "s-1" } });
    // The backend reads the code with GETDEL (A-60): the second exchange is refused.
    backendAnswers(401, { success: false, message: "Invalid or expired SSO code" });

    expect((await post({ code: CODE })).status).toBe(200);
    cookieStore.set.mockClear();

    const replay = await post({ code: CODE });

    expect(replay.status).toBe(401);
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("F-09 cross-origin: another site's Origin is refused before the backend is asked", async () => {
    const res = await post({ code: CODE }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" });

    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("F-09 cross-origin: a cross-site Sec-Fetch-Site is refused even with a matching Origin", async () => {
    const res = await post({ code: CODE }, { "sec-fetch-site": "same-site" });

    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("F-09 missing origin: a request with no Origin is refused", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/v1/auth/sso-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: CODE }),
      }),
    );

    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("F-09: behind nginx the Origin is compared with the Host the request arrived on", async () => {
    backendAnswers(200, { success: true, token: "access-jwt", session: { id: "s-1" } });

    const res = await POST(
      new NextRequest("http://10.0.0.5:3000/api/v1/auth/sso-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "kalibrasi.example",
          origin: "https://kalibrasi.example",
        },
        body: JSON.stringify({ code: CODE }),
      }),
    );

    expect(res.status).toBe(200);
  });
});
