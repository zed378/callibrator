/**
 * @jest-environment node
 */
// A-16 — the login proxy used to pass `req.headers.get("x-forwarded-for")`
// through as it arrived, so the address on the session and the LOGIN audit row
// (and the per-IP limiter's key) could be whatever the browser typed. It now
// sends one sanitized address: the rightmost entry, the one nginx wrote.

const cookieStore = {
  set: jest.fn(),
};

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => cookieStore),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const login = (headers: Record<string, string>) =>
  POST(
    new NextRequest("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ user: "ada", password: "Right-password-1" }),
    }),
  );

const sentHeaders = (): Record<string, string> => {
  expect(global.fetch).toHaveBeenCalledTimes(1);
  return (global.fetch as jest.Mock).mock.calls[0][1].headers as Record<string, string>;
};

describe("POST /api/v1/auth/login — the client address (A-16)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false, message: "Invalid credentials" }),
    }) as jest.Mock;
  });

  it("the login proxy does not forward a browser-supplied X-Forwarded-For verbatim", async () => {
    const res = await login({
      "x-forwarded-for": "6.6.6.6, 203.0.113.9",
      "user-agent": "browser-ua",
    });

    expect(res.status).toBe(401);
    const headers = sentHeaders();
    expect(headers["X-Forwarded-For"]).toBe("203.0.113.9");
    expect(headers["User-Agent"]).toBe("browser-ua");
  });

  it("sends no X-Forwarded-For — not an empty one — when none parses", async () => {
    await login({ "x-forwarded-for": "forged" });

    expect(sentHeaders()).not.toHaveProperty("X-Forwarded-For");
  });
});
