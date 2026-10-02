/**
 * ADR-100 Amendment 5 — what storeIncrFixed makes of the Redis answer.
 *
 * INCR_FIXED_SCRIPT always writes `expiresAt`, and the live test
 * (rateLimiter.fixedWindow.am5.live.test.ts) proves that against a real Redis.
 * These tests cover the client side of that contract: the answer's own
 * `expiresAt` is used as it is, and an answer WITHOUT one (a foreign script,
 * a proxy rewriting the reply) closes the window at `now + windowMs` — never
 * at NaN, which would make Retry-After meaningless. A mocked `eval` proves
 * the client, not the script; that is the point here.
 */
import type * as RateLimiter from "../../services/rateLimiter.redis.service";

interface FakeClient {
  status: string;
  eval: jest.Mock<Promise<string>, unknown[]>;
}

let mockClient: FakeClient | null = null;

jest.mock("../../services/redis.service", () => ({
  getRedisConnection: jest.fn(() => mockClient),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../models", () => ({ Users: { update: jest.fn(() => Promise.resolve([1])) } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the mocks above are registered
const limiter = require("../../services/rateLimiter.redis.service") as typeof RateLimiter;

const NOW = 1_767_225_600_000;
const WINDOW = 60_000;

describe("storeIncrFixed — the Redis answer (ADR-100 Amendment 5)", () => {
  beforeEach(() => {
    limiter.clearMemoryStore();
    mockClient = { status: "ready", eval: jest.fn<Promise<string>, unknown[]>() };
  });
  afterAll(() => {
    mockClient = null;
  });

  it("uses the expiresAt the script answered", async () => {
    mockClient?.eval.mockResolvedValue(JSON.stringify({ count: 4, firstAttempt: NOW - 5000, expiresAt: NOW + 1234 }));
    await expect(limiter.storeIncrFixed("ratelimit:budget:t1", WINDOW, NOW)).resolves.toEqual({ count: 4, expiresAt: NOW + 1234 });
    expect(mockClient?.eval).toHaveBeenCalledWith(expect.any(String), 1, "ratelimit:budget:t1", String(WINDOW), String(NOW));
  });

  it("an answer without expiresAt closes the window at now + windowMs, not NaN", async () => {
    mockClient?.eval.mockResolvedValue(JSON.stringify({ count: 2 }));
    const answer = await limiter.storeIncrFixed("ratelimit:budget:t2", WINDOW, NOW);
    expect(answer).toEqual({ count: 2, expiresAt: NOW + WINDOW });
    expect(Number.isFinite(answer.expiresAt)).toBe(true);
  });

  it("a non-numeric expiresAt is treated as absent", async () => {
    mockClient?.eval.mockResolvedValue(JSON.stringify({ count: 3, expiresAt: String(NOW + 9) }));
    await expect(limiter.storeIncrFixed("ratelimit:budget:t3", WINDOW, NOW)).resolves.toEqual({ count: 3, expiresAt: NOW + WINDOW });
  });

  it("nothing is counted in memory when Redis answered", async () => {
    mockClient?.eval.mockResolvedValue(JSON.stringify({ count: 1 }));
    await limiter.storeIncrFixed("ratelimit:budget:t4", WINDOW, NOW);
    expect(limiter.memoryStoreStats().size).toBe(0);
  });
});
