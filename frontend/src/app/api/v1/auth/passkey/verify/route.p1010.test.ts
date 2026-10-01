/**
 * @jest-environment node
 */
/**
 * P10-10 — the Next passkey-verify route writes the session like the login
 * route: httpOnly cookies, and neither token in the body the browser gets
 * (F-62). A refusal passes through with its status and sets nothing. A
 * cross-origin post is refused before the backend is called. A-310: the
 * original scheme is forwarded.
 */
const cookieStore = { set: jest.fn(), get: jest.fn(), delete: jest.fn() };
jest.mock("next/headers", () => ({ cookies: jest.fn(async () => cookieStore) }));

import { NextRequest } from "next/server";
import { POST } from "./route";

const req = (origin = "https://rs.test") =>
  new NextRequest("https://rs.test/api/v1/auth/passkey/verify", {
    method: "POST",
    headers: { "content-type": "application/json", origin, host: "rs.test", "x-forwarded-proto": "https" },
    body: JSON.stringify({ ceremonyId: "c1", credential: { id: "x" } }),
  });

beforeEach(() => jest.clearAllMocks());

describe("POST /api/v1/auth/passkey/verify (P10-10)", () => {
  it("writes the session cookies and strips the tokens", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, status: 200, data: { id: "u1" }, token: "access", refreshToken: "refresh", session: { id: "s1" } }),
    }) as jest.Mock;
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty("token");
    expect(body).not.toHaveProperty("refreshToken");
    expect(body.data.id).toBe("u1");
    const names = cookieStore.set.mock.calls.map((c) => c[0]);
    expect(names).toEqual(expect.arrayContaining(["auth_token", "auth_logged_in"]));
    const init = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("x-forwarded-proto")).toBe("https");
  });

  it("a refused assertion passes through its 401 and sets nothing", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false, status: 401, message: "Passkey sign-in failed" }),
    }) as jest.Mock;
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("a cross-origin post is refused before the backend is called", async () => {
    global.fetch = jest.fn() as jest.Mock;
    const res = await POST(req("https://evil.test"));
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
