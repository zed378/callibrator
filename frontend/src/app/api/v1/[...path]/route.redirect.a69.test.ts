/**
 * @jest-environment node
 */
// A-69 — SSO through the catch-all proxy. On the deployment `/api/` is served
// by Next (ADR-046), so the IdP's redirect_uri lands on this route. Its fetch
// FOLLOWED redirects, so the backend's 302 to /sso-callback?code=… was
// followed here on the server and the browser never received the code.
//
// A-68 adds the one backend cookie the proxy must carry both ways: the OIDC
// sign-in binding (`sso_oidc_binding`), set at the start and read at the
// callback.
//
// No fetch mock: the "backend" is a real HTTP server on an ephemeral port, so
// what is asserted is what undici actually does with `redirect: "manual"`.

import http from "node:http";
import type { AddressInfo } from "node:net";

const cookieStore = {
  get: jest.fn(),
  set: jest.fn(),
};

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => cookieStore),
}));

let mockBackendBase = "";
jest.mock("@/constants", () => ({
  get API_BASE_URL() {
    return mockBackendBase;
  },
}));

import { NextRequest } from "next/server";
import { GET, POST } from "./route";

/** What the backend saw on its last request. */
let seen: { url?: string; cookie?: string } = {};

const backend = http.createServer((req, res) => {
  seen = { url: req.url, cookie: req.headers.cookie };
  if (req.url?.startsWith("/api/v1/auth/sso/oidc/callback/")) {
    // The real callback's answer: a redirect for the browser to follow.
    res.writeHead(302, {
      Location: `${mockBackendBase}/landed?code=one-time-code`,
      "Set-Cookie": [
        "sso_oidc_binding=; Path=/api/v1/auth/sso/oidc; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
      ],
    });
    res.end("Found");
    return;
  }
  if (req.url === "/landed?code=one-time-code") {
    // Where a server-side follow ends up.
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html>followed on the server</html>");
    return;
  }
  if (req.url === "/api/v1/auth/sso/oidc/login") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": [
        "sso_oidc_binding=b1nd1ng; Max-Age=600; Path=/api/v1/auth/sso/oidc; HttpOnly; SameSite=Lax",
        "backend_session=must-not-pass; Path=/",
      ],
    });
    res.end(JSON.stringify({ success: true, data: { redirectUrl: "https://idp.example.com/authorize" } }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end('{"success":true,"data":[]}');
});

const proxy = (method: "GET" | "POST", path: string, search = "") => {
  const handler = method === "GET" ? GET : POST;
  return handler(
    new NextRequest(`http://localhost/api/v1/${path}${search}`, {
      method,
      ...(method === "POST"
        ? { body: JSON.stringify({ tenantCode: "acme" }), headers: { "content-type": "application/json" } }
        : {}),
    }),
    { params: Promise.resolve({ path: path.split("/") }) },
  );
};

const browserCookies = (values: Record<string, string>) => {
  cookieStore.get.mockImplementation((name: string) =>
    name in values ? { name, value: values[name] } : undefined,
  );
};

beforeAll(async () => {
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  mockBackendBase = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => backend.close(resolve));
});

beforeEach(() => {
  jest.clearAllMocks();
  seen = {};
  browserCookies({});
});

describe("/api/v1/[...path] proxy — SSO redirects and the sign-in binding (A-68, A-69)", () => {
  it("the proxy hands the backend's 302 to the browser instead of following it", async () => {
    const res = await proxy("GET", "auth/sso/oidc/callback/acme", "?code=c&state=s");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${mockBackendBase}/landed?code=one-time-code`);
    // The backend was asked once, for the callback — never for the landing page.
    expect(seen.url).toBe("/api/v1/auth/sso/oidc/callback/acme?code=c&state=s");
  });

  it("forwards the browser's sign-in binding — and no other cookie — to the OIDC callback", async () => {
    browserCookies({ sso_oidc_binding: "b1nd1ng", auth_token: "jwt", other: "x" });

    await proxy("GET", "auth/sso/oidc/callback/acme", "?code=c&state=s");

    expect(seen.cookie).toBe("sso_oidc_binding=b1nd1ng");
  });

  it("never forwards the binding cookie to any other route", async () => {
    browserCookies({ sso_oidc_binding: "b1nd1ng" });

    await proxy("GET", "calibration-devices");

    expect(seen.cookie).toBeUndefined();
  });

  it("passes the backend's binding Set-Cookie to the browser and drops every other backend cookie", async () => {
    const res = await proxy("POST", "auth/sso/oidc/login");

    expect(res.status).toBe(200);
    const setCookies = res.headers.getSetCookie();
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]).toMatch(/^sso_oidc_binding=b1nd1ng;/);
    expect(setCookies.join("\n")).not.toContain("backend_session");
  });

  it("passes the callback's clearing of the binding cookie through with the redirect", async () => {
    const res = await proxy("GET", "auth/sso/oidc/callback/acme", "?code=c&state=s");

    expect(res.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^sso_oidc_binding=; .*Expires=Thu, 01 Jan 1970/),
    ]);
  });
});
