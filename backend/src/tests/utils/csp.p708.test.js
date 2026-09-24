/**
 * P7-08 — the API origin's default CSP no longer allows inline script; Swagger
 * gets its own policy under /docs only; and Swagger's page really does work
 * without inline script (every <script> it serves has a src), which is what
 * makes dropping 'unsafe-inline' safe.
 *
 * S-23 — Swagger is not published in production unless SWAGGER_ENABLED=true.
 *
 * Real express + real helmet + the real swagger-ui-express page, over HTTP.
 */
const http = require("http");
const express = require("express");
const helmet = require("helmet");
const { API_CSP_DIRECTIVES, SWAGGER_CSP_DIRECTIVES, renderCsp, swaggerCsp } = require("../../utils/csp.util");

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

  it("/docs carries Swagger's own policy, still without inline script; other paths keep the default", async () => {
    delete process.env.SWAGGER_ENABLED;
    process.env.NODE_ENV = "test";
    const { swaggerDocs } = require("../../docs/swagger");
    const app = await serve((a) => {
      expect(swaggerDocs(a)).toBe(true);
      a.get("/other", (req, res) => res.send("x"));
    });

    const page = await app.get("/docs/");
    const other = await app.get("/other");
    const spec = await app.get("/docs.json");
    await app.close();

    expect(page.status).toBe(200);
    expect(page.csp).toBe(renderCsp(SWAGGER_CSP_DIRECTIVES));
    expect(directive(page.csp, "connect-src")).toBe("connect-src 'self'");
    expect(directive(page.csp, "script-src")).toBe("script-src 'self'");
    expect(directive(other.csp, "connect-src")).toBeUndefined();
    expect(spec.status).toBe(200);

    // What makes the strict script-src safe for Swagger: no inline <script>.
    const scripts = page.body.match(/<script\b[^>]*>/g);
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag).toMatch(/\ssrc=/);
    }
  });

  it("renderCsp renders a value-less directive bare", () => {
    expect(renderCsp({ "default-src": ["'self'"], "upgrade-insecure-requests": [] })).toBe(
      "default-src 'self';upgrade-insecure-requests",
    );
    const res = { setHeader: jest.fn() };
    const next = jest.fn();
    swaggerCsp({}, res, next);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Security-Policy", renderCsp(SWAGGER_CSP_DIRECTIVES));
    expect(next).toHaveBeenCalled();
  });

  describe("S-23 — Swagger is not published in production by default", () => {
    const { swaggerEnabled } = require("../../docs/swagger");

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
      const { swaggerDocs } = require("../../docs/swagger");
      const app = await serve((a) => expect(swaggerDocs(a)).toBe(false));
      expect((await app.get("/docs/")).status).toBe(404);
      expect((await app.get("/docs.json")).status).toBe(404);
      await app.close();
    });
  });
});
