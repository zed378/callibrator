/**
 * ADR-100 Amendment 5 — a request budget is a FIXED window: a refused request
 * is counted but never extends it, so the client is admitted again exactly
 * when Retry-After said, however often it retried in between.
 *
 * Found by the P10-13 live E2E: the budgets were sliding windows that every
 * request refreshed, refused ones included — "10 an hour" behaved as "10, then
 * an hour of silence after the LAST try", and a retrying client or a NAT never
 * got back in. The login failure throttle keeps counting failures, and its
 * pause also ends on schedule: a paused attempt is refused before anything is
 * counted.
 *
 * Memory path (no Redis client is ready in a unit run), with jest's modern
 * fake timers driving Date.now(). The real-Redis path is
 * rateLimiter.fixedWindow.am5.live.
 */
import type { NextFunction, Request, Response } from "express";

// The lock path persists users.locked_until; no database here.
jest.mock("../../models", () => ({
  Users: {
    update: jest.fn(() => Promise.resolve([1])),
    findByPk: jest.fn(() => Promise.resolve(null)),
    findOne: jest.fn(() => Promise.resolve(null)),
  },
}));
import { requestBudget } from "../../middlewares/requestBudget.middleware";
import { environment } from "../../config/env";
import * as rateLimiter from "../../services/rateLimiter.redis.service";
import type * as RateLimitConstants from "../../constants/rateLimitConstants";

const { API_ENDPOINTS, getAuthConfig } = jest.requireActual<typeof RateLimitConstants>("../../constants/rateLimitConstants");

const env = environment();
const savedFactor = env["RATE_LIMIT_NON_PRODUCTION_FACTOR"];
const T0 = new Date("2026-10-01T08:00:00.000Z").getTime();
const MINUTE = 60_000;

beforeEach(() => {
  env["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = "1";
  jest.useFakeTimers({ now: T0 });
  rateLimiter.clearMemoryStore();
});
afterEach(() => {
  jest.useRealTimers();
  env["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = savedFactor ?? "100";
});

interface Answer {
  status: number;
  retryAfter: number | null;
}

/** One request through the budget, from one address. */
const send = async (mw: ReturnType<typeof requestBudget>): Promise<Answer> => {
  const answer: Answer = { status: 200, retryAfter: null };
  const res = {
    setHeader(name: string, value: string) {
      if (name === "Retry-After") {
        answer.retryAfter = Number(value);
      }
      return res;
    },
    // endpointRateLimiter writes its headers through Express's res.set.
    set(name: string | Record<string, string>, value?: string) {
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
  await mw({ ip: "198.51.100.77", socket: {} } as unknown as Request, res as unknown as Response, (() => undefined) as NextFunction);
  return answer;
};

describe.each([
  ["requestBudget (authRegister)", (): ReturnType<typeof requestBudget> => requestBudget("authRegister"), API_ENDPOINTS.authRegister],
  ["endpointRateLimiter (tenantCreate)", (): ReturnType<typeof requestBudget> => rateLimiter.endpointRateLimiter("tenantCreate", { byUser: false, byToken: false }), API_ENDPOINTS.tenantCreate],
])("%s", (_name, make, config) => {
  it("after N admitted and M refused requests, the client is admitted exactly when Retry-After said", async () => {
    const mw = make();
    for (let i = 0; i < config.maxRequests; i += 1) {
      expect((await send(mw)).status).toBe(200);
    }
    // A quarter of the window later, the first refusal: Retry-After counts to the window's end.
    jest.setSystemTime(T0 + config.windowMs / 4);
    const first = await send(mw);
    expect(first.status).toBe(429);
    const promised = first.retryAfter ?? 0;
    expect(promised).toBe(Math.ceil((config.windowMs * 3) / 4 / 1000));

    // It keeps retrying — M more refusals spread over the rest of the window.
    const refusedAt = Date.now();
    for (let i = 1; i <= 5; i += 1) {
      jest.setSystemTime(refusedAt + (i * (promised - 2) * 1000) / 5);
      const again = await send(mw);
      expect(again.status).toBe(429);
      // Each Retry-After still names the SAME instant (to the second).
      expect(Date.now() + (again.retryAfter ?? 0) * 1000).toBeGreaterThanOrEqual(refusedAt + promised * 1000);
      expect(Date.now() + (again.retryAfter ?? 0) * 1000).toBeLessThanOrEqual(refusedAt + promised * 1000 + 1000);
    }

    // One second before the promise it is still closed; at the promise it opens.
    jest.setSystemTime(refusedAt + (promised - 1) * 1000);
    expect((await send(mw)).status).toBe(429);
    jest.setSystemTime(refusedAt + promised * 1000);
    expect((await send(mw)).status).toBe(200);
  });
});

describe("the login failure throttle (failures count; the pause ends on schedule)", () => {
  const attempt = { identifier: "nurse@hospital.test", ip: "198.51.100.88" };

  it("five failures pause the pair; refused attempts during the pause do not extend it", async () => {
    const login = getAuthConfig("login");
    for (let i = 0; i < login.maxAttempts; i += 1) {
      jest.setSystemTime(T0 + i * MINUTE);
      expect((await rateLimiter.checkLoginThrottle(attempt)).throttled).toBe(false);
      await rateLimiter.recordLoginFailure(attempt);
    }
    const paused = await rateLimiter.checkLoginThrottle(attempt);
    expect(paused.throttled).toBe(true);
    const until = Date.now() + paused.retryAfterSeconds * 1000;

    // The caller keeps trying; each attempt is refused BEFORE it is counted (loginUser's order).
    for (let i = 1; i <= 10; i += 1) {
      jest.setSystemTime(T0 + 4 * MINUTE + i * MINUTE);
      const check = await rateLimiter.checkLoginThrottle(attempt);
      expect(check.throttled).toBe(true);
      expect(Date.now() + check.retryAfterSeconds * 1000).toBeLessThanOrEqual(until + 1000);
    }

    jest.setSystemTime(until - 1000);
    expect((await rateLimiter.checkLoginThrottle(attempt)).throttled).toBe(true);
    jest.setSystemTime(until);
    expect((await rateLimiter.checkLoginThrottle(attempt)).throttled).toBe(false);
  });

  it("checkAuthLockout reports the lock's real end, and the lock ends then", async () => {
    const config = getAuthConfig("register");
    for (let i = 0; i < config.maxAttempts; i += 1) {
      jest.setSystemTime(T0 + i * 10 * MINUTE);
      await rateLimiter.recordAuthFailure({ userId: "u-am5", endpoint: "register" });
    }
    const lock = await rateLimiter.checkAuthLockout({ userId: "u-am5", endpoint: "register" });
    expect(lock.locked).toBe(true);
    const end = lock.lockoutUntil?.getTime() ?? 0;
    // Refused callers re-check; nothing is counted, and the end does not move.
    jest.setSystemTime(end - 1000);
    expect((await rateLimiter.checkAuthLockout({ userId: "u-am5", endpoint: "register" })).lockoutUntil?.getTime()).toBe(end);
    jest.setSystemTime(end);
    expect((await rateLimiter.checkAuthLockout({ userId: "u-am5", endpoint: "register" })).locked).toBe(false);
  });

  it("an IP lock reports the counter's expiry, not 'five minutes from now' on every check", async () => {
    const config = getAuthConfig("forgotPassword");
    for (let i = 0; i < config.maxAttempts * 3; i += 1) {
      await rateLimiter.recordAuthFailure({ ip: "203.0.113.5", endpoint: "forgotPassword" });
    }
    const first = await rateLimiter.checkAuthLockout({ ip: "203.0.113.5", endpoint: "forgotPassword" });
    jest.setSystemTime(T0 + 2 * MINUTE);
    const later = await rateLimiter.checkAuthLockout({ ip: "203.0.113.5", endpoint: "forgotPassword" });
    expect(later.lockoutUntil?.getTime()).toBe(first.lockoutUntil?.getTime());
  });
});
