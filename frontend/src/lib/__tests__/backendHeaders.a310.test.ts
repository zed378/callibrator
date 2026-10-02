/**
 * @jest-environment node
 */
/**
 * A-310 — with the backend's FORCE_HTTPS=true, a server-side call from Next
 * that does not say the original request was HTTPS is answered 301 to
 * https://<backend>:3000, which the fetch cannot follow, so sign-in 500'd.
 *
 * The backend mock below behaves like forceHttps (health.route.ts): it 301s
 * any request without `X-Forwarded-Proto: https`. Fail-before (recorded):
 * login, refresh, sso-session, logout and logout-all sent no such header and
 * this suite failed on each; now every one forwards the scheme nginx wrote.
 */
const cookieStore = { get: jest.fn(() => ({ value: "tok" })), set: jest.fn(), delete: jest.fn() };
jest.mock("next/headers", () => ({ cookies: jest.fn(async () => cookieStore) }));

import { NextRequest } from "next/server";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { POST as ssoSession } from "@/app/api/v1/auth/sso-session/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { POST as logoutAll } from "@/app/api/v1/auth/logout-all/route";
import { backendForwardHeaders, configuredForwardedProto } from "../backendHeaders";

/** A FORCE_HTTPS backend: 301 unless the call says the original was https. */
const forceHttpsBackend = jest.fn(async (_url: string, init: RequestInit) => {
  const h = new Headers(init.headers);
  if (h.get("x-forwarded-proto") !== "https") {
    return { ok: false, status: 301, json: async () => ({}), headers: new Headers({ location: "https://backend:3000/x" }) };
  }
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ success: true, status: 200, data: { id: "u1" }, token: "t", session: { id: "s" } }),
  };
});

/** A request as nginx delivers it behind TLS: X-Forwarded-Proto https, http to Next. */
const viaNginx = (path: string) =>
  new NextRequest(`http://frontend:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-proto": "https",
      "x-forwarded-for": "203.0.113.7",
      host: "kalibrasi.example.test",
      origin: "https://kalibrasi.example.test",
    },
    body: JSON.stringify({ user: "a", password: "b", code: "a".repeat(43), refreshToken: "r" }),
  });

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = forceHttpsBackend as unknown as typeof fetch;
});

describe("A-310: every server-side backend call forwards the original scheme", () => {
  it.each([
    ["login", login, "/api/v1/auth/login"],
    ["refresh", refresh, "/api/v1/auth/refresh"],
    ["sso-session", ssoSession, "/api/v1/auth/sso-session"],
    ["logout", logout, "/api/v1/auth/logout"],
    ["logout-all", logoutAll, "/api/v1/auth/logout-all"],
  ] as const)("%s sends X-Forwarded-Proto: https and is not redirected", async (_name, handler, path) => {
    await handler(viaNginx(path));
    expect(forceHttpsBackend).toHaveBeenCalled();
    for (const [, init] of forceHttpsBackend.mock.calls) {
      const h = new Headers(init.headers);
      expect(h.get("x-forwarded-proto")).toBe("https");
      expect(h.get("x-forwarded-for")).toBe("203.0.113.7");
    }
  });

  it("a plain-HTTP original stays http (the backend then redirects the browser, as it should)", () => {
    const h = backendForwardHeaders({
      headers: new Headers({ "x-forwarded-proto": "http" }),
      nextUrl: { protocol: "http:" },
    });
    expect(h["X-Forwarded-Proto"]).toBe("http");
  });

  it("a nonsense upstream value falls back to the scheme Next was reached on", () => {
    const h = backendForwardHeaders({
      headers: new Headers({ "x-forwarded-proto": "javascript" }),
      nextUrl: { protocol: "https:" },
    });
    expect(h["X-Forwarded-Proto"]).toBe("https");
  });

  it("cached content with no request uses the configured site's scheme", () => {
    expect(configuredForwardedProto("https://kalibrasi.example.test")).toEqual({ "X-Forwarded-Proto": "https" });
    expect(configuredForwardedProto(undefined)).toEqual({ "X-Forwarded-Proto": "http" });
    expect(configuredForwardedProto("not a url")).toEqual({ "X-Forwarded-Proto": "http" });
  });
});
