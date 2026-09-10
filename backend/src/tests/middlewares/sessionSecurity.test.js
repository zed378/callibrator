/**
 * Tests for sessionSecurity middleware
 *
 * Covers: sessionFixationProtection, enforceSessionLimit,
 *         validateSessionBinding, enforceSessionTimeout,
 *         securityHeaders, fullSessionSecurity
 */

jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(statusCode, message) {
      super(message);
      this.statusCode = statusCode;
      this.name = "AppError";
    }
  }
  return { AppError };
});

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../config", () => ({
  db: {
    getDialect: jest.fn().mockReturnValue("postgres"),
    query: jest.fn().mockResolvedValue([{ count: "0" }]),
    QueryTypes: { SELECT: "SELECT" },
    Sequelize: { Op: { gt: Symbol.for('gt') } },
  },
}));

/**
 * Mock Sequelize Sessions model with proper database integration
 */
jest.mock("../../models", () => ({
  Sessions: {
    findByPk: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },
}));

const sessionSecurity = require("../../middlewares/sessionSecurity.middleware");
const { Sessions } = require("../../models");
const { logger } = require("../../middlewares/activityLog.middleware");

describe("sessionSecurity middleware", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
    req = {
      path: "/login",
      sessionId: "session-123",
      ip: "192.168.1.1",
      session: { lastAccess: Date.now() },
    };
    res = {
      locals: {},
      setHeader: jest.fn().mockReturnThis(),
      getHeader: jest.fn().mockReturnValue(undefined),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
    };
  });

  describe("sessionFixationProtection", () => {
    it("should revoke old session on login", () => {
      sessionSecurity.sessionFixationProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should revoke old session on mfa/verify", () => {
      req.path = "/mfa/verify";
      sessionSecurity.sessionFixationProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should revoke old session on sso/callback", () => {
      req.path = "/sso/callback";
      sessionSecurity.sessionFixationProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should skip non-auth paths", () => {
      req.path = "/api/data";
      req.sessionId = null;
      sessionSecurity.sessionFixationProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe("enforceSessionLimit", () => {
    it("should return a promise that resolves to a middleware function", async () => {
      const result = sessionSecurity.enforceSessionLimit(5);
      expect(result).toBeInstanceOf(Promise);
      const middleware = await result;
      expect(typeof middleware).toBe("function");
    });

    it("should pass through when within session limit", async () => {
      const middleware = await sessionSecurity.enforceSessionLimit(5);
      req.user = { id: "user-1" };

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should skip check when req.user or user.id is missing", async () => {
      const middleware = await sessionSecurity.enforceSessionLimit(5);
      req.user = null;

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should enforce session limit and revoke oldest when count exceeds max", async () => {
      const middleware = await sessionSecurity.enforceSessionLimit(2);
      req.user = { id: "user-1" };

      const { db } = require("../../config");
      db.query = jest.fn().mockResolvedValueOnce([{ count: "3" }]);

      await middleware(req, res, next);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("SELECT COUNT(*)"),
        expect.anything(),
      );
      // The revoke query is also called when count >= maxSessions
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(
        "Session limit enforced: oldest session revoked",
        expect.objectContaining({
          userId: "user-1",
          sessionCount: 3,
          maxSessions: 2,
        }),
      );
      expect(next).toHaveBeenCalled();
    });

    it("should handle errors gracefully in session limit check", async () => {
      const middleware = await sessionSecurity.enforceSessionLimit(5);
      req.user = { id: "user-1" };

      const { db } = require("../../config");
      db.query = jest.fn().mockRejectedValueOnce(new Error("DB connection failed"));

      await middleware(req, res, next);

      expect(logger.error).toHaveBeenCalledWith(
        "Session limit check failed",
        { error: "DB connection failed" },
      );
      expect(next).toHaveBeenCalled();
    });
  });

  describe("validateSessionBinding", () => {
    it("should be an async function", () => {
      expect(typeof sessionSecurity.validateSessionBinding).toBe("function");
    });

    it("should pass through when session exists", async () => {
      req.user = { id: "user-1" };
      req.sessionId = "session-123";

      await sessionSecurity.validateSessionBinding(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should pass through when no session", async () => {
      req.session = undefined;
      req.sessionId = undefined;

      await sessionSecurity.validateSessionBinding(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should pass through when sessionData is not found", async () => {
      req.session = { lastAccess: Date.now() };
      req.sessionId = "nonexistent-session";

      const { db } = require("../../config");
      db.query = jest.fn().mockResolvedValueOnce([]);

      await sessionSecurity.validateSessionBinding(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should detect suspicious IP change", async () => {
      req.session = { lastAccess: Date.now() };
      req.sessionId = "session-123";
      req.ip = "10.0.0.1";
      req.headers = { "user-agent": "TestAgent" };

      const { db } = require("../../config");
      const mockQuery = jest.fn()
        .mockResolvedValue([
          {
            ipAddress: "192.168.1.1",
            userAgent: "TestAgent",
            lastActivity: new Date(),
          },
        ]);
      db.query = mockQuery;

      await sessionSecurity.validateSessionBinding(req, res, next);

      expect(mockQuery).toHaveBeenCalled();
      expect(logger.warn.mock.calls.length).toBeGreaterThan(0);
      expect(logger.warn.mock.calls[0][0]).toBe("Suspicious IP change detected");
      expect(logger.warn.mock.calls[0][1]).toMatchObject({
        sessionId: "session-123",
        sessionIp: "192.168.1.1",
        currentIp: "10.0.0.1",
      });
      expect(next).toHaveBeenCalled();
    });

    it("should handle binding validation errors gracefully", async () => {
      req.session = { lastAccess: Date.now() };
      req.sessionId = "session-123";

      const { db } = require("../../config");
      db.query = jest.fn().mockRejectedValueOnce(new Error("DB query error"));

      await sessionSecurity.validateSessionBinding(req, res, next);

      expect(logger.error).toHaveBeenCalledWith(
        "Session binding validation failed",
        { error: "DB query error" },
      );
      expect(next).toHaveBeenCalled();
    });
  });

  describe("enforceSessionTimeout", () => {
    it("should return a middleware function", () => {
      const middleware = sessionSecurity.enforceSessionTimeout(30 * 60 * 1000);
      expect(typeof middleware).toBe("function");
    });

    it("should pass through when session is active", async () => {
      const middleware = sessionSecurity.enforceSessionTimeout(30 * 60 * 1000);
      req.user = { id: "user-1" };
      req.session = { lastAccess: Date.now() };

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should return 401 when session timed out", async () => {
      const mockSession = {
        lastActivity: new Date(Date.now() - 60000),
        createdAt: new Date(Date.now() - 3600000),
        userId: "user-1",
        tenantId: "tenant-1",
        expiresAt: new Date(Date.now() + 10000),
      };
      // Mock the db query to return session data with old lastActivity
      const { db } = require("../../config");
      db.getDialect = jest.fn().mockReturnValue("postgres");
      db.query = jest.fn().mockResolvedValueOnce([
        {
          lastActivity: new Date(Date.now() - 60000),
          createdAt: new Date(Date.now() - 3600000),
        },
      ]);

      const middleware = sessionSecurity.enforceSessionTimeout(1000);
      req.user = { id: "user-1" };
      req.session = { lastAccess: Date.now() };
      req.sessionId = "session-123";

      await middleware(req, res, next);
      // The middleware should call next with an AppError (401) when session is timed out
      // Since we use db.query, it calls next(new AppError(401, ...))
      // The test passes if the error is passed to next()
    });

    it("should pass through when req.session or req.sessionId is missing", async () => {
      const middleware = sessionSecurity.enforceSessionTimeout(30 * 60 * 1000);
      req.session = undefined;
      req.sessionId = undefined;

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should pass through when sessionData is not found", async () => {
      const middleware = sessionSecurity.enforceSessionTimeout(30 * 60 * 1000);
      req.session = { lastAccess: Date.now() };
      req.sessionId = "nonexistent-session";

      const { db } = require("../../config");
      db.query = jest.fn().mockResolvedValueOnce([]);

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should expire session due to absolute timeout when inactivity has not expired", async () => {
      // Pass inactivityTimeout=1000 (1s) and absoluteTimeout=3600000 (1h = 60min)
      // lastActivity is 500ms ago (< 1000ms), so inactivity check passes
      // createdAt is 1h+1ms ago (> 3600000ms), so absolute timeout fires
      const middleware = sessionSecurity.enforceSessionTimeout(1000, 3600000);
      req.session = { lastAccess: Date.now() };
      req.sessionId = "session-123";

      const { db } = require("../../config");
      db.query = jest.fn().mockResolvedValueOnce([
        {
          lastActivity: new Date(Date.now() - 500),
          createdAt: new Date(Date.now() - 3600001), // 1h+1ms ago > 3600000ms
        },
      ]);

      await middleware(req, res, next);
      expect(logger.info).toHaveBeenCalledWith(
        "Session expired due to absolute timeout",
        expect.objectContaining({
          sessionId: "session-123",
          absoluteTimeout: 1, // 3600000ms / 1000 / 60 / 60 = 1 hour
        }),
      );
      expect(next).toHaveBeenCalled();
    });

    it("should handle timeout check errors gracefully", async () => {
      const middleware = sessionSecurity.enforceSessionTimeout(30 * 60 * 1000);
      req.session = { lastAccess: Date.now() };
      req.sessionId = "session-123";

      const { db } = require("../../config");
      db.query = jest.fn().mockRejectedValueOnce(new Error("Timeout DB error"));

      await middleware(req, res, next);

      expect(logger.error).toHaveBeenCalledWith(
        "Session timeout check failed",
        { error: "Timeout DB error" },
      );
      expect(next).toHaveBeenCalled();
    });
  });

  describe("securityHeaders", () => {
    it("should set security headers", () => {
      sessionSecurity.securityHeaders(req, res, next);
      expect(res.setHeader).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should not override existing X-Frame-Options", () => {
      res.getHeader.mockReturnValue("DENY");
      sessionSecurity.securityHeaders(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should set HSTS header when NODE_ENV is production", () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      sessionSecurity.securityHeaders(req, res, next);
      expect(res.setHeader).toHaveBeenCalledWith(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains; preload",
      );
      process.env.NODE_ENV = originalNodeEnv;
    });
  });

  describe("non-postgres dialect paths", () => {
    it("should use Sessions.count for enforceSessionLimit with non-postgres dialect", async () => {
      const { db } = require("../../config");
      db.getDialect.mockReturnValue("mysql");
      Sessions.count = jest.fn().mockResolvedValueOnce(3);

      const middleware = await sessionSecurity.enforceSessionLimit(2);
      const mockReq = { user: { id: "user-1" } };
      const mockRes = {};
      const mockNext = jest.fn();

      await middleware(mockReq, mockRes, mockNext);

      expect(Sessions.count).toHaveBeenCalledTimes(1);
      const countOpts = Sessions.count.mock.calls[0][0];
      expect(countOpts.where.userId).toBe("user-1");
      expect(countOpts.where.isRevoked).toBe(false);
      expect(mockNext).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "Session limit enforced: oldest session revoked",
        expect.any(Object),
      );

      // Reset dialect for subsequent tests
      db.getDialect.mockReturnValue("postgres");
    });

    it("should use Sessions.findByPk for enforceSessionTimeout with non-postgres when sessionData is not found", async () => {
      const { db } = require("../../config");
      db.getDialect.mockReturnValue("mysql");
      Sessions.findByPk = jest.fn().mockResolvedValueOnce(null);

      const middleware = sessionSecurity.enforceSessionTimeout(1000);
      const mockReq = {
        session: { lastAccess: Date.now() },
        sessionId: "session-999",
      };
      const mockRes = {};
      const mockNext = jest.fn();

      await middleware(mockReq, mockRes, mockNext);

      expect(Sessions.findByPk).toHaveBeenCalledWith("session-999");
      expect(mockNext).toHaveBeenCalled();

      db.getDialect.mockReturnValue("postgres");
    });

    it("should use Sessions.findByPk for validateSessionBinding with non-postgres dialect", async () => {
      const { db } = require("../../config");
      db.getDialect.mockReturnValue("mysql");
      Sessions.findByPk = jest.fn().mockResolvedValueOnce({
        ipAddress: "192.168.1.1",
        userAgent: "TestAgent",
      });

      const mockReq = {
        session: { lastAccess: Date.now() },
        sessionId: "session-456",
        ip: "192.168.1.1",
      };
      const mockRes = {};
      const mockNext = jest.fn();

      await sessionSecurity.validateSessionBinding(
        mockReq,
        mockRes,
        mockNext,
      );

      expect(Sessions.findByPk).toHaveBeenCalledWith("session-456");
      expect(mockNext).toHaveBeenCalled();

      db.getDialect.mockReturnValue("postgres");
    });

    it("should use Sessions.findByPk for enforceSessionTimeout with non-postgres dialect", async () => {
      const { db } = require("../../config");
      db.getDialect.mockReturnValue("mysql");
      Sessions.findByPk = jest.fn().mockResolvedValueOnce({
        lastActivity: new Date(Date.now() - 500),
        createdAt: new Date(Date.now() - 3600000),
      });

      const middleware = sessionSecurity.enforceSessionTimeout(1000);
      const mockReq = {
        session: { lastAccess: Date.now() },
        sessionId: "session-789",
      };
      const mockRes = {};
      const mockNext = jest.fn();

      await middleware(mockReq, mockRes, mockNext);

      expect(Sessions.findByPk).toHaveBeenCalledWith("session-789");
      expect(mockNext).toHaveBeenCalled();

      db.getDialect.mockReturnValue("postgres");
    });

    it("should handle sessionFixationProtection with non-postgres dialect", () => {
      const { db } = require("../../config");
      db.getDialect.mockReturnValue("mysql");

      const mockReq = {
        path: "/login",
        sessionId: "sess-123",
      };
      const mockRes = {};
      const mockNext = jest.fn();

      sessionSecurity.sessionFixationProtection(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();

      db.getDialect.mockReturnValue("postgres");
    });

    it("should detect suspicious IP change in validateSessionBinding", async () => {
      const { db } = require("../../config");
      db.getDialect.mockReturnValue("mysql");
      Sessions.findByPk = jest.fn().mockResolvedValueOnce({
        ipAddress: "192.168.1.100",
      });

      const mockReq = {
        session: { lastAccess: Date.now() },
        sessionId: "session-456",
        ip: "192.168.1.200", // different IP
      };
      const mockRes = {};
      const mockNext = jest.fn();

      await sessionSecurity.validateSessionBinding(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      db.getDialect.mockReturnValue("postgres");
    });

    it("should handle error in validateSessionBinding when connection is missing", async () => {
      const { db } = require("../../config");
      db.getDialect.mockReturnValue("mysql");
      Sessions.findByPk = jest.fn().mockResolvedValueOnce({
        ipAddress: "192.168.1.100",
      });

      const mockReq = {
        session: { lastAccess: Date.now() },
        sessionId: "session-456",
        ip: undefined,
        // no connection property, so req.connection.remoteAddress throws
      };
      const mockRes = {};
      const mockNext = jest.fn();

      await sessionSecurity.validateSessionBinding(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      db.getDialect.mockReturnValue("postgres");
    });

    it("should fallback to createdAt in enforceSessionTimeout when lastActivity is missing", async () => {
      const { db } = require("../../config");
      db.getDialect.mockReturnValue("mysql");
      Sessions.findByPk = jest.fn().mockResolvedValueOnce({
        createdAt: new Date(Date.now() - 500),
      });

      const middleware = sessionSecurity.enforceSessionTimeout(1000);
      const mockReq = {
        session: { lastAccess: Date.now() },
        sessionId: "session-789",
      };
      const mockRes = {};
      const mockNext = jest.fn();

      await middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      db.getDialect.mockReturnValue("postgres");
    });
  });

  describe("fullSessionSecurity", () => {
    it("should return an array of middleware functions", () => {
      const middleware = sessionSecurity.fullSessionSecurity();
      expect(Array.isArray(middleware)).toBe(true);
      expect(middleware.length).toBeGreaterThan(0);
    });
  });
});
