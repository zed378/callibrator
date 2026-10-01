/**
 * Q-53 (ADR-109 §6) — the global limiter's 429 is the house envelope.
 *
 * index.js's defaultLimiter answered `{ status: "Error", message }`: no
 * `success`, a string `status`, no `data` — the one error body outside the
 * envelope CLAUDE.md makes a rule. It now answers
 * `{ success: false, status: 429, message, data: null, retryAfter }` with a
 * `Retry-After` header, as the per-route request budgets do.
 *
 * The REAL express-rate-limit runs, configured exactly as index.js configures
 * it (standard headers, no legacy headers, `message: globalLimitBody`), over a
 * real HTTP server; index.js is read to keep that configuration honest.
 * Fail-before: the second request's body was `{ status: "Error", message }`.
 */
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { globalLimitBody, GLOBAL_LIMIT_MESSAGE } from "../../middlewares/globalRateLimit.middleware";

const INDEX = path.resolve(__dirname, "../../../index.js");

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 1,
      standardHeaders: true,
      legacyHeaders: false,
      message: globalLimitBody,
    }),
  );
  app.get("/ping", (_req, res) => {
    res.json({ success: true, status: 200, message: "pong", data: null });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe("Q-53 — the global limiter's 429", () => {
  it("index.js configures the limiter with globalLimitBody and standard headers", () => {
    const source = fs.readFileSync(INDEX, "utf8");
    const limiter = source.slice(source.indexOf("const defaultLimiter = rateLimit({"));
    const block = limiter.slice(0, limiter.indexOf("});"));
    expect(block).toContain("message: globalLimitBody");
    expect(block).toContain("standardHeaders: true");
    expect(block).not.toContain('status: "Error"');
  });

  it("the refused request gets the envelope, a Retry-After header, and retryAfter equal to it", async () => {
    const first = await fetch(`${base}/ping`);
    expect(first.status).toBe(200);

    const refused = await fetch(`${base}/ping`);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("content-type")).toMatch(/application\/json/);
    const retryAfter = Number(refused.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);

    const body = (await refused.json()) as Record<string, unknown>;
    expect(body).toEqual({ success: false, status: 429, message: GLOBAL_LIMIT_MESSAGE, data: null, retryAfter });
  });

  it("retryAfter is null when no Retry-After header was set", () => {
    const res = { getHeader: (): undefined => undefined };
    const req = {};
    expect(globalLimitBody(req as Parameters<typeof globalLimitBody>[0], res as unknown as Parameters<typeof globalLimitBody>[1]).retryAfter).toBeNull();
  });
});
