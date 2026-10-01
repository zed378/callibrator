/**
 * V-14 — the limiter kept a token's `revoked` flag for exactly one failure.
 *
 * recordAuthFailure marks a token entry `revoked: true` on the 3rd failure.
 * The increment (the Lua script, and the in-memory fallback it mirrors)
 * rewrote the entry as `{ count, firstAttempt, expiresAt }`, so the 4th failure
 * wiped the flag, and the `!entry?.revoked` guard — reading the 3rd entry,
 * which had it — stopped it being written again. From the 5th failure on, the
 * token was no longer reported revoked. The old tests stopped at three.
 *
 * This suite drives the memory path (no Redis) through maxAttempts + 2
 * failures and reads what is stored. The same case against the REAL Lua script
 * is in rateLimiter.redis.live.test.js ("V-14: …", REDIS_LIVE_TEST=1).
 * Fail-before: `stored.revoked` was undefined and the 5th+ `revokedToken` null.
 */
jest.mock("../../services/redis.service", () => ({
  getRedisConnection: jest.fn(() => null),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../models", () => ({
  Users: { update: jest.fn(() => Promise.resolve([1])) },
  Sessions: { update: jest.fn(() => Promise.resolve([1])) },
}));
jest.mock("../../utils/session.util", () => ({
  hashToken: jest.fn((token: string) => `hash:${token}`),
}));
jest.mock("../../utils/jwt.util", () => ({ verifyAccessToken: jest.fn(), verifyPurposeToken: jest.fn() }));

interface FailureResult {
  allowed: boolean;
  revokedToken: string | null;
}
interface Limiter {
  recordAuthFailure: (params: { tokenHash?: string; userId?: string; endpoint: string }) => Promise<FailureResult>;
  getAuthConfig: (endpoint: string) => { maxAttempts: number };
  isTokenBlocked: (tokenHash: string, endpoint: string) => Promise<unknown>;
  clearMemoryStore: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the limiter is JavaScript (CommonJS)
const limiter = require("../../services/rateLimiter.redis.service") as Limiter;

const ENDPOINT = "mfaLogin";
const TOKEN = "v14-token-hash";

afterEach(() => {
  limiter.clearMemoryStore();
});

describe("V-14 — a revoked token stays revoked (memory store)", () => {
  it("maxAttempts + 2 failures: every failure after the 3rd reports the token revoked", async () => {
    const { maxAttempts } = limiter.getAuthConfig(ENDPOINT);
    expect(maxAttempts + 2).toBeLessThan(maxAttempts * 2); // below the hard block, which re-writes the entry

    const results: FailureResult[] = [];
    for (let i = 0; i < maxAttempts + 2; i += 1) {
      results.push(await limiter.recordAuthFailure({ tokenHash: TOKEN, endpoint: ENDPOINT }));
    }

    expect(results.slice(0, 3).map((r) => r.revokedToken)).toEqual([null, null, null]);
    expect(results.slice(3).map((r) => r.revokedToken)).toEqual(results.slice(3).map(() => TOKEN));
  });

  it("the hard block (2 × maxAttempts) keeps the revocation", async () => {
    const { maxAttempts } = limiter.getAuthConfig(ENDPOINT);
    let last: FailureResult | undefined;
    for (let i = 0; i < maxAttempts * 2 + 1; i += 1) {
      last = await limiter.recordAuthFailure({ tokenHash: TOKEN, endpoint: ENDPOINT });
    }
    expect(last?.allowed).toBe(false);
    expect(last?.revokedToken).toBe(TOKEN);
  });
});
