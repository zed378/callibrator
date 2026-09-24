/**
 * A-253 — index.js served, unauthenticated and in production:
 *  - GET /error, a test route answering a 500 to anyone;
 *  - GET /documentation and GET /standards, developer pages describing the
 *    internals (middleware order, tenant hooks, where authorization lives);
 *  - GET /tab-permissions, which sent a file that does not exist.
 *
 * Now /error and /tab-permissions are gone, and the two developer pages are
 * registered by swaggerDocs() under the API contract's own switch (S-23): off
 * in production unless SWAGGER_ENABLED=true.
 *
 * Real express and the real swagger module, over HTTP (as csp.p708 does).
 * index.js cannot be required without booting the server, so what it
 * registers is read from its source — the same technique as the P6-04 guard.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "..", "index.js"), "utf8");

const ENV_KEYS = ["NODE_ENV", "SWAGGER_ENABLED"];
const saved = {};
beforeAll(() => {
  for (const k of ENV_KEYS) {saved[k] = process.env[k];}
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) {delete process.env[k];}
    else {process.env[k] = saved[k];}
  }
});

/** An app with swaggerDocs() and a 404 fallback, as index.js mounts them. */
const serve = async (env) => {
  for (const k of ENV_KEYS) {
    if (env[k] === undefined) {delete process.env[k];}
    else {process.env[k] = env[k];}
  }
  let swaggerDocs;
  jest.isolateModules(() => {
    ({ swaggerDocs } = require("../../docs/swagger"));
  });
  const app = express();
  const published = swaggerDocs(app);
  app.use((req, res) => res.status(404).json({ success: false, status: 404 }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    published,
    get: async (p) => {
      const res = await fetch(`${base}${p}`);
      return { status: res.status, body: await res.text() };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

describe("A-253: developer pages are not served in production", () => {
  it("production: /documentation and /standards answer 404, as /docs does", async () => {
    const app = await serve({ NODE_ENV: "production" });
    const pages = await Promise.all(["/documentation", "/standards", "/docs.json"].map((p) => app.get(p)));
    await app.close();

    expect(app.published).toBe(false);
    expect(pages.map((p) => p.status)).toEqual([404, 404, 404]);
  });

  it("production with SWAGGER_ENABLED=true publishes them on purpose", async () => {
    const app = await serve({ NODE_ENV: "production", SWAGGER_ENABLED: "true" });
    const doc = await app.get("/documentation");
    await app.close();

    expect(doc.status).toBe(200);
  });

  it("outside production both pages are served from the shipped docs folder", async () => {
    const app = await serve({ NODE_ENV: "development" });
    const [doc, standards] = await Promise.all([app.get("/documentation"), app.get("/standards")]);
    await app.close();

    expect(doc.status).toBe(200);
    expect(doc.body.length).toBeGreaterThan(0);
    expect(standards.status).toBe(200);
    expect(standards.body.length).toBeGreaterThan(0);
  });

  it("index.js no longer registers them itself, nor /error or /tab-permissions", () => {
    for (const route of ["/documentation", "/standards", "/tab-permissions", "/error"]) {
      expect(INDEX_SOURCE).not.toMatch(new RegExp(`app\\.(get|use|all)\\(\\s*["'\`]${route}["'\`]`));
    }
    // swaggerDocs is still mounted before the 404 handler.
    expect(INDEX_SOURCE.indexOf("swaggerDocs(app)")).toBeGreaterThan(-1);
    expect(INDEX_SOURCE.indexOf("swaggerDocs(app)")).toBeLessThan(INDEX_SOURCE.indexOf("app.use(notFound)"));
  });
});
