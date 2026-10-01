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
const http = require("http");
const express = require("express");
const helmet = require("helmet");
const { API_CSP_DIRECTIVES, API_DOCS_CSP_DIRECTIVES, renderCsp, apiDocsCsp } = require("../../utils/csp.util");

const directive = (header, name) =>
  header
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));

const serve = async (configure) => {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: { ...API_CSP_DIRECTIVES } } }));
  configure(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    get: async (path) => {
      const res = await fetch(`${base}${path}`, { redirect: "manual" });
      return { status: res.status, csp: res.headers.get("content-security-policy") || "", body: await res.text() };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

describe("P7-08 CSP split", () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, SWAGGER_ENABLED: process.env.SWAGGER_ENABLED };
  afterEach(() => {
    process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.SWAGGER_ENABLED === undefined) {
      delete process.env.SWAGGER_ENABLED;
    } else {
      process.env.SWAGGER_ENABLED = saved.SWAGGER_ENABLED;
    }
  });

  it("the API default policy has no 'unsafe-inline' for scripts, and blocks inline handlers", async () => {
    const app = await serve((a) => a.get("/api/v1/thing", (req, res) => res.json({ ok: true })));
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
    apiDocsCsp({}, res, next);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Security-Policy", renderCsp(API_DOCS_CSP_DIRECTIVES));
    expect(next).toHaveBeenCalled();
  });

  describe("S-23 — Swagger is not published in production by default", () => {
    const { apiDocsEnabled: swaggerEnabled } = require("../../docs/apiDocs");

    it.each([
      ["production", undefined, false],
      ["production", "true", true],
      ["production", "false", false],
      ["development", undefined, true],
      ["development", "false", false],
    ])("NODE_ENV=%s SWAGGER_ENABLED=%p -> %p", (env, flag, expected) => {
      process.env.NODE_ENV = env;
      if (flag === undefined) {
        delete process.env.SWAGGER_ENABLED;
      } else {
        process.env.SWAGGER_ENABLED = flag;
      }
      expect(swaggerEnabled()).toBe(expected);
    });

    it("in production /docs and /docs.json answer 404", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.SWAGGER_ENABLED;
      const { apiDocs: swaggerDocs } = require("../../docs/apiDocs");
      const app = await serve((a) => expect(swaggerDocs(a)).toBe(false));
      expect((await app.get("/docs/")).status).toBe(404);
      expect((await app.get("/docs.json")).status).toBe(404);
      await app.close();
    });
  });
});
