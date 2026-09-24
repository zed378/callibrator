/**
 * @jest-environment node
 */
// F-08 / F-05 — the one route guard. It decides where a page navigation goes;
// the backend still authorises every API call.

import { NextRequest } from "next/server";
import { proxy, config } from "./proxy";
import { jwtExpiry, hasUsableSession } from "@/lib/sessionRouting";

const b64url = (o: object) =>
  Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload: object) => `${b64url({ alg: "HS256" })}.${b64url(payload)}.sig`;
const NOW = Math.floor(Date.now() / 1000);
const live = jwt({ sub: "u1", exp: NOW + 600 });
const expired = jwt({ sub: "u1", exp: NOW - 60 });

const request = (path: string, cookies: Record<string, string> = {}) => {
  const req = new NextRequest(`http://localhost${path}`);
  for (const [k, v] of Object.entries(cookies)) req.cookies.set(k, v);
  return req;
};

const clearedCookies = (res: Response) =>
  res.headers
    .getSetCookie()
    .filter((c) => /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c))
    .map((c) => c.split("=")[0]);

describe("proxy (F-08: the only route guard)", () => {
  it("a dashboard route with no token → /login with the page to return to", () => {
    const res = proxy(request("/dashboard/devices"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost/login?callbackUrl=%2Fdashboard%2Fdevices",
    );
    expect(clearedCookies(res)).toEqual([]);
  });

  it("a dashboard route with a live token passes", () => {
    const res = proxy(request("/dashboard", { auth_token: live }));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("F-05: a dashboard route with an EXPIRED, unrenewable token → /login, and the dead cookies are cleared", () => {
    const res = proxy(
      request("/dashboard", { auth_token: expired, auth_session: "s1", x_tenant_id: "t-b" }),
    );
    expect(res.headers.get("location")).toContain("/login");
    expect(clearedCookies(res)).toEqual(
      expect.arrayContaining(["auth_token", "auth_session", "auth_logged_in", "x_tenant_id", "impersonating"]),
    );
  });

  it("F-05: an expired token WITH a refresh cookie still reaches the dashboard (the client renews it)", () => {
    const res = proxy(request("/dashboard", { auth_token: expired, auth_refresh: "r" }));
    expect(res.headers.get("location")).toBeNull();
  });

  it("/login with a live token → /dashboard", () => {
    const res = proxy(request("/login", { auth_token: live }));
    expect(res.headers.get("location")).toBe("http://localhost/dashboard");
    expect(proxy(request("/register", { auth_token: live })).headers.get("location")).toBe(
      "http://localhost/dashboard",
    );
  });

  it("F-05: /login with a DEAD token stays on /login and clears it — no bounce back to /dashboard", () => {
    const res = proxy(request("/login", { auth_token: expired }));
    expect(res.headers.get("location")).toBeNull();
    expect(clearedCookies(res)).toContain("auth_token");
  });

  it("/login with no token, and public pages, pass untouched", () => {
    expect(proxy(request("/login")).headers.get("location")).toBeNull();
    expect(proxy(request("/verify/CERT-1")).headers.get("location")).toBeNull();
  });

  it("does not run for API routes or static assets", () => {
    const [matcher] = config.matcher;
    const re = new RegExp(`^${matcher}$`);
    expect(re.test("/dashboard")).toBe(true);
    expect(re.test("/api/v1/devices")).toBe(false);
    expect(re.test("/_next/static/chunk.js")).toBe(false);
  });
});

describe("sessionRouting helpers", () => {
  it("jwtExpiry reads exp, and null for anything that is not a JWT with one", () => {
    expect(jwtExpiry(live)).toBe(NOW + 600);
    expect(jwtExpiry(jwt({ sub: "u1" }))).toBeNull();
    expect(jwtExpiry("opaque")).toBeNull();
    expect(jwtExpiry("a.%%%.c")).toBeNull();
  });

  it("an opaque (non-JWT) token is treated as usable — the backend decides", () => {
    expect(hasUsableSession(request("/", { auth_token: "opaque" }))).toBe(true);
    expect(hasUsableSession(request("/", {}))).toBe(false);
    expect(hasUsableSession(request("/", { auth_token: live }), NOW + 601)).toBe(false);
  });
});
