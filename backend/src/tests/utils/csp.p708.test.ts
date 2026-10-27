/**
 * P7-08 — the API origin's default CSP no longer allows inline script; Swagger
 * gets its own policy under /docs only; and Swagger's page really does work
 * without inline script (every <script> it serves has a src), which is what
 * makes dropping 'unsafe-inline' safe.
 *
 * S-23 — Swagger is not published in production unless SWAGGER_ENABLED=true.
 *
 * Real express + real helmet, over HTTP. P9-25 (ADR-103): Scalar replaced
 * Swagger UI; the /docs page's own checks are in tests/routes/apiDocs.p925.test.ts.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express, type Request, type Response } from "express";
import helmet from "helmet";
import { environment } from "../../config/env";
import { apiDocs, apiDocsEnabled } from "../../docs/apiDocs";
import { API_CSP_DIRECTIVES, API_DOCS_CSP_DIRECTIVES, renderCsp, apiDocsCsp } from "../../utils/csp.util";

const penv = environment();

const directive = (header: string, name: string): string | undefined =>
  header
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));

interface Served {
    readonly get: (path: string) => Promise<{ status: number; csp: string; body: string }>;
    readonly close: () => Promise<void>;
}

const serve = async (configure: (app: Express) => void): Promise<Served> => {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: { ...API_CSP_DIRECTIVES } } }));
  configure(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return {
    get: async (path) => {
      const res = await fetch(`${base}${path}`, { redirect: "manual" });
      return { status: res.status, csp: res.headers.get("content-security-policy") ?? "", body: await res.text() };
    },
    close: () => new Promise<void>((resolve) => server.close(() => { resolve(); })),
  };
};

describe("P7-08 CSP split", () => {
  const savedNodeEnv = penv["NODE_ENV"];
  const savedSwagger = penv["SWAGGER_ENABLED"];
  afterEach(() => {
    if (savedNodeEnv === undefined) {
      Reflect.deleteProperty(penv, "NODE_ENV");
    } else {
      penv["NODE_ENV"] = savedNodeEnv;
    }
    if (savedSwagger === undefined) {
      Reflect.deleteProperty(penv, "SWAGGER_ENABLED");
    } else {
      penv["SWAGGER_ENABLED"] = savedSwagger;
    }
  });

  it("the API default policy has no 'unsafe-inline' for scripts, and blocks inline handlers", async () => {
    const app = await serve((a) => a.get("/api/v1/thing", (_req, res) => res.json({ ok: true })));
    const { csp } = await app.get("/api/v1/thing");
    await app.close();

    expect(directive(csp, "script-src")).toBe("script-src 'self'");
    expect(directive(csp, "script-src-attr")).toBe("script-src-attr 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("the API reference's policy (P9-25, ADR-103): still no inline script; same-origin connect, style and font only", () => {
    const header = renderCsp(API_DOCS_CSP_DIRECTIVES);
    expect(directive(header, "script-src")).toBe("script-src 'self'");
    expect(directive(header, "connect-src")).toBe("connect-src 'self'");
    expect(directive(header, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive(header, "font-src")).toBe("font-src 'self' data:");
    expect(directive(header, "img-src")).toBe("img-src 'self' data:");
    expect(header).not.toMatch(/https:/);
    // The page itself, over HTTP and behind its gate: tests/routes/apiDocs.p925.test.ts.
  });

  it("renderCsp renders a value-less directive bare", () => {
    expect(renderCsp({ "default-src": ["'self'"], "upgrade-insecure-requests": [] })).toBe(
      "default-src 'self';upgrade-insecure-requests",
    );
    const res = { setHeader: jest.fn() };
    const next = jest.fn();
    apiDocsCsp({} as unknown as Request, res as unknown as Response, next);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Security-Policy", renderCsp(API_DOCS_CSP_DIRECTIVES));
    expect(next).toHaveBeenCalled();
  });

  describe("S-23 — Swagger is not published in production by default", () => {
    it.each([
      ["production", undefined, false],
      ["production", "true", true],
      ["production", "false", false],
      ["development", undefined, true],
      ["development", "false", false],
    ])("NODE_ENV=%s SWAGGER_ENABLED=%p -> %p", (env, flag, expected) => {
      penv["NODE_ENV"] = env;
      if (flag === undefined) {
        Reflect.deleteProperty(penv, "SWAGGER_ENABLED");
      } else {
        penv["SWAGGER_ENABLED"] = flag;
      }
      expect(apiDocsEnabled()).toBe(expected);
    });

    it("in production /docs and /docs.json answer 404", async () => {
      penv["NODE_ENV"] = "production";
      Reflect.deleteProperty(penv, "SWAGGER_ENABLED");
      const app = await serve((a) => { expect(apiDocs(a)).toBe(false); });
      expect((await app.get("/docs/")).status).toBe(404);
      expect((await app.get("/docs.json")).status).toBe(404);
      await app.close();
    });
  });
});
