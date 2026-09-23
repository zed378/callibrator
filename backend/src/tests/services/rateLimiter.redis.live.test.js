/**
 * rateLimiter.redis.service — against a REAL Redis (A-30)
 *
 * The mocked suite (rateLimiter.redis.path.test.js) proves which commands the
 * limiter issues. It cannot prove the Lua script, because a mocked `eval`
 * returns whatever the test says. These tests run the real script on a real
 * server and assert the three properties A-30 is actually about:
 *
 *   1. a lockout outlives the process that recorded it (restart / deploy),
 *   2. two processes share one counter (replicas),
 *   3. concurrent increments never lose one (atomicity).
 *
 * A "replica" here is a separately loaded copy of the module graph: its own
 * in-process Map and its own ioredis connection, exactly like a second pod.
 *
 * OPT-IN — this suite needs a reachable Redis, so it is skipped unless you ask
 * for it:
 *
 *   REDIS_LIVE_TEST=1 npx jest src/tests/services/rateLimiter.redis.live --coverage=false
 *
 * It is not part of the coverage gate; the mocked suite covers the branches.
 */

const crypto = require("crypto");

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

jest.mock("../../utils/jwt.util", () => ({ verifyAccessToken: jest.fn() }));

const liveDescribe = process.env.REDIS_LIVE_TEST === "1" ? describe : describe.skip;

liveDescribe("rateLimiter.redis.service — live Redis (A-30)", () => {
  const replicas = [];

  /**
   * Load an independent copy of the limiter: its own memory Map, its own
   * connection. Simulates another pod, or the same pod after a restart.
   */
  async function startReplica() {
    let limiter;
    let redisService;
    jest.isolateModules(() => {
      redisService = require("../../services/redis.service");
      limiter = require("../../services/rateLimiter.redis.service");
    });
    await redisService.initRedis();
    const replica = { limiter, redisService };
    replicas.push(replica);
    return replica;
  }

  /** A raw connection, for asserting what is actually stored. */
  function inspector() {
    return replicas[0].redisService.getRedisConnection();
  }

  afterAll(async () => {
    for (const { redisService } of replicas) {
      await redisService.closeRedis();
    }
  });

  it("keeps a login lockout after the process that recorded it is gone", async () => {
    const userId = `live-${crypto.randomUUID()}`;
    const before = await startReplica();

    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await before.limiter.recordAuthFailure({ userId, endpoint: "login" });
    }
    expect(last.allowed).toBe(false);

    // The restart: a brand new module graph, an empty Map, a new connection.
    const after = await startReplica();
    const lockout = await after.limiter.checkAuthLockout({ userId, endpoint: "login" });

    expect(lockout.locked).toBe(true);
    expect(lockout.reason).toBe("Account temporarily locked");

    const stillLocked = await after.limiter.isUserLockedOut(userId, "login");
    expect(stillLocked.isLocked).toBe(true);

    await after.limiter.resetAuthFailures({ userId, endpoint: "login" });
  });

  it("locks out on the fifth failure across two replicas, not the tenth", async () => {
    const userId = `live-${crypto.randomUUID()}`;
    const a = await startReplica();
    const b = await startReplica();

    await a.limiter.recordAuthFailure({ userId, endpoint: "login" });
    await b.limiter.recordAuthFailure({ userId, endpoint: "login" });
    await a.limiter.recordAuthFailure({ userId, endpoint: "login" });
    const fourth = await b.limiter.recordAuthFailure({ userId, endpoint: "login" });
    expect(fourth.allowed).toBe(true);
    expect(fourth.remainingAttempts).toBe(1);

    const fifth = await a.limiter.recordAuthFailure({ userId, endpoint: "login" });
    expect(fifth.allowed).toBe(false);
    expect(fifth.remainingAttempts).toBe(0);

    // And the replica that did not record the fifth failure sees the lockout.
    const seenByB = await b.limiter.checkAuthLockout({ userId, endpoint: "login" });
    expect(seenByB.locked).toBe(true);

    await a.limiter.resetAuthFailures({ userId, endpoint: "login" });
  });

  it("gives the counter a TTL in the same operation that creates it", async () => {
    const userId = `live-${crypto.randomUUID()}`;
    const a = await startReplica();

    await a.limiter.recordAuthFailure({ userId, endpoint: "login" });

    const key = `ratelimit:auth:login:user:${userId}`;
    const ttl = await inspector().pttl(key);
    // Not -1 (no expiry): a counter with no TTL is a lockout that never lifts.
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000);

    const stored = JSON.parse(await inspector().get(key));
    expect(stored.count).toBe(1);
    expect(stored.expiresAt).toBeGreaterThan(Date.now());

    await a.limiter.resetAuthFailures({ userId, endpoint: "login" });
  });

  it("takes the key over when a stray non-JSON value is sitting on it", async () => {
    const userId = `live-${crypto.randomUUID()}`;
    const key = `ratelimit:auth:login:user:${userId}`;
    const a = await startReplica();
    await inspector().set(key, "not-json-at-all");

    const result = await a.limiter.recordAuthFailure({ userId, endpoint: "login" });

    // Not an EVAL error that quietly drops this key back to the per-process Map.
    expect(result.remainingAttempts).toBe(4);
    const stored = JSON.parse(await inspector().get(key));
    expect(stored.count).toBe(1);

    await a.limiter.resetAuthFailures({ userId, endpoint: "login" });
  });

  it("loses no increment when both replicas count the same key at once", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}-${crypto.randomUUID()}`;
    const a = await startReplica();
    const b = await startReplica();

    const middlewareA = a.limiter.endpointRateLimiter("tenantCreate", {
      maxRequests: 1000,
    });
    const middlewareB = b.limiter.endpointRateLimiter("tenantCreate", {
      maxRequests: 1000,
    });
    const makeRes = () => {
      const res = {
        statusCode: 200,
        status: jest.fn(() => res),
        json: jest.fn(() => res),
        set: jest.fn(() => res),
      };
      return res;
    };

    const requests = [];
    for (let i = 0; i < 40; i += 1) {
      const middleware = i % 2 === 0 ? middlewareA : middlewareB;
      requests.push(middleware({ ip, headers: {}, user: null }, makeRes(), jest.fn()));
    }
    await Promise.all(requests);

    const status = await b.limiter.getRateLimitStatus({
      ip,
      endpoint: "tenantCreate",
      type: "api",
    });
    // Read-then-write across two processes loses increments here; the script
    // does not. Exactly 40, not "about 40".
    expect(status.ip.count).toBe(40);

    await inspector().del(`ratelimit:api:tenantCreate:ip:${ip}`);
  });

  it("blocks the 11th request across replicas when the limit is 10", async () => {
    const ip = `198.51.100.${crypto.randomUUID()}`;
    const a = await startReplica();
    const b = await startReplica();
    const options = { maxRequests: 10 };
    const makeRes = () => {
      const res = {
        statusCode: 200,
        status: jest.fn(() => res),
        json: jest.fn(() => res),
        set: jest.fn(() => res),
      };
      return res;
    };

    for (let i = 0; i < 10; i += 1) {
      const middleware = (i % 2 === 0 ? a : b).limiter.endpointRateLimiter(
        "tenantCreate",
        options,
      );
      const next = jest.fn();
      await middleware({ ip, headers: {}, user: null }, makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    }

    const res = makeRes();
    const next = jest.fn();
    await b.limiter
      .endpointRateLimiter("tenantCreate", options)({ ip, headers: {}, user: null }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 429, retryAfter: expect.any(Number) }),
    );

    await inspector().del(`ratelimit:api:tenantCreate:ip:${ip}`);
  });
});
