/**
 * DAST 2026-09-29 (MEMORY/records/2026-09-29-dast-live-probe.md): in
 * production a preflight from an origin outside CORS_ORIGIN was answered
 * **500** — index.js called `callback(new Error("Not allowed by CORS"))`, a
 * plain Error the global handler turned into a server error. It is now a 403
 * with no Access-Control-Allow-Origin.
 *
 * The REAL policy (middlewares/corsPolicy.middleware, what index.js mounts)
 * and the REAL global errorHandler, over a real socket.
 */
import http from "http";
import type { AddressInfo } from "net";
import express from "express";
import { environment } from "../../config/env";
import { configuredOrigins, corsPolicy, CORS_REJECTED_MESSAGE } from "../../middlewares/corsPolicy.middleware";
import { errorHandler } from "../../middlewares/errorHandlers.middleware";

const penv = environment();
const saved = { nodeEnv: penv["NODE_ENV"], origins: penv["CORS_ORIGIN"] };
const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    Reflect.deleteProperty(penv, name);
  } else {
    penv[name] = value;
  }
};

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** One request against an app mounting the policy with `origins`. */
const request = async (
  origins: readonly string[] | undefined,
  method: string,
  headers: Record<string, string>,
): Promise<Reply> => {
  const app = express();
  app.use(origins === undefined ? corsPolicy() : corsPolicy(origins));
  app.get("/api/v1/ping", (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise<Reply>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/api/v1/ping", method, headers }, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      });
      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
};

const PREFLIGHT = {
  Origin: "https://evil.example",
  "Access-Control-Request-Method": "POST",
};

afterEach(() => {
  restore("NODE_ENV", saved.nodeEnv);
  restore("CORS_ORIGIN", saved.origins);
});

describe("CORS policy — a rejected origin (DAST 2026-09-29)", () => {
  it.each([
    ["with CORS_ORIGIN configured", ["https://app.example"]],
    ["with no CORS_ORIGIN at all", []],
  ])("production preflight from a foreign origin is a 403 with no ACAO — %s", async (_n, origins) => {
    penv["NODE_ENV"] = "production";
    const res = await request(origins, "OPTIONS", PREFLIGHT);

    expect(res.status).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    expect((JSON.parse(res.body) as { message: string }).message).toBe(CORS_REJECTED_MESSAGE);
  });

  it("a plain GET from a foreign origin in production is refused the same way", async () => {
    penv["NODE_ENV"] = "production";
    const res = await request(["https://app.example"], "GET", { Origin: "https://evil.example" });

    expect(res.status).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("an allowed origin still gets its ACAO and credentials (production)", async () => {
    penv["NODE_ENV"] = "production";
    const res = await request(["https://app.example"], "OPTIONS", { ...PREFLIGHT, Origin: "https://app.example" });

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("no Origin header (server to server) passes", async () => {
    penv["NODE_ENV"] = "production";
    const res = await request(["https://app.example"], "GET", {});

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("outside production any origin is reflected (development default, unchanged)", async () => {
    penv["NODE_ENV"] = "development";
    const res = await request([], "OPTIONS", PREFLIGHT);

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://evil.example");
  });

  it("reads CORS_ORIGIN, comma-separated and trimmed, when no list is passed", async () => {
    penv["CORS_ORIGIN"] = "https://a.example , https://b.example";
    expect(configuredOrigins()).toEqual(["https://a.example", "https://b.example"]);
    penv["NODE_ENV"] = "production";
    const res = await request(undefined, "GET", { Origin: "https://b.example" });
    expect(res.headers["access-control-allow-origin"]).toBe("https://b.example");

    Reflect.deleteProperty(penv, "CORS_ORIGIN");
    expect(configuredOrigins()).toEqual([]);
  });
});
