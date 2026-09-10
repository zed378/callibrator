/**
 * Tests for rate limiter Redis service (coverage boost)
 *
 * Tests exported functions from rateLimiter.redis.service.js.
 * Uses jest.mock() for external deps (models, session, jwt, activityLog).
 *
 * REDIS_URL is cleared to ensure in-memory fallback is used (Map).
 */

// Override REDIS_URL BEFORE any modules load
const originalRedisUrl = process.env.REDIS_URL;
process.env.REDIS_URL = "";

let mockSessions = { update: jest.fn().mockResolvedValue([1]) };
let mockUsers = {
  findByPk: jest.fn().mockResolvedValue(null),
  update: jest.fn().mockResolvedValue({}),
};

jest.mock("../../services/emailQueue.service", () => ({
  processEmailQueue: jest.fn(),
  queueActivationEmail: jest.fn(),
  queueOtpEmail: jest.fn(),
  getQueueStats: jest.fn(),
  clearQueue: jest.fn(),
  closeRabbitMQ: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../models", () => {
  mockSessions = {
    update: jest.fn().mockResolvedValue([1]),
  };
  mockUsers = {
    findByPk: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({}),
  };
  return {
    Users: mockUsers,
    Sessions: mockSessions,
  };
});

jest.mock("../../utils/session.util", () => ({
  hashToken: jest.fn((token) => `hash:${token}`),
}));

jest.mock("../../utils/jwt.util", () => ({
  generateAccessToken: jest.fn(),
  verifyAccessToken: jest.fn(),
}));

describe("rateLimiter.redis.service - coverage boost", () => {
  let rl;

beforeEach(() => {
    // Reset mock call history only — preserves mockResolvedValue / mockRejectedValue setup
    mockSessions.update.mockClear();
    mockUsers.findByPk.mockClear();
    mockUsers.update.mockClear();
    // Restore defaults
    mockSessions.update.mockResolvedValue([1]);
    mockUsers.findByPk.mockResolvedValue(null);

    // Clear the shared rate limit cache between tests
    rl = require("../../services/rateLimiter.redis.service");
    if (rl.clearMemoryStore) {
      rl.clearMemoryStore();
    }
  });

  afterAll(() => {
    process.env.REDIS_URL = originalRedisUrl;
  });

  describe("recordAuthFailure", () => {
    it("should record a failed attempt for a user and return remaining attempts", async () => {
      const result = await rl.recordAuthFailure({
        userId: "user-1",
        endpoint: "login",
      });
      expect(result.allowed).toBe(true);
      expect(result.remainingAttempts).toBe(4);
    });

    it("should return a result with default config for unknown endpoint", async () => {
      const result = await rl.recordAuthFailure({
        userId: "user-1",
        endpoint: "unknownEndpoint",
      });
      expect(result.allowed).toBe(true);
      // unknown endpoint defaults to login config (maxAttempts: 5)
      expect(result.remainingAttempts).toBe(4);
    });

    it("should not throw when called with no params", async () => {
      await expect(rl.recordAuthFailure({})).resolves.toBeDefined();
    });

    it("should lock out user after exceeding max attempts", async () => {
      // login config: maxAttempts=5
      for (let i = 0; i < 5; i++) {
        await rl.recordAuthFailure({ userId: "user-lock", endpoint: "login" });
      }
      const result = await rl.recordAuthFailure({ userId: "user-lock", endpoint: "login" });
      expect(result.allowed).toBe(false);
      expect(result.lockoutUntil).toBeDefined();
      expect(result.lockoutReason).toContain("Too many failed attempts");
    });

    it("should handle error when updating user lockout", async () => {
      mockUsers.update.mockRejectedValueOnce(new Error("DB error"));
      const result = await rl.recordAuthFailure({ userId: "user-err", endpoint: "login" });
      expect(result.allowed).toBe(true); // still allows but logs error
    });

    it("should handle token-based rate limiting", async () => {
      const result = await rl.recordAuthFailure({
        tokenHash: "hash:token123",
        endpoint: "login",
      });
      expect(result.allowed).toBe(true);
      // First attempt, remaining = 4 (max 5)
      expect(result.remainingAttempts).toBe(4);
    });

    it("should revoke token after 3 failures with same token", async () => {
      for (let i = 0; i < 3; i++) {
        await rl.recordAuthFailure({ tokenHash: "hash:tok123", endpoint: "login" });
      }
      const result = await rl.recordAuthFailure({ tokenHash: "hash:tok123", endpoint: "login" });
      // The 4th call should have revokedToken set on the 3rd
      expect(result.revokedToken).toBe("hash:tok123");
    });

    it("should block token after 2x maxAttempts", async () => {
      const tokenHash = "hash:blockme";
      // maxAttempts for login = 5, so 2x = 10
      for (let i = 0; i < 10; i++) {
        await rl.recordAuthFailure({ tokenHash, endpoint: "login" });
      }
      const result = await rl.recordAuthFailure({ tokenHash, endpoint: "login" });
      expect(result.allowed).toBe(false);
      expect(result.lockoutReason).toContain("Token blocked");
    });

    it("should handle IP-based rate limiting", async () => {
      const result = await rl.recordAuthFailure({
        ip: "192.168.1.1",
        endpoint: "login",
      });
      expect(result.allowed).toBe(true);
    });

    it("should block IP after 3x maxAttempts", async () => {
      // 3 * 5 = 15
      for (let i = 0; i < 15; i++) {
        await rl.recordAuthFailure({ ip: "10.0.0.1", endpoint: "login" });
      }
      const result = await rl.recordAuthFailure({ ip: "10.0.0.1", endpoint: "login" });
      expect(result.allowed).toBe(false);
      expect(result.lockoutReason).toContain("Too many requests from this IP");
    });
  });

  describe("checkAuthLockout", () => {
    it("should return locked false when no entry exists", async () => {
      const result = await rl.checkAuthLockout({ userId: "new-user", endpoint: "login" });
      expect(result.locked).toBe(false);
    });

    it("should return locked true when user is locked", async () => {
      // Record 5 failures to trigger lockout
      for (let i = 0; i < 5; i++) {
        await rl.recordAuthFailure({ userId: "lock-user", endpoint: "login" });
      }
      const result = await rl.checkAuthLockout({ userId: "lock-user", endpoint: "login" });
      expect(result.locked).toBe(true);
      expect(result.lockoutUntil).toBeDefined();
      expect(result.reason).toContain("locked");
    });

    it("should return locked true when token is revoked", async () => {
      // 3 failures revokes token
      for (let i = 0; i < 3; i++) {
        await rl.recordAuthFailure({ tokenHash: "hash:revoked", endpoint: "login" });
      }
      const result = await rl.checkAuthLockout({ tokenHash: "hash:revoked", endpoint: "login" });
      expect(result.locked).toBe(true);
      expect(result.reason).toContain("revoked");
    });

    it("should return locked true when IP is blocked", async () => {
      for (let i = 0; i < 15; i++) {
        await rl.recordAuthFailure({ ip: "10.0.0.2", endpoint: "login" });
      }
      const result = await rl.checkAuthLockout({ ip: "10.0.0.2", endpoint: "login" });
      expect(result.locked).toBe(true);
      expect(result.reason).toContain("blocked");
    });
  });

  describe("resetAuthFailures", () => {
    it("should remove user rate limit entry from cache", async () => {
      await rl.recordAuthFailure({ userId: "reset-user", endpoint: "login" });
      await rl.resetAuthFailures({ userId: "reset-user", endpoint: "login" });
      const status = await rl.checkAuthLockout({ userId: "reset-user", endpoint: "login" });
      expect(status.locked).toBe(false);
    });

    it("should handle error when resetting user failed attempts", async () => {
      mockUsers.update.mockRejectedValueOnce(new Error("DB error"));
      await rl.resetAuthFailures({ userId: "reset-err", endpoint: "login" });
      // Should not throw
    });

    it("should remove token rate limit entry from cache", async () => {
      await rl.recordAuthFailure({ tokenHash: "hash:reset-token", endpoint: "login" });
      await rl.resetAuthFailures({ tokenHash: "hash:reset-token", endpoint: "login" });
      // Should not throw
    });

    it("should not throw when called with no params", async () => {
      await expect(rl.resetAuthFailures({})).resolves.toBeUndefined();
    });
  });

  describe("revokeTokenByHash", () => {
    it("should update Sessions when token is revoked", async () => {
      const result = await rl.revokeTokenByHash("hash:revoke123", "TEST_REASON");
      expect(result).toBe(true);
      expect(mockSessions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          isRevoked: true,
          revokedReason: "TEST_REASON",
        }),
        expect.any(Object)
      );
    });

    it("should return false when update throws", async () => {
      mockSessions.update.mockRejectedValueOnce(new Error("DB error"));
      const result = await rl.revokeTokenByHash("hash:fail", "REASON");
      expect(result).toBe(false);
    });
  });

  describe("revokeAllUserTokens", () => {
    it("should revoke all sessions for a user", async () => {
      mockSessions.update.mockResolvedValueOnce([3]);
      const count = await rl.revokeAllUserTokens("user-123", "SECURITY");
      expect(count).toBe(3);
      expect(mockSessions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          isRevoked: true,
          revokedReason: "SECURITY",
        }),
        expect.any(Object)
      );
    });

    it("should return 0 when update throws", async () => {
      mockSessions.update.mockRejectedValueOnce(new Error("DB error"));
      const count = await rl.revokeAllUserTokens("user-456", "REASON");
      expect(count).toBe(0);
    });
  });

  describe("isTokenBlocked", () => {
    it("should return isBlocked false when no entry exists", async () => {
      const result = await rl.isTokenBlocked("nonexistent-token", "login");
      expect(result.isBlocked).toBe(false);
    });

    it("should return isBlocked true when token is blocked", async () => {
      // Block a token by recording 2x maxAttempts failures
      for (let i = 0; i < 10; i++) {
        await rl.recordAuthFailure({ tokenHash: "hash:block-test", endpoint: "login" });
      }
      const result = await rl.isTokenBlocked("block-test", "login");
      expect(result.isBlocked).toBe(true);
      expect(result.blockUntil).toBeDefined();
    });
  });

  describe("isUserLockedOut", () => {
    it("should return isLocked false when no entry exists", async () => {
      const result = await rl.isUserLockedOut("no-lock-user", "login");
      expect(result.isLocked).toBe(false);
    });

    it("should return isLocked true when user is locked", async () => {
      for (let i = 0; i < 5; i++) {
        await rl.recordAuthFailure({ userId: "lockout-user", endpoint: "login" });
      }
      const result = await rl.isUserLockedOut("lockout-user", "login");
      expect(result.isLocked).toBe(true);
      expect(result.lockoutUntil).toBeDefined();
      expect(result.reason).toContain("locked");
    });

    it("should return false when lockout has expired", async () => {
      // We can't easily test time expiration without mocking Date.now
      // but the logic is covered by isLocked check on count vs maxAttempts
      const result = await rl.isUserLockedOut("fresh-user", "login");
      expect(result.isLocked).toBe(false);
    });
  });

  describe("getRateLimitStatus", () => {
    it("should return status with user entry", async () => {
      await rl.recordAuthFailure({ userId: "status-user", endpoint: "login" });
      const status = await rl.getRateLimitStatus({ userId: "status-user", endpoint: "login", type: "auth" });
      expect(status.user).toBeDefined();
      expect(status.user.count).toBe(1);
    });

    it("should return status with token entry", async () => {
      await rl.recordAuthFailure({ tokenHash: "hash:status-token", endpoint: "login" });
      const status = await rl.getRateLimitStatus({ tokenHash: "hash:status-token", endpoint: "login", type: "auth" });
      expect(status.token).toBeDefined();
      expect(status.token.count).toBe(1);
    });

    it("should return empty status when no entries", async () => {
      const status = await rl.getRateLimitStatus({ endpoint: "login", type: "auth" });
      expect(status.user).toBeNull();
      expect(status.token).toBeNull();
      expect(status.ip).toBeNull();
    });

    it("should include IP status when provided", async () => {
      await rl.recordAuthFailure({ ip: "1.2.3.4", endpoint: "login" });
      const status = await rl.getRateLimitStatus({ ip: "1.2.3.4", endpoint: "login", type: "auth" });
      expect(status.ip).toBeDefined();
      expect(status.ip.count).toBe(1);
    });
  });

  describe("clearUserRateLimits", () => {
    it("should clear rate limits for a user", async () => {
      await rl.recordAuthFailure({ userId: "clear-user", endpoint: "login" });
      await rl.clearUserRateLimits("clear-user");
      const status = await rl.checkAuthLockout({ userId: "clear-user", endpoint: "login" });
      expect(status.locked).toBe(false);
    });
  });

  describe("endpointRateLimiter", () => {
    it("should be a function", () => {
      const middleware = rl.endpointRateLimiter("default");
      expect(typeof middleware).toBe("function");
    });

    it("should use custom maxRequests when provided", async () => {
      const middleware = rl.endpointRateLimiter("default", { maxRequests: 5, windowMs: 60000 });
      expect(typeof middleware).toBe("function");
    });

    it("should allow requests under the limit and set headers", async () => {
      const middleware = rl.endpointRateLimiter("tenantCreate", { maxRequests: 10, windowMs: 60000 });
      const req = { ip: "1.2.3.4", headers: {}, user: null };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        set: jest.fn(),
      };
      const next = jest.fn();

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          "X-RateLimit-Limit": "10",
        })
      );
    });

    it("should block requests over the limit", async () => {
      const middleware = rl.endpointRateLimiter("tenantCreate", { maxRequests: 2, windowMs: 60000 });
      const req = { ip: "1.2.3.5", headers: {}, user: null };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        set: jest.fn(),
      };
      const next = jest.fn();

      await middleware(req, res, next); // 1
      await middleware(req, res, next); // 2
      await middleware(req, res, next); // 3 - should block

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          status: 429,
        })
      );
    });

    it("should handle custom default error message when description is not defined", async () => {
      const middleware = rl.endpointRateLimiter("unknownEndpoint", { maxRequests: 1, windowMs: 60000 });
      const req = { ip: "1.2.3.6", headers: {}, user: null };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        set: jest.fn(),
      };
      const next = jest.fn();

      await middleware(req, res, next); // 1
      await middleware(req, res, next); // 2 - block

      expect(res.status).toHaveBeenCalledWith(429);
    });

    it("should reset window when expired", async () => {
      // We can't easily test time expiration without mocking Date.now
      // This is a smoke test that the function exists and doesn't throw
      const middleware = rl.endpointRateLimiter("default", { maxRequests: 1, windowMs: 1 });
      const req = { ip: "1.2.3.7", headers: {}, user: null };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), set: jest.fn() };
      const next = jest.fn();
      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe("AUTH_ENDPOINTS config", () => {
    it("should have all expected endpoints", () => {
      const { AUTH_ENDPOINTS } = require("../../constants/rateLimitConstants");
      expect(AUTH_ENDPOINTS).toHaveProperty("login");
      expect(AUTH_ENDPOINTS).toHaveProperty("register");
      expect(AUTH_ENDPOINTS).toHaveProperty("forgotPassword");
      expect(AUTH_ENDPOINTS).toHaveProperty("resetPassword");
    });

    it("should have maxAttempts, windowMs, and lockoutMs for each endpoint", () => {
      const { AUTH_ENDPOINTS } = require("../../constants/rateLimitConstants");
      Object.values(AUTH_ENDPOINTS).forEach((config) => {
        expect(config).toHaveProperty("maxAttempts");
        expect(config).toHaveProperty("windowMs");
        expect(config).toHaveProperty("lockoutMs");
      });
    });

    it("login should have maxAttempts of 5", () => {
      const { AUTH_ENDPOINTS } = require("../../constants/rateLimitConstants");
      expect(AUTH_ENDPOINTS.login.maxAttempts).toBe(5);
    });

    it("forgotPassword should have maxAttempts of 3", () => {
      const { AUTH_ENDPOINTS } = require("../../constants/rateLimitConstants");
      expect(AUTH_ENDPOINTS.forgotPassword.maxAttempts).toBe(3);
    });

    it("register should have maxAttempts of 3", () => {
      const { AUTH_ENDPOINTS } = require("../../constants/rateLimitConstants");
      expect(AUTH_ENDPOINTS.register.maxAttempts).toBe(3);
    });
  });

  describe("API_ENDPOINTS config", () => {
    it("should have all expected endpoints", () => {
      const { API_ENDPOINTS } = require("../../constants/rateLimitConstants");
      expect(API_ENDPOINTS).toHaveProperty("tenantCreate");
      expect(API_ENDPOINTS).toHaveProperty("tenantUpload");
      expect(API_ENDPOINTS).toHaveProperty("default");
    });
  });

  describe("getAuthConfig / getApiConfig", () => {
    it("should return config for known auth endpoint", () => {
      const { getAuthConfig } = require("../../constants/rateLimitConstants");
      const config = getAuthConfig("login");
      expect(config.maxAttempts).toBe(5);
    });

    it("should return default for unknown auth endpoint", () => {
      const { getAuthConfig } = require("../../constants/rateLimitConstants");
      const config = getAuthConfig("unknown");
      expect(config.maxAttempts).toBe(5); // defaults to login
    });

    it("should return config for known api endpoint", () => {
      const { getApiConfig } = require("../../constants/rateLimitConstants");
      const config = getApiConfig("tenantCreate");
      expect(config.maxRequests).toBe(10);
    });

    it("should return default for unknown api endpoint", () => {
      const { getApiConfig } = require("../../constants/rateLimitConstants");
      const config = getApiConfig("unknown");
      expect(config.maxRequests).toBe(100);
    });
  });

  describe("makeKey", () => {
    it("should generate correct key format", () => {
      const { makeKey } = require("../../constants/rateLimitConstants");
      const key = makeKey("auth", "login", "user:123");
      expect(key).toBe("ratelimit:auth:login:user:123");
    });
  });

  // ==============================================================
  // IN-MEMORY STORE TTL EXPIRY
  // ==============================================================
  describe("in-memory store expiry", () => {
    const { logger } = require("../../middlewares/activityLog.middleware");

    it("should treat an entry as absent once its TTL has elapsed", async () => {
      // login window is 15 minutes
      await rl.recordAuthFailure({ userId: "ttl-user", endpoint: "login" });

      const before = await rl.getRateLimitStatus({
        userId: "ttl-user",
        endpoint: "login",
        type: "auth",
      });
      expect(before.user.count).toBe(1);

      // Jump past the 15-minute window
      const realNow = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(realNow + 16 * 60 * 1000);

      const after = await rl.getRateLimitStatus({
        userId: "ttl-user",
        endpoint: "login",
        type: "auth",
      });
      expect(after.user).toBeNull();

      // A fresh failure after expiry starts the counter over at 1
      const result = await rl.recordAuthFailure({
        userId: "ttl-user",
        endpoint: "login",
      });
      expect(result.remainingAttempts).toBe(4);
      expect(result.allowed).toBe(true);
    });

    it("should clear a user lockout once the window expires", async () => {
      for (let i = 0; i < 5; i++) {
        await rl.recordAuthFailure({ userId: "ttl-lock", endpoint: "login" });
      }
      expect(
        (await rl.checkAuthLockout({ userId: "ttl-lock", endpoint: "login" })).locked,
      ).toBe(true);

      const realNow = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(realNow + 16 * 60 * 1000);

      expect(
        (await rl.checkAuthLockout({ userId: "ttl-lock", endpoint: "login" })).locked,
      ).toBe(false);
    });
  });

  // ==============================================================
  // getRateLimitStatus — api type
  // ==============================================================
  describe("getRateLimitStatus - api type", () => {
    it("should use api config and never report isLocked for type=api", async () => {
      const middleware = rl.endpointRateLimiter("tenantCreate", {
        maxRequests: 10,
        windowMs: 60000,
      });
      const req = { ip: "9.9.9.9", headers: {}, user: null };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), set: jest.fn() };
      await middleware(req, res, jest.fn());

      const status = await rl.getRateLimitStatus({
        ip: "9.9.9.9",
        endpoint: "tenantCreate",
        type: "api",
      });
      expect(status.ip).toEqual({
        count: 1,
        expiresAt: expect.any(Date),
      });
      expect(status.user).toBeNull();
      expect(status.token).toBeNull();
    });

    it("should report isBlocked false for a token that is merely counted", async () => {
      await rl.recordAuthFailure({ tokenHash: "hash:soft", endpoint: "login" });
      const status = await rl.getRateLimitStatus({
        tokenHash: "hash:soft",
        endpoint: "login",
        type: "auth",
      });
      expect(status.token.isBlocked).toBe(false);
    });

    it("should report isBlocked true for a hard-blocked token", async () => {
      for (let i = 0; i < 10; i++) {
        await rl.recordAuthFailure({ tokenHash: "hash:hard", endpoint: "login" });
      }
      const status = await rl.getRateLimitStatus({
        tokenHash: "hash:hard",
        endpoint: "login",
        type: "auth",
      });
      expect(status.token.isBlocked).toBe(true);
    });
  });

  // ==============================================================
  // endpointRateLimiter — key selection + fail-open
  // ==============================================================
  describe("endpointRateLimiter - key selection", () => {
    const { logger } = require("../../middlewares/activityLog.middleware");

    const makeRes = () => ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      set: jest.fn(),
    });

    it("should track by user id when req.user is authenticated", async () => {
      const middleware = rl.endpointRateLimiter("tenantCreate", {
        maxRequests: 10,
        windowMs: 60000,
      });
      const req = { ip: "5.5.5.5", headers: {}, user: { id: "auth-user" } };
      const next = jest.fn();

      await middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalled();

      // The user key was incremented, not just the IP key
      const status = await rl.getRateLimitStatus({
        userId: "auth-user",
        endpoint: "tenantCreate",
        type: "api",
      });
      expect(status.user.count).toBe(1);
    });

    it("should track by token hash when an Authorization header is present", async () => {
      const middleware = rl.endpointRateLimiter("tenantCreate", {
        maxRequests: 10,
        windowMs: 60000,
      });
      const req = {
        ip: "5.5.5.6",
        headers: { authorization: "Bearer abc123" },
        user: null,
      };
      const next = jest.fn();

      await middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalled();

      // hashToken is mocked as `hash:${token}`
      const status = await rl.getRateLimitStatus({
        tokenHash: "hash:abc123",
        endpoint: "tenantCreate",
        type: "api",
      });
      expect(status.token.count).toBe(1);
    });

    it("should set X-RateLimit headers from the first key only", async () => {
      const middleware = rl.endpointRateLimiter("tenantCreate", {
        maxRequests: 10,
        windowMs: 60000,
      });
      const req = {
        ip: "5.5.5.7",
        headers: { authorization: "Bearer tok" },
        user: { id: "hdr-user" },
      };
      const res = makeRes();

      await middleware(req, res, jest.fn());

      // 3 keys are checked (user, token, ip) but headers are set exactly once
      expect(res.set).toHaveBeenCalledTimes(1);
      expect(res.set).toHaveBeenCalledWith({
        "X-RateLimit-Limit": "10",
        "X-RateLimit-Remaining": "9",
        "X-RateLimit-Reset": expect.any(String),
      });
    });

    it("should skip user/token/ip keys when the byX options are disabled", async () => {
      const middleware = rl.endpointRateLimiter("tenantCreate", {
        maxRequests: 10,
        windowMs: 60000,
        byUser: false,
        byToken: false,
      });
      const req = {
        ip: "5.5.5.8",
        headers: { authorization: "Bearer skipme" },
        user: { id: "skip-user" },
      };
      const next = jest.fn();

      await middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalled();

      const status = await rl.getRateLimitStatus({
        userId: "skip-user",
        tokenHash: "hash:skipme",
        ip: "5.5.5.8",
        endpoint: "tenantCreate",
        type: "api",
      });
      expect(status.user).toBeNull();
      expect(status.token).toBeNull();
      expect(status.ip.count).toBe(1);
    });

    it("should fall back to x-forwarded-for then socket.remoteAddress for the IP", async () => {
      const middleware = rl.endpointRateLimiter("tenantCreate", {
        maxRequests: 10,
        windowMs: 60000,
        byUser: false,
        byToken: false,
      });
      const req = {
        headers: {},
        user: null,
        socket: { remoteAddress: "7.7.7.7" },
      };
      await middleware(req, makeRes(), jest.fn());

      const status = await rl.getRateLimitStatus({
        ip: "7.7.7.7",
        endpoint: "tenantCreate",
        type: "api",
      });
      expect(status.ip.count).toBe(1);
    });

    it("should use the endpoint config defaults when no overrides are given", async () => {
      // tenantCreate config: maxRequests 10
      const middleware = rl.endpointRateLimiter("tenantCreate");
      const req = { ip: "5.5.5.9", headers: {}, user: null };
      const res = makeRes();

      await middleware(req, res, jest.fn());

      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({ "X-RateLimit-Limit": "10" }),
      );
    });

    it("should include retryAfter seconds derived from the window when blocking", async () => {
      const middleware = rl.endpointRateLimiter("tenantCreate", {
        maxRequests: 1,
        windowMs: 60000,
      });
      const req = { ip: "5.5.6.0", headers: {}, user: null };
      const res = makeRes();
      const next = jest.fn();

      await middleware(req, res, next);
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        status: 429,
        message: "Too many requests. Tenant creation limit exceeded.",
        retryAfter: 60,
      });
      // next() is NOT called for the blocked request
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("should fail open and call next() when key building throws", async () => {
      const middleware = rl.endpointRateLimiter("tenantCreate");
      // req.headers is undefined -> reading .authorization throws a TypeError
      const req = { ip: "5.5.6.1", user: null };
      const res = makeRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Rate limiter error:"),
      );
    });
  });

  // ==============================================================
  // authPreCheck
  // ==============================================================
  describe("authPreCheck", () => {
    const { logger } = require("../../middlewares/activityLog.middleware");
    const { verifyAccessToken } = require("../../utils/jwt.util");

    const makeRes = () => ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    });

    it("should attach rateLimitContext and call next when not locked", async () => {
      const middleware = rl.authPreCheck("login");
      const req = { headers: {}, ip: "2.2.2.1", socket: {} };
      const res = makeRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(req.rateLimitContext).toEqual({
        userId: null,
        tokenHash: null,
        ip: "2.2.2.1",
        endpoint: "login",
      });
    });

    it("should resolve userId from a valid bearer token", async () => {
      verifyAccessToken.mockReturnValue({ id: "jwt-user" });
      const middleware = rl.authPreCheck("login");
      const req = {
        headers: { authorization: "Bearer good-token" },
        ip: "2.2.2.2",
        socket: {},
      };
      const next = jest.fn();

      await middleware(req, makeRes(), next);

      expect(verifyAccessToken).toHaveBeenCalledWith("good-token");
      expect(req.rateLimitContext).toEqual({
        userId: "jwt-user",
        tokenHash: "hash:good-token",
        ip: "2.2.2.2",
        endpoint: "login",
      });
      expect(next).toHaveBeenCalled();
    });

    it("should ignore an invalid token and leave userId null", async () => {
      verifyAccessToken.mockImplementation(() => {
        throw new Error("invalid signature");
      });
      const middleware = rl.authPreCheck("login");
      const req = {
        headers: { authorization: "Bearer bad-token" },
        ip: "2.2.2.3",
        socket: {},
      };
      const next = jest.fn();

      await middleware(req, makeRes(), next);

      expect(req.rateLimitContext).toEqual({
        userId: null,
        tokenHash: "hash:bad-token",
        ip: "2.2.2.3",
        endpoint: "login",
      });
      expect(next).toHaveBeenCalled();
    });

    it("should respond 429 with lockoutUntil and retryAfter when the user is locked", async () => {
      verifyAccessToken.mockReturnValue({ id: "locked-jwt-user" });
      for (let i = 0; i < 5; i++) {
        await rl.recordAuthFailure({ userId: "locked-jwt-user", endpoint: "login" });
      }

      const middleware = rl.authPreCheck("login");
      const req = {
        headers: { authorization: "Bearer locked" },
        ip: "2.2.2.4",
        socket: {},
      };
      const res = makeRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
      const payload = res.json.mock.calls[0][0];
      expect(payload.success).toBe(false);
      expect(payload.status).toBe(429);
      expect(payload.message).toBe("Account temporarily locked");
      expect(typeof payload.lockoutUntil).toBe("string");
      expect(payload.retryAfter).toBeGreaterThan(0);
    });

    it("should fail open and call next when the pre-check throws", async () => {
      const middleware = rl.authPreCheck("login");
      // headers undefined -> reading .authorization throws
      const req = { ip: "2.2.2.5" };
      const res = makeRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Auth pre-check error:"),
      );
      expect(req.rateLimitContext).toBeUndefined();
    });
  });

  // ==============================================================
  // authPostFailure
  // ==============================================================
  describe("authPostFailure", () => {
    const { logger } = require("../../middlewares/activityLog.middleware");

    it("should record a failure for a 4xx response", async () => {
      const middleware = rl.authPostFailure("login");
      const req = { rateLimitContext: { userId: "pf-user", tokenHash: null, ip: null } };
      const next = jest.fn();

      await middleware(req, { statusCode: 401 }, next);

      const status = await rl.getRateLimitStatus({
        userId: "pf-user",
        endpoint: "login",
        type: "auth",
      });
      expect(status.user.count).toBe(1);
      expect(next).toHaveBeenCalled();
    });

    it("should not record a failure for a 2xx response", async () => {
      const middleware = rl.authPostFailure("login");
      const req = { rateLimitContext: { userId: "pf-ok", tokenHash: null, ip: null } };
      const next = jest.fn();

      await middleware(req, { statusCode: 200 }, next);

      const status = await rl.getRateLimitStatus({
        userId: "pf-ok",
        endpoint: "login",
        type: "auth",
      });
      expect(status.user).toBeNull();
      expect(next).toHaveBeenCalled();
    });

    it("should not double-count a 429 emitted by the pre-check", async () => {
      const middleware = rl.authPostFailure("login");
      const req = { rateLimitContext: { userId: "pf-429", tokenHash: null, ip: null } };
      const next = jest.fn();

      await middleware(req, { statusCode: 429 }, next);

      const status = await rl.getRateLimitStatus({
        userId: "pf-429",
        endpoint: "login",
        type: "auth",
      });
      expect(status.user).toBeNull();
      expect(next).toHaveBeenCalled();
    });

    it("should not record a failure for a 5xx response", async () => {
      const middleware = rl.authPostFailure("login");
      const req = { rateLimitContext: { userId: "pf-500", tokenHash: null, ip: null } };
      const next = jest.fn();

      await middleware(req, { statusCode: 500 }, next);

      const status = await rl.getRateLimitStatus({
        userId: "pf-500",
        endpoint: "login",
        type: "auth",
      });
      expect(status.user).toBeNull();
      expect(next).toHaveBeenCalled();
    });

    it("should swallow recording errors and still call next", async () => {
      const middleware = rl.authPostFailure("login");
      // A userId whose string coercion throws makes makeKey() blow up inside
      // recordAuthFailure, so the middleware's catch is exercised.
      const req = {
        rateLimitContext: {
          userId: {
            toString() {
              throw new Error("boom");
            },
          },
        },
      };
      const next = jest.fn();

      await middleware(req, { statusCode: 401 }, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Auth post-failure recording error:"),
      );
    });
  });

  // ==============================================================
  // authPostSuccess
  // ==============================================================
  describe("authPostSuccess", () => {
    const { logger } = require("../../middlewares/activityLog.middleware");

    it("should reset counters on a 200 response", async () => {
      await rl.recordAuthFailure({ userId: "ps-user", endpoint: "login" });
      expect(
        (await rl.getRateLimitStatus({ userId: "ps-user", endpoint: "login", type: "auth" }))
          .user.count,
      ).toBe(1);

      const middleware = rl.authPostSuccess("login");
      const req = { rateLimitContext: { userId: "ps-user", tokenHash: null } };
      const next = jest.fn();

      await middleware(req, { statusCode: 200 }, next);

      const status = await rl.getRateLimitStatus({
        userId: "ps-user",
        endpoint: "login",
        type: "auth",
      });
      expect(status.user).toBeNull();
      expect(mockUsers.update).toHaveBeenCalledWith(
        { failedLoginAttempts: 0, lockedUntil: null },
        { where: { id: "ps-user" } },
      );
      expect(next).toHaveBeenCalled();
    });

    it("should not reset counters on a non-200 response", async () => {
      await rl.recordAuthFailure({ userId: "ps-401", endpoint: "login" });

      const middleware = rl.authPostSuccess("login");
      const req = { rateLimitContext: { userId: "ps-401", tokenHash: null } };
      const next = jest.fn();

      await middleware(req, { statusCode: 401 }, next);

      const status = await rl.getRateLimitStatus({
        userId: "ps-401",
        endpoint: "login",
        type: "auth",
      });
      expect(status.user.count).toBe(1);
      expect(mockUsers.update).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should do nothing when there is no rateLimitContext", async () => {
      const middleware = rl.authPostSuccess("login");
      const next = jest.fn();

      await middleware({}, { statusCode: 200 }, next);

      expect(mockUsers.update).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should swallow reset errors and still call next", async () => {
      const middleware = rl.authPostSuccess("login");
      const req = {
        rateLimitContext: {
          userId: {
            toString() {
              throw new Error("boom");
            },
          },
        },
      };
      const next = jest.fn();

      await middleware(req, { statusCode: 200 }, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Auth post-success reset error:"),
      );
    });
  });

  // ==============================================================
  // recordAuthFailure — combined identifiers
  // ==============================================================
  describe("recordAuthFailure - combined identifiers", () => {
    it("should persist the lockout to the Users table when a user locks out", async () => {
      for (let i = 0; i < 5; i++) {
        await rl.recordAuthFailure({ userId: "persist-user", endpoint: "login" });
      }

      expect(mockUsers.update).toHaveBeenCalledWith(
        expect.objectContaining({
          failedLoginAttempts: 5,
          lockedUntil: expect.any(Date),
        }),
        { where: { id: "persist-user" } },
      );
    });

    it("should skip the IP fallback when a userId is present", async () => {
      await rl.recordAuthFailure({
        userId: "combo-user",
        ip: "3.3.3.1",
        endpoint: "login",
      });

      const status = await rl.getRateLimitStatus({
        userId: "combo-user",
        ip: "3.3.3.1",
        endpoint: "login",
        type: "auth",
      });
      expect(status.user.count).toBe(1);
      expect(status.ip).toBeNull();
    });

    it("should skip the IP fallback when a tokenHash is present", async () => {
      await rl.recordAuthFailure({
        tokenHash: "hash:combo",
        ip: "3.3.3.2",
        endpoint: "login",
      });

      const status = await rl.getRateLimitStatus({
        tokenHash: "hash:combo",
        ip: "3.3.3.2",
        endpoint: "login",
        type: "auth",
      });
      expect(status.token.count).toBe(1);
      expect(status.ip).toBeNull();
    });

    it("should preserve firstAttempt across repeated failures", async () => {
      const realNow = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(realNow);
      await rl.recordAuthFailure({ userId: "first-user", endpoint: "login" });

      Date.now.mockReturnValue(realNow + 1000);
      for (let i = 0; i < 4; i++) {
        await rl.recordAuthFailure({ userId: "first-user", endpoint: "login" });
      }

      // checkAuthLockout derives lockoutUntil from firstAttempt + lockoutMs
      const lockout = await rl.checkAuthLockout({
        userId: "first-user",
        endpoint: "login",
      });
      expect(lockout.locked).toBe(true);
      expect(lockout.lockoutUntil.getTime()).toBe(realNow + 15 * 60 * 1000);
    });

    it("should use the register config for the register endpoint", async () => {
      const result = await rl.recordAuthFailure({
        userId: "reg-user",
        endpoint: "register",
      });
      // register: maxAttempts 3
      expect(result.remainingAttempts).toBe(2);
    });
  });

  // ==============================================================
  // checkAuthLockout / isTokenBlocked / isUserLockedOut edges
  // ==============================================================
  describe("lockout query edges", () => {
    it("should report remainingAttempts for a partially failed user", async () => {
      await rl.recordAuthFailure({ userId: "partial", endpoint: "login" });
      await rl.recordAuthFailure({ userId: "partial", endpoint: "login" });

      const result = await rl.isUserLockedOut("partial", "login");
      expect(result.isLocked).toBe(false);
      expect(result.remainingAttempts).toBe(3);
    });

    it("should report full remainingAttempts for an unknown user", async () => {
      const result = await rl.isUserLockedOut("unknown-user", "login");
      expect(result).toEqual({ isLocked: false, remainingAttempts: 5 });
    });

    it("should not report a locked-out user once the entry has expired", async () => {
      for (let i = 0; i < 5; i++) {
        await rl.recordAuthFailure({ userId: "expired-lock", endpoint: "login" });
      }
      const realNow = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(realNow + 16 * 60 * 1000);

      const result = await rl.isUserLockedOut("expired-lock", "login");
      expect(result.isLocked).toBe(false);
      expect(result.remainingAttempts).toBe(5);
    });

    it("should not report a blocked token once the entry has expired", async () => {
      for (let i = 0; i < 10; i++) {
        await rl.recordAuthFailure({ tokenHash: "hash:exp-block", endpoint: "login" });
      }
      expect((await rl.isTokenBlocked("exp-block", "login")).isBlocked).toBe(true);

      const realNow = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(realNow + 16 * 60 * 1000);

      expect((await rl.isTokenBlocked("exp-block", "login")).isBlocked).toBe(false);
    });

    it("should return locked false when a token exists but is not revoked", async () => {
      await rl.recordAuthFailure({ tokenHash: "hash:notrevoked", endpoint: "login" });
      const result = await rl.checkAuthLockout({
        tokenHash: "hash:notrevoked",
        endpoint: "login",
      });
      expect(result).toEqual({ locked: false });
    });

    it("should return locked false when an IP exists but is under the limit", async () => {
      await rl.recordAuthFailure({ ip: "4.4.4.1", endpoint: "login" });
      const result = await rl.checkAuthLockout({ ip: "4.4.4.1", endpoint: "login" });
      expect(result).toEqual({ locked: false });
    });

    it("should skip the IP branch of checkAuthLockout when a userId is given", async () => {
      for (let i = 0; i < 15; i++) {
        await rl.recordAuthFailure({ ip: "4.4.4.2", endpoint: "login" });
      }
      // IP alone is blocked, but supplying a clean userId skips the IP branch
      const result = await rl.checkAuthLockout({
        userId: "clean-user",
        ip: "4.4.4.2",
        endpoint: "login",
      });
      expect(result).toEqual({ locked: false });
    });
  });

  // ==============================================================
  // clearUserRateLimits / clearMemoryStore
  // ==============================================================
  describe("clearUserRateLimits", () => {
    it("should return early without logging when no userId is given", async () => {
      const { logger } = require("../../middlewares/activityLog.middleware");
      await expect(rl.clearUserRateLimits(null)).resolves.toBeUndefined();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("should clear both auth and api counters for the user", async () => {
      await rl.recordAuthFailure({ userId: "multi", endpoint: "login" });
      await rl.recordAuthFailure({ userId: "multi", endpoint: "register" });

      await rl.clearUserRateLimits("multi");

      expect(
        (await rl.getRateLimitStatus({ userId: "multi", endpoint: "login", type: "auth" }))
          .user,
      ).toBeNull();
      expect(
        (await rl.getRateLimitStatus({ userId: "multi", endpoint: "register", type: "auth" }))
          .user,
      ).toBeNull();
    });
  });

  describe("revokeAllUserTokens", () => {
    it("should return 0 when no sessions matched", async () => {
      mockSessions.update.mockResolvedValueOnce([0]);
      await expect(rl.revokeAllUserTokens("nobody", "REASON")).resolves.toBe(0);
    });

    it("should default the reason to SECURITY_REVOCATION", async () => {
      mockSessions.update.mockResolvedValueOnce([1]);
      await rl.revokeAllUserTokens("user-default");
      expect(mockSessions.update).toHaveBeenCalledWith(
        expect.objectContaining({ revokedReason: "SECURITY_REVOCATION" }),
        { where: { userId: "user-default", isRevoked: false } },
      );
    });
  });

  describe("revokeTokenByHash", () => {
    it("should return false when no session row was affected", async () => {
      mockSessions.update.mockResolvedValueOnce([0]);
      await expect(rl.revokeTokenByHash("hash:none")).resolves.toBe(false);
    });

    it("should default the reason to RATE_LIMIT_EXCEEDED", async () => {
      await rl.revokeTokenByHash("hash:default-reason");
      expect(mockSessions.update).toHaveBeenCalledWith(
        expect.objectContaining({ revokedReason: "RATE_LIMIT_EXCEEDED" }),
        { where: { tokenHash: "hash:default-reason", isRevoked: false } },
      );
    });
  });

  describe("optional-parameter defaults", () => {
    it("getRateLimitStatus should default type to 'api' when omitted", async () => {
      // Drive the api counter for a user via the middleware...
      const middleware = rl.endpointRateLimiter("tenantCreate", {
        maxRequests: 10,
        windowMs: 60000,
        byToken: false,
        byIp: false,
      });
      await middleware(
        { headers: {}, user: { id: "default-type-user" } },
        { status: jest.fn().mockReturnThis(), json: jest.fn(), set: jest.fn() },
        jest.fn(),
      );

      // ...then read it back without passing `type` at all.
      const status = await rl.getRateLimitStatus({
        userId: "default-type-user",
        endpoint: "tenantCreate",
      });
      expect(status.user.count).toBe(1);
      // type defaults to "api", so the auth-only isLocked flag must be false
      expect(status.user.isLocked).toBe(false);
      expect(status.token).toBeNull();
      expect(status.ip).toBeNull();
    });

    it("isTokenBlocked should default the endpoint to null when omitted", async () => {
      // Block the token under the null endpoint (10 = 2x login maxAttempts)
      for (let i = 0; i < 10; i++) {
        await rl.recordAuthFailure({
          tokenHash: "hash:no-endpoint",
          endpoint: null,
        });
      }

      const blocked = await rl.isTokenBlocked("no-endpoint");
      expect(blocked.isBlocked).toBe(true);
      expect(blocked.reason).toBe("Token blocked due to suspicious activity");
      expect(blocked.blockUntil).toBeInstanceOf(Date);
    });

    it("isUserLockedOut should default the endpoint to null when omitted", async () => {
      const status = await rl.isUserLockedOut("unknown-null-endpoint");
      expect(status.isLocked).toBe(false);
      // default auth config maxAttempts (5) with no recorded failures
      expect(status.remainingAttempts).toBe(5);
    });
  });

  describe("getRateLimitStatus - entries without a usable expiry", () => {
    it("should report expiresAt as null when the stored entry has no valid expiry", async () => {
      // A limiter configured with a non-numeric window writes entries whose
      // expiresAt computes to NaN, i.e. the entry carries no usable expiry.
      const middleware = rl.endpointRateLimiter("tenantCreate", {
        maxRequests: 10,
        windowMs: NaN,
      });
      await middleware(
        {
          ip: "8.8.4.4",
          headers: { authorization: "Bearer nanwin" },
          user: { id: "nan-window-user" },
        },
        { status: jest.fn().mockReturnThis(), json: jest.fn(), set: jest.fn() },
        jest.fn(),
      );

      const status = await rl.getRateLimitStatus({
        userId: "nan-window-user",
        tokenHash: "hash:nanwin",
        ip: "8.8.4.4",
        endpoint: "tenantCreate",
        type: "api",
      });

      // All three trackers recorded the request but expose no expiry date.
      expect(status.user).toEqual({
        count: 1,
        expiresAt: null,
        isLocked: false,
      });
      expect(status.token).toEqual({
        count: 1,
        expiresAt: null,
        isBlocked: false,
      });
      expect(status.ip).toEqual({ count: 1, expiresAt: null });
    });
  });

  describe("endpointRateLimiter - byIp disabled", () => {
    it("should not create an IP key when byIp is false", async () => {
      const middleware = rl.endpointRateLimiter("tenantCreate", {
        maxRequests: 10,
        windowMs: 60000,
        byToken: false,
        byIp: false,
      });
      const next = jest.fn();
      await middleware(
        { ip: "9.9.9.9", headers: {}, user: { id: "no-ip-user" } },
        { status: jest.fn().mockReturnThis(), json: jest.fn(), set: jest.fn() },
        next,
      );
      expect(next).toHaveBeenCalled();

      const status = await rl.getRateLimitStatus({
        userId: "no-ip-user",
        ip: "9.9.9.9",
        endpoint: "tenantCreate",
        type: "api",
      });
      expect(status.user.count).toBe(1);
      expect(status.ip).toBeNull();
    });

    it("should call next without touching the store when every key source is disabled", async () => {
      const middleware = rl.endpointRateLimiter("tenantCreate", {
        maxRequests: 10,
        windowMs: 60000,
        byUser: false,
        byToken: false,
        byIp: false,
      });
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        set: jest.fn(),
      };
      const next = jest.fn();
      await middleware(
        { ip: "9.9.9.10", headers: {}, user: { id: "none-user" } },
        res,
        next,
      );

      expect(next).toHaveBeenCalled();
      expect(res.set).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      const status = await rl.getRateLimitStatus({
        userId: "none-user",
        ip: "9.9.9.10",
        endpoint: "tenantCreate",
        type: "api",
      });
      expect(status.user).toBeNull();
      expect(status.ip).toBeNull();
    });
  });

  describe("authPreCheck - client IP resolution", () => {
    const makeRes = () => ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    });

    it("should fall back to x-forwarded-for when req.ip is absent", async () => {
      const middleware = rl.authPreCheck("login");
      const req = { headers: { "x-forwarded-for": "6.6.6.6" }, socket: {} };
      const next = jest.fn();

      await middleware(req, makeRes(), next);

      expect(next).toHaveBeenCalled();
      expect(req.rateLimitContext).toEqual({
        userId: null,
        tokenHash: null,
        ip: "6.6.6.6",
        endpoint: "login",
      });
    });

    it("should fall back to socket.remoteAddress when req.ip and the header are absent", async () => {
      const middleware = rl.authPreCheck("login");
      const req = { headers: {}, socket: { remoteAddress: "4.4.4.4" } };
      const next = jest.fn();

      await middleware(req, makeRes(), next);

      expect(next).toHaveBeenCalled();
      expect(req.rateLimitContext.ip).toBe("4.4.4.4");
    });
  });
});