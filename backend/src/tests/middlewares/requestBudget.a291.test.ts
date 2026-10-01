/**
 * ADR-100 — middlewares/requestBudget.middleware.ts, and the limiter changes
 * that went with it (rateLimiter.redis.service: `countsFailuresByIp`'s
 * production default, Retry-After on every 429). The routes that mount the
 * budgets are routes/authRequestBudget.a291.
 */
import type { NextFunction, Request, Response } from "express";
import * as budget from "../../middlewares/requestBudget.middleware";
import * as activityLog from "../../middlewares/activityLog.middleware";
import * as rateLimiter from "../../services/rateLimiter.redis.service";
import { environment } from "../../config/env";

const env = environment();
const saved = { ...env };
/** Unset a variable (process.env keeps no undefined values). */
const unset = (key: string): void => {
  Reflect.deleteProperty(env, key);
};
afterEach(() => {
  for (const key of ["NODE_ENV", "RATE_LIMIT_NON_PRODUCTION_FACTOR", "AUTH_RATE_LIMIT_BY_IP"]) {
    const value = saved[key];
    if (value === undefined) {
      unset(key);
    } else {
      env[key] = value;
    }
  }
  jest.restoreAllMocks();
  rateLimiter.clearMemoryStore();
});

type FakeRes = Response & { statusCode: number; body?: unknown; headers: Record<string, string> };

const fakeRes = (): FakeRes => {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    headers,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
      return res;
    },
  };
  return res as unknown as FakeRes;
};

describe("effectiveLimit / nonProductionFactor", () => {
  it("production uses the figure as written", () => {
    env["NODE_ENV"] = "production";
    expect(budget.effectiveLimit(10)).toBe(10);
  });
  it("outside production multiplies by the factor (default 100; a bad value is 100)", () => {
    env["NODE_ENV"] = "test";
    unset("RATE_LIMIT_NON_PRODUCTION_FACTOR");
    expect(budget.effectiveLimit(10)).toBe(1000);
    env["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = "3";
    expect(budget.effectiveLimit(10)).toBe(30);
    for (const bad of ["0", "-2", "abc"]) {
      env["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = bad;
      expect(budget.nonProductionFactor()).toBe(100);
    }
  });
});

describe("hashedKey", () => {
  it("is case- and whitespace-insensitive and never the value itself", () => {
    expect(budget.hashedKey(" A@B.test ")).toBe(budget.hashedKey("a@b.test"));
    expect(budget.hashedKey("a@b.test")).not.toContain("a@b");
  });
});

describe("requestBudget", () => {
  it("counts per address, falling back to the socket address, then 'unknown'", async () => {
    env["NODE_ENV"] = "production";
    const mw = budget.requestBudget("authRegister");
    const next = jest.fn() as NextFunction;
    for (let i = 0; i < 10; i += 1) {
      await mw({ ip: "", socket: { remoteAddress: "192.0.2.9" } } as unknown as Request, fakeRes(), next);
    }
    const res = fakeRes();
    await mw({ socket: { remoteAddress: "192.0.2.9" } } as unknown as Request, res, next);
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toMatch(/^\d+$/);
    // No address at all is one shared "unknown" bucket, still counted.
    await mw({ socket: {} } as unknown as Request, fakeRes(), next);
    expect(next).toHaveBeenCalledTimes(11);
  });

  it("a derived key alone (perAddress: false), skipped when the request has none", async () => {
    env["NODE_ENV"] = "production";
    const mw = budget.requestBudget("authOtpRecipient", { perAddress: false, keyOf: (req) => (req.body as { k?: string }).k ?? null });
    const next = jest.fn() as NextFunction;
    for (let i = 0; i < 3; i += 1) {
      await mw({ body: { k: "x" } } as unknown as Request, fakeRes(), next);
    }
    const res = fakeRes();
    await mw({ body: { k: "x" } } as unknown as Request, res, next);
    expect(res.statusCode).toBe(429);
    await mw({ body: {} } as unknown as Request, fakeRes(), next);
    expect(next).toHaveBeenCalledTimes(4);
  });

  it("a programming error is logged and the request proceeds (the endpointRateLimiter rule)", async () => {
    const error = jest.spyOn(activityLog.logger, "error").mockImplementation(() => activityLog.logger);
    const next = jest.fn() as NextFunction;
    await budget.requestBudget("authSignIn", {
      keyOf: () => {
        throw new Error("boom");
      },
    })({ ip: "1.1.1.1" } as unknown as Request, fakeRes(), next);
    await budget.requestBudget("authSignIn", {
      keyOf: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- a non-Error throw is what the String() branch is for
        throw "text";
      },
    })({ ip: "1.1.1.1" } as unknown as Request, fakeRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(error).toHaveBeenCalledWith(expect.stringContaining("text"));
  });
});

describe("rateLimiter.countsFailuresByIp (ADR-100: on by default in production)", () => {
  it.each([
    [undefined, "production", true],
    [undefined, "test", false],
    ["", "production", true],
    ["true", "test", true],
    ["false", "production", false],
  ])("AUTH_RATE_LIMIT_BY_IP=%s, NODE_ENV=%s → %s", (flag, nodeEnv, expected) => {
    if (flag === undefined) {
      unset("AUTH_RATE_LIMIT_BY_IP");
    } else {
      env["AUTH_RATE_LIMIT_BY_IP"] = flag;
    }
    env["NODE_ENV"] = nodeEnv;
    expect(rateLimiter.countsFailuresByIp()).toBe(expected);
  });
});
