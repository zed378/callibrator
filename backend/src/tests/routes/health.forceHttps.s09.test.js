/**
 * S-09 / ADR-081 — FORCE_HTTPS must not redirect the probe paths.
 *
 * Found by the first by-the-book `make up ENV=prod` (2026-09-28): the prod
 * overlay sets FORCE_HTTPS=true, the compose healthcheck is
 * `wget http://localhost:3000/health`, and the redirect sent it to
 * https://localhost:3000, which nothing serves — the backend never became
 * healthy and `make up` failed. Driven over real HTTP against a real Express
 * app with the middleware index.js mounts.
 */

jest.mock("../../middlewares/auth.middleware", () => ({
  auth: jest.fn(),
  denyApiKey: jest.fn(),
  superAdminOnly: jest.fn(),
}));

const http = require("http");
const fs = require("fs");
const path = require("path");
const express = require("express");

const { forceHttps, PROBE_PATHS } = require("../../routes/internal/health.route");

let server;
let port;

const get = (urlPath, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method: "GET", headers: { Host: "api.example.test", ...headers } },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode, location: res.headers.location }));
      },
    );
    req.on("error", reject);
    req.end();
  });

beforeAll(async () => {
  const app = express();
  app.use(forceHttps);
  app.get(/.*/, (req, res) => res.status(200).send("ok"));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe("forceHttps (S-09, ADR-081)", () => {
  it.each(["/health", "/live", "/ready"])("answers the probe %s over plain HTTP, no redirect", async (p) => {
    const res = await get(p);
    expect(res.status).toBe(200);
    expect(res.location).toBeUndefined();
  });

  it("still redirects every other plain-HTTP request, path and query preserved", async () => {
    const res = await get("/api/v1/users?page=2");
    expect(res.status).toBe(301);
    expect(res.location).toBe("https://api.example.test/api/v1/users?page=2");
  });

  it("does not exempt a path that merely starts with a probe name", async () => {
    const res = await get("/healthz");
    expect(res.status).toBe(301);
  });

  it("passes a request a TLS-terminating proxy marked https", async () => {
    const res = await get("/api/v1/users", { "X-Forwarded-Proto": "https" });
    expect(res.status).toBe(200);
  });

  it("passes a request that is itself secure", async () => {
    const next = jest.fn();
    forceHttps({ secure: true, get: () => undefined, path: "/api" }, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("the probe list is exactly the three public probe routes", () => {
    expect([...PROBE_PATHS]).toEqual(["/health", "/live", "/ready"]);
  });

  it("index.js mounts this middleware under FORCE_HTTPS, not an inline copy", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../../index.js"), "utf8");
    expect(src).toMatch(/require\("\.\/src\/routes\/internal\/health\.route"\)\.forceHttps/);
    expect(src).not.toMatch(/req\.get\("X-Forwarded-Proto"\) !== "https"/);
  });
});
