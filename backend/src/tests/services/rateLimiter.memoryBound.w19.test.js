/**
 * W-19 (ADR-079) — the rate limiter's in-memory fallback is bounded.
 *
 * It is the store whenever Redis is not ready. It used to expire an entry only
 * when the same key was read again, which a per-IP bucket from a one-off
 * address never is, so a spray from many addresses during an outage grew the
 * Map for the life of the process. Now a sweep deletes expired entries, its
 * timer is unref'd, and the Map holds at most RATE_LIMIT_MEMORY_MAX_KEYS.
 */
jest.mock("../../services/redis.service", () => ({
  getRedisConnection: jest.fn(() => ({ status: "wait" })), // Redis down: the memory path
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../models", () => ({ Sessions: { update: jest.fn() }, Users: {} }));
jest.mock("../../utils/session.util", () => ({ hashToken: jest.fn((t) => `hash:${t}`) }));

const { logger } = require("../../middlewares/activityLog.middleware");
const rl = require("../../services/rateLimiter.redis.service");

const WINDOW_MS = 60 * 1000;
const limiter = rl.endpointRateLimiter("w19", {
  byUser: false,
  byToken: false,
  maxRequests: 1000,
  windowMs: WINDOW_MS,
});
/** One request from `ip`; resolves with the response status (200 when it passed). */
const hit = async (ip) => {
  let status = 200;
  const res = {
    set: jest.fn(),
    status: jest.fn((code) => {
      status = code;
      return { json: jest.fn() };
    }),
  };
  await limiter({ ip, headers: {} }, res, jest.fn());
  return status;
};

describe("W-19 — the memory fallback has a bound and a sweep", () => {
  const saved = process.env.RATE_LIMIT_MEMORY_MAX_KEYS;

  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    delete process.env.RATE_LIMIT_MEMORY_MAX_KEYS;
    rl.clearMemoryStore();
  });

  afterAll(() => {
    rl.clearMemoryStore();
    if (saved === undefined) {delete process.env.RATE_LIMIT_MEMORY_MAX_KEYS;} else {process.env.RATE_LIMIT_MEMORY_MAX_KEYS = saved;}
  });

  it("driven past RATE_LIMIT_MEMORY_MAX_KEYS by one-off addresses, it stays at the maximum", async () => {
    process.env.RATE_LIMIT_MEMORY_MAX_KEYS = "50";
    for (let i = 0; i < 500; i += 1) {
      await hit(`10.0.${Math.floor(i / 256)}.${i % 256}`);
    }
    expect(rl.memoryStoreStats()).toEqual({ size: 50, maxKeys: 50, sweeping: true });
    // Said once, not once per eviction.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("at its cap of 50 keys"));
  });

  it("evicts the entry written longest ago, so a live counter that keeps being written survives", async () => {
    process.env.RATE_LIMIT_MEMORY_MAX_KEYS = "3";
    await hit("192.0.2.1"); // the attacker's address, counted on every request
    for (let i = 0; i < 10; i += 1) {
      await hit(`198.51.100.${i}`);
      await hit("192.0.2.1");
    }
    const status = await rl.getRateLimitStatus({ ip: "192.0.2.1", endpoint: "w19" });
    expect(status.ip.count).toBe(11); // 1 + 10: none of its counts was lost
    expect(rl.memoryStoreStats().size).toBe(3);
  });

  it("the sweep deletes expired entries that are never read again, and then stops its timer", async () => {
    jest.useFakeTimers({ now: Date.now() });
    for (let i = 0; i < 20; i += 1) {
      await hit(`203.0.113.${i}`);
    }
    expect(rl.memoryStoreStats()).toMatchObject({ size: 20, sweeping: true });

    jest.advanceTimersByTime(WINDOW_MS + 60 * 1000);

    expect(rl.memoryStoreStats()).toMatchObject({ size: 0, sweeping: false });
  });

  it("the sweep keeps an entry that has not expired", async () => {
    await hit("203.0.113.200");
    expect(rl.sweepMemoryStore(Date.now())).toBe(0);
    expect(rl.memoryStoreStats().size).toBe(1);
    expect(rl.sweepMemoryStore(Date.now() + WINDOW_MS + 1)).toBe(1);
    expect(rl.memoryStoreStats()).toMatchObject({ size: 0, sweeping: false });
  });

  it("the sweep timer is unref'd, so it cannot keep the process alive", async () => {
    const setIntervalSpy = jest.spyOn(global, "setInterval");
    await hit("203.0.113.9");
    const timer = setIntervalSpy.mock.results[0].value;
    expect(timer.hasRef()).toBe(false);
    setIntervalSpy.mockRestore();
  });

  it("an invalid RATE_LIMIT_MEMORY_MAX_KEYS uses the default of 100000", () => {
    process.env.RATE_LIMIT_MEMORY_MAX_KEYS = "lots";
    expect(rl.memoryStoreStats().maxKeys).toBe(100000);
    process.env.RATE_LIMIT_MEMORY_MAX_KEYS = "-5";
    expect(rl.memoryStoreStats().maxKeys).toBe(100000);
  });

  it("counting still works under the cap: the limit is enforced from memory", async () => {
    const strict = rl.endpointRateLimiter("w19-strict", { byUser: false, byToken: false, maxRequests: 2, windowMs: WINDOW_MS });
    const statuses = [];
    for (let i = 0; i < 3; i += 1) {
      let status = 200;
      await strict(
        { ip: "192.0.2.50", headers: {} },
        { set: jest.fn(), status: (c) => ((status = c), { json: jest.fn() }) },
        jest.fn(),
      );
      statuses.push(status);
    }
    expect(statuses).toEqual([200, 200, 429]);
  });
});
