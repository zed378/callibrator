/**
 * ADR-100 Amendment 5, against a REAL Redis: a request budget is a fixed
 * window. The Lua script (INCR_FIXED_SCRIPT) counts every request but never
 * moves the key's expiry, so after N admitted and M refused requests the key
 * expires — and the client is admitted — exactly when Retry-After said. The
 * control shows the failure counter's sliding script (storeIncr) DOES move it,
 * which is what the budgets used before.
 *
 * OPT-IN (needs a reachable Redis; never a shared one):
 *
 *   docker run -d --name am5-redis -p 127.0.0.1:56379:6379 redis:7-alpine
 *   REDIS_LIVE_TEST=1 REDIS_URL=redis://127.0.0.1:56379 \
 *     npm test -- src/tests/services/rateLimiter.fixedWindow.am5.live --coverage=false
 *   docker rm -f am5-redis
 */
import * as crypto from "crypto";
import type * as RedisService from "../../services/redis.service";
import type * as RateLimiter from "../../services/rateLimiter.redis.service";
import type * as Budget from "../../middlewares/requestBudget.middleware";
import type { Request, Response } from "express";
import { environment } from "../../config/env";

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../models", () => ({ Users: { update: jest.fn(() => Promise.resolve([1])) } }));

const live = environment()["REDIS_LIVE_TEST"] === "1" ? describe : describe.skip;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

live("fixed request windows — live Redis (ADR-100 Amendment 5)", () => {
  jest.setTimeout(30_000);
  const redisService = jest.requireActual<typeof RedisService>("../../services/redis.service");
  const limiter = jest.requireActual<typeof RateLimiter>("../../services/rateLimiter.redis.service");
  const env = environment();
  const savedFactor = env["RATE_LIMIT_NON_PRODUCTION_FACTOR"];

  beforeAll(async () => {
    await redisService.initRedis();
    env["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = "1";
  });
  afterAll(async () => {
    env["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = savedFactor ?? "100";
    await redisService.closeRedis();
  });

  const key = (): string => `ratelimit:budget:am5:${crypto.randomUUID()}`;

  it("N admitted + M refused: the expiry never moves, and the window reopens exactly at it", async () => {
    const k = key();
    const WINDOW = 1500;
    const LIMIT = 3;
    const first = await limiter.storeIncrFixed(k, WINDOW);
    for (let i = 2; i <= LIMIT; i += 1) {
      expect((await limiter.storeIncrFixed(k, WINDOW)).expiresAt).toBe(first.expiresAt);
    }
    // M refused requests, spread over the window: counted, never extending it.
    for (let i = 0; i < 4; i += 1) {
      await sleep(200);
      const refused = await limiter.storeIncrFixed(k, WINDOW);
      expect(refused.count).toBeGreaterThan(LIMIT);
      expect(refused.expiresAt).toBe(first.expiresAt);
    }
    const ttl = await redisService.getRedisConnection().pttl(k);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(WINDOW - 800 + 50);

    await sleep(Math.max(0, first.expiresAt - Date.now()) + 30);
    const reopened = await limiter.storeIncrFixed(k, WINDOW);
    expect(reopened.count).toBe(1);
    expect(reopened.expiresAt).toBeGreaterThan(first.expiresAt);
  });

  it("control: the sliding failure counter moves its expiry on every increment (what the budgets used before)", async () => {
    const k = key();
    await limiter.storeIncr(k, 1500);
    await sleep(400);
    await limiter.storeIncr(k, 1500);
    const ttl = await redisService.getRedisConnection().pttl(k);
    expect(ttl).toBeGreaterThan(1500 - 150);
  });

  it("through the budget middleware: every refusal's Retry-After names the key's real expiry", async () => {
    const budget = jest.requireActual<typeof Budget>("../../middlewares/requestBudget.middleware");
    const fixedKey = `am5-${crypto.randomUUID()}`;
    const bound = budget.requestBudget("authOtpRecipient", { perAddress: false, keyOf: () => fixedKey });
    const answers: { status: number; retryAfter: number | null }[] = [];
    for (let i = 0; i < 6; i += 1) {
      const answer = { status: 200, retryAfter: null as number | null };
      const res = {
        setHeader(name: string, value: string) {
          if (name === "Retry-After") {
            answer.retryAfter = Number(value);
          }
          return res;
        },
        status(code: number) {
          answer.status = code;
          return res;
        },
        json() {
          return res;
        },
      };
      await bound({ ip: "198.51.100.9", socket: {} } as unknown as Request, res as unknown as Response, () => undefined);
      answers.push(answer);
      await sleep(250);
    }
    // 3 admitted, 3 refused.
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 429, 429, 429]);
    const stored = await redisService.getRedisConnection().pttl(`ratelimit:budget:authOtpRecipient:key:${fixedKey}`);
    const last = answers[5]?.retryAfter ?? 0;
    // The last Retry-After agrees with Redis's own TTL (to the second) — it did not reset to the full window.
    expect(Math.abs(last - Math.ceil(stored / 1000))).toBeLessThanOrEqual(1);
    expect(last).toBeLessThan(15 * 60);
  });
});
