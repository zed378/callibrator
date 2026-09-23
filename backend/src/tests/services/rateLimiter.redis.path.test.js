/**
 * rateLimiter.redis.service — the Redis path (A-30)
 *
 * The limiter used to build a client inside a `getRedis()` that was never
 * called, so every counter lived in an in-process Map and twelve
 * `istanbul ignore` comments excluded the Redis arms from coverage. These are
 * the tests for those arms, now that they are reachable.
 *
 * The fake client below carries ONLY properties ioredis actually has:
 * `status`, `get`, `set`, `del`, `eval`, `pttl`. It deliberately does NOT
 * present a working `connected` property — a mock that invented one is how
 * redis.service stayed green for months while every helper was a no-op. It
 * does expose `connected` as a tripwire that records any read, and one test
 * asserts the limiter never touches it.
 *
 * The Lua script's own semantics are NOT proved here — a mocked `eval` proves
 * the client, not the contract. That is what rateLimiter.redis.live.test.js
 * does, against a real Redis.
 */

let mockClient = null;
let mockGetConnection = () => mockClient;
let mockConnectedReads = 0;

jest.mock("../../services/redis.service", () => ({
  getRedisConnection: jest.fn(() => mockGetConnection()),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../models", () => ({
  Users: { update: jest.fn(() => Promise.resolve([1])) },
  Sessions: { update: jest.fn(() => Promise.resolve([1])) },
}));

jest.mock("../../utils/session.util", () => ({
  hashToken: jest.fn((token) => `hash:${token}`),
}));

jest.mock("../../utils/jwt.util", () => ({
  verifyAccessToken: jest.fn(),
}));

/**
 * A client shaped like a ready ioredis connection.
 * @param {object} [overrides]
 */
function makeClient(overrides = {}) {
  const client = {
    status: "ready",
    get: jest.fn(() => Promise.resolve(null)),
    set: jest.fn(() => Promise.resolve("OK")),
    del: jest.fn(() => Promise.resolve(1)),
    eval: jest.fn(() => Promise.resolve("")),
    pttl: jest.fn(() => Promise.resolve(60000)),
    ...overrides,
  };
  // Tripwire, not a feature: real ioredis has no `connected`. If the limiter
  // ever guards on it again, "never reads a `connected` property" fails.
  Object.defineProperty(client, "connected", {
    get() {
      mockConnectedReads += 1;
      return false;
    },
  });
  return client;
}

function makeRes() {
  const res = {
    statusCode: 200,
    status: jest.fn(() => res),
    json: jest.fn(() => res),
    set: jest.fn(() => res),
  };
  return res;
}

describe("rateLimiter.redis.service — the Redis path (A-30)", () => {
  let rl;
  let logger;

  beforeEach(() => {
    jest.resetModules();
    mockConnectedReads = 0;
    mockClient = makeClient();
    mockGetConnection = () => mockClient;
    rl = require("../../services/rateLimiter.redis.service");
    ({ logger } = require("../../middlewares/activityLog.middleware"));
    rl.clearMemoryStore();
  });

  // ============================================================
  // Which client, and when
  // ============================================================
  describe("client selection", () => {
    it("uses the shared redis.service client instead of constructing its own", async () => {
      const { getRedisConnection } = require("../../services/redis.service");

      await rl.recordAuthFailure({ userId: "u-1", endpoint: "login" });

      expect(getRedisConnection).toHaveBeenCalled();
      expect(mockClient.eval).toHaveBeenCalledTimes(1);
    });

    it("never reads a `connected` property — ioredis has none", async () => {
      await rl.recordAuthFailure({ userId: "u-1", endpoint: "login" });
      await rl.checkAuthLockout({ userId: "u-1", endpoint: "login" });
      await rl.resetAuthFailures({ userId: "u-1", endpoint: "login" });

      expect(mockConnectedReads).toBe(0);
    });

    it("counts in memory, not in Redis, while the client is not ready", async () => {
      mockClient.status = "reconnecting";

      const first = await rl.recordAuthFailure({ userId: "u-2", endpoint: "login" });
      const second = await rl.recordAuthFailure({ userId: "u-2", endpoint: "login" });

      expect(mockClient.eval).not.toHaveBeenCalled();
      // Still counted — a Redis outage must never leave a request unlimited.
      expect(first.remainingAttempts).toBe(4);
      expect(second.remainingAttempts).toBe(3);
    });

    it("counts in memory when redis.service has no client at all", async () => {
      mockGetConnection = () => null;

      const result = await rl.recordAuthFailure({ userId: "u-3", endpoint: "login" });

      expect(result.remainingAttempts).toBe(4);
    });

    it("warns and counts in memory when the shared client cannot be obtained", async () => {
      mockGetConnection = () => {
        throw new Error("redis.service exploded");
      };

      const result = await rl.recordAuthFailure({ userId: "u-4", endpoint: "login" });

      expect(result.remainingAttempts).toBe(4);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("could not reach the shared Redis client"),
      );
    });
  });

  // ============================================================
  // Auth counters
  // ============================================================
  describe("auth failure counters", () => {
    it("increments the shared key in a single atomic EVAL", async () => {
      await rl.recordAuthFailure({ userId: "u-5", endpoint: "login" });

      expect(mockClient.eval).toHaveBeenCalledTimes(1);
      const [script, numKeys, key, ttl, now] = mockClient.eval.mock.calls[0];
      expect(script).toContain("redis.call('GET', KEYS[1])");
      expect(script).toContain("'PX', ttl");
      expect(numKeys).toBe(1);
      expect(key).toBe("ratelimit:auth:login:user:u-5");
      expect(ttl).toBe(String(15 * 60 * 1000));
      expect(Number(now)).toBeGreaterThan(0);
      // One round trip: no read-then-write, and no separate expiry command.
      expect(mockClient.get).not.toHaveBeenCalled();
      expect(mockClient.set).not.toHaveBeenCalled();
    });

    it("continues from a count another replica already wrote", async () => {
      mockClient.eval.mockResolvedValue(
        JSON.stringify({ count: 3, firstAttempt: Date.now() - 1000 }),
      );

      const result = await rl.recordAuthFailure({ userId: "u-6", endpoint: "login" });

      expect(result.remainingAttempts).toBe(1);
      expect(result.allowed).toBe(true);
    });

    it("locks the account out on the fifth failure even when the first four were another replica's", async () => {
      mockClient.eval.mockResolvedValue(
        JSON.stringify({ count: 4, firstAttempt: Date.now() - 1000 }),
      );

      const result = await rl.recordAuthFailure({ userId: "u-7", endpoint: "login" });

      expect(result.allowed).toBe(false);
      expect(result.remainingAttempts).toBe(0);
      expect(result.lockoutReason).toContain("Login endpoint");
      const { Users } = require("../../models");
      expect(Users.update).toHaveBeenCalledWith(
        expect.objectContaining({ failedLoginAttempts: 5 }),
        { where: { id: "u-7" } },
      );
    });

    it("treats an absent Redis key as the first attempt", async () => {
      mockClient.eval.mockResolvedValue("");

      const result = await rl.recordAuthFailure({ userId: "u-8", endpoint: "login" });

      expect(result.remainingAttempts).toBe(4);
    });

    it("keeps counting in memory when the EVAL fails mid-flight", async () => {
      mockClient.eval.mockRejectedValue(new Error("LOADING Redis is loading"));

      const first = await rl.recordAuthFailure({ userId: "u-9", endpoint: "login" });
      const second = await rl.recordAuthFailure({ userId: "u-9", endpoint: "login" });

      expect(first.remainingAttempts).toBe(4);
      expect(second.remainingAttempts).toBe(3);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Redis INCR failed, counting in memory"),
      );
    });

    it("reads an existing lockout back out of Redis", async () => {
      mockClient.get.mockResolvedValue(
        JSON.stringify({ count: 5, firstAttempt: Date.now(), expiresAt: Date.now() + 60000 }),
      );

      const lockout = await rl.checkAuthLockout({ userId: "u-10", endpoint: "login" });

      expect(mockClient.get).toHaveBeenCalledWith("ratelimit:auth:login:user:u-10");
      expect(lockout.locked).toBe(true);
      expect(lockout.reason).toBe("Account temporarily locked");
    });

    it("reports no lockout when Redis holds no entry", async () => {
      mockClient.get.mockResolvedValue(null);

      const lockout = await rl.checkAuthLockout({ userId: "u-11", endpoint: "login" });

      expect(lockout).toEqual({ locked: false });
    });

    it("reads the memory copy when the Redis GET fails", async () => {
      mockClient.eval.mockRejectedValue(new Error("connection lost"));
      mockClient.get.mockRejectedValue(new Error("connection lost"));

      for (let i = 0; i < 5; i += 1) {
        await rl.recordAuthFailure({ userId: "u-12", endpoint: "login" });
      }
      const lockout = await rl.checkAuthLockout({ userId: "u-12", endpoint: "login" });

      // Degraded to one process, but still locked — not un-rate-limited.
      expect(lockout.locked).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Redis GET failed, reading the memory fallback"),
      );
    });

    it("writes an absolute expiresAt to Redis so a blocked token reads as blocked on either backend", async () => {
      mockClient.eval.mockResolvedValue(
        JSON.stringify({ count: 9, firstAttempt: Date.now() - 5000 }),
      );

      await rl.recordAuthFailure({ tokenHash: "th-1", endpoint: "login" });

      const blockedWrite = mockClient.set.mock.calls.find(([, value]) =>
        JSON.parse(value).blocked === true,
      );
      expect(blockedWrite).toBeDefined();
      const [key, value, pxFlag, ttl] = blockedWrite;
      expect(key).toBe("ratelimit:auth:login:token:th-1");
      expect(pxFlag).toBe("PX");
      expect(ttl).toBe(15 * 60 * 1000);
      const stored = JSON.parse(value);
      expect(stored.expiresAt).toBeGreaterThan(Date.now());

      // The parity that matters: isTokenBlocked compares now < entry.expiresAt.
      // Without expiresAt in the Redis payload it would answer "not blocked"
      // for every blocked token the moment Redis became the backend.
      mockClient.get.mockResolvedValue(value);
      const status = await rl.isTokenBlocked("raw-token", "login");
      expect(status.isBlocked).toBe(true);
    });

    it("records a revocation in memory when the Redis SET fails", async () => {
      mockClient.eval.mockResolvedValue(
        JSON.stringify({ count: 2, firstAttempt: Date.now() - 500 }),
      );
      mockClient.set.mockRejectedValue(new Error("READONLY replica"));

      await rl.recordAuthFailure({ tokenHash: "th-2", endpoint: "login" });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Redis SET failed, counting in memory"),
      );
      mockClient.status = "end";
      const status = await rl.getRateLimitStatus({
        tokenHash: "th-2",
        endpoint: "login",
        type: "auth",
      });
      expect(status.token.count).toBe(3);
    });

    it("clears the shared key and the local copy on a successful login", async () => {
      mockClient.eval.mockRejectedValue(new Error("offline"));
      await rl.recordAuthFailure({ userId: "u-13", endpoint: "login" });
      mockClient.eval.mockResolvedValue("");

      await rl.resetAuthFailures({ userId: "u-13", endpoint: "login" });

      expect(mockClient.del).toHaveBeenCalledWith("ratelimit:auth:login:user:u-13");
      // The counter taken while Redis was down must not outlive the reset.
      mockClient.status = "end";
      const status = await rl.getRateLimitStatus({
        userId: "u-13",
        endpoint: "login",
        type: "auth",
      });
      expect(status.user).toBeNull();
    });

    it("warns but still clears the local copy when the Redis DEL fails", async () => {
      mockClient.eval.mockRejectedValue(new Error("offline"));
      await rl.recordAuthFailure({ userId: "u-14", endpoint: "login" });
      mockClient.del.mockRejectedValue(new Error("offline"));

      await rl.resetAuthFailures({ userId: "u-14", endpoint: "login" });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Redis DEL failed"),
      );
      mockClient.status = "end";
      const status = await rl.getRateLimitStatus({
        userId: "u-14",
        endpoint: "login",
        type: "auth",
      });
      expect(status.user).toBeNull();
    });
  });

  // ============================================================
  // Endpoint quotas
  // ============================================================
  describe("endpoint quotas", () => {
    it("counts API requests in Redis and blocks once the shared count passes the limit", async () => {
      mockClient.eval.mockResolvedValue(JSON.stringify({ count: 10, firstAttempt: Date.now() }));
      const middleware = rl.endpointRateLimiter("tenantCreate", { maxRequests: 10 });
      const req = { ip: "203.0.113.7", headers: {}, user: null };
      const res = makeRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        "ratelimit:api:tenantCreate:ip:203.0.113.7",
        String(60000),
        expect.any(String),
      );
    });

    it("takes retryAfter from the key's real TTL in Redis", async () => {
      mockClient.eval.mockResolvedValue(JSON.stringify({ count: 10, firstAttempt: Date.now() }));
      mockClient.pttl.mockResolvedValue(9500);
      const middleware = rl.endpointRateLimiter("tenantCreate", { maxRequests: 10 });
      const res = makeRes();

      await middleware({ ip: "203.0.113.8", headers: {}, user: null }, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retryAfter: 10 }));
    });

    it("falls back to the configured window when Redis reports no TTL for the key", async () => {
      mockClient.eval.mockResolvedValue(JSON.stringify({ count: 10, firstAttempt: Date.now() }));
      mockClient.pttl.mockResolvedValue(-1);
      const middleware = rl.endpointRateLimiter("tenantCreate", { maxRequests: 10 });
      const res = makeRes();

      await middleware({ ip: "203.0.113.9", headers: {}, user: null }, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retryAfter: 60 }));
    });

    it("falls back to the configured window when PTTL itself fails", async () => {
      mockClient.eval.mockResolvedValue(JSON.stringify({ count: 10, firstAttempt: Date.now() }));
      mockClient.pttl.mockRejectedValue(new Error("connection lost"));
      const middleware = rl.endpointRateLimiter("tenantCreate", { maxRequests: 10 });
      const res = makeRes();

      await middleware({ ip: "203.0.113.10", headers: {}, user: null }, res, jest.fn());

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Redis PTTL failed"),
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retryAfter: 60 }));
    });

    it("sets the X-RateLimit headers from the count Redis returned", async () => {
      mockClient.eval.mockResolvedValue(JSON.stringify({ count: 2, firstAttempt: Date.now() }));
      const middleware = rl.endpointRateLimiter("tenantCreate", { maxRequests: 10 });
      const res = makeRes();
      const next = jest.fn();

      await middleware({ ip: "203.0.113.11", headers: {}, user: null }, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          "X-RateLimit-Limit": "10",
          "X-RateLimit-Remaining": "7",
        }),
      );
    });
  });
});
