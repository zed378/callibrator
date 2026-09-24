/**
 * A-189 — the origin of links the backend hands out (certificate verification
 * URL, attachment signed URL).
 *
 * Behind the Next catch-all the request's Host header is the one Next's own
 * fetch sets, so the old `${req.protocol}://${req.get("host")}` produced
 * `http://backend:3000/...`. The helper now prefers the configured public
 * origin, refuses to guess in production, and in development reads the
 * forwarded origin only through Express's one-hop `trust proxy` (ADR-050).
 *
 * The Express cases run a REAL app on an ephemeral port with the backend's
 * own trust setting, and send the headers the Next proxy sends.
 */
const express = require("express");
const { baseUrlOf } = require("../../utils/publicBaseUrl.util");
const { TRUST_PROXY_HOPS } = require("../../constants");
const { logger } = require("../../middlewares/activityLog.middleware");

const ENV_KEYS = ["PUBLIC_BASE_URL", "HOST_URL", "NODE_ENV"];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.HOST_URL;
  process.env.NODE_ENV = "test";
  jest.spyOn(logger, "error").mockImplementation(() => logger);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {delete process.env[key];} else {process.env[key] = saved[key];}
  }
  jest.restoreAllMocks();
});

const proxiedReq = { protocol: "http", host: "backend:3000", get: () => "backend:3000" };

describe("A-189 — baseUrlOf", () => {
  it("prefers PUBLIC_BASE_URL, without a trailing slash, over the request", () => {
    process.env.PUBLIC_BASE_URL = " https://callibrator.example/ ";
    process.env.HOST_URL = "https://other.example";

    expect(baseUrlOf(proxiedReq)).toBe("https://callibrator.example");
  });

  it("falls back to HOST_URL, the public web origin every deploy config sets", () => {
    process.env.HOST_URL = "https://callibrator.example//";

    expect(baseUrlOf(proxiedReq)).toBe("https://callibrator.example");
  });

  it("in production with neither set, refuses (500, naming the setting) rather than build a link from the request", () => {
    process.env.NODE_ENV = "production";

    expect(() => baseUrlOf(proxiedReq)).toThrow(
      expect.objectContaining({ status: 500, message: expect.stringContaining("PUBLIC_BASE_URL or HOST_URL") }),
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it("outside production with neither set, uses the request's origin as Express resolves it", () => {
    expect(baseUrlOf(proxiedReq)).toBe("http://backend:3000");
  });
});

describe("A-189 — through a real Express app with the backend's trust setting", () => {
  let server;
  let origin;

  beforeAll(async () => {
    const app = express();
    app.set("trust proxy", TRUST_PROXY_HOPS);
    app.get("/origin", (req, res) =>
      res.json({ now: baseUrlOf(req), before: `${req.protocol}://${req.get("host")}` }),
    );
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("the forwarded origin set by the one trusted hop (the Next proxy) is used; the old helper built the proxy-facing host", async () => {
    const res = await fetch(`${origin}/origin`, {
      headers: { "x-forwarded-host": "callibrator.example", "x-forwarded-proto": "https" },
    });

    const body = await res.json();
    expect(body.now).toBe("https://callibrator.example");
    // What A-189 reported: the Host the proxy's fetch sets, not the public one.
    expect(body.before).toBe(`https://${new URL(origin).host}`);
  });

  it("a configured origin wins even over a forwarded one", async () => {
    process.env.PUBLIC_BASE_URL = "https://configured.example";

    const res = await fetch(`${origin}/origin`, {
      headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
    });

    expect((await res.json()).now).toBe("https://configured.example");
  });
});
