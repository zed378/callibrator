/**
 * Tests for auditLog middleware
 */
const {
  auditAction,
  withAudit,
  recordAudit,
} = require("../../middlewares/auditLog.middleware");
const { logger } = require("../../middlewares/activityLog.middleware");
const auditService = require("../../services/audit.service");

describe("auditLog middleware", () => {
  let req, res, next, resEmitter;
  let spyInfo, spyError;

  beforeEach(() => {
    spyInfo = jest.spyOn(logger, "info").mockImplementation(() => {});
    spyError = jest.spyOn(logger, "error").mockImplementation(() => {});
    resEmitter = {
      statusCode: 200,
      json: jest.fn().mockImplementation((body) => body),
      listeners: jest.fn().mockReturnValue([]),
      on: jest.fn().mockImplementation(function (event, callback) {
        this._finishCallback = callback;
        return this;
      }),
      emitFinish: jest.fn().mockImplementation(function () {
        if (this._finishCallback) {
          this._finishCallback();
        }
        return true;
      }),
    };
    req = {
      ip: "127.0.0.1",
      get: jest.fn().mockReturnValue("Mozilla/5.0"),
      user: { id: "test-user-id", tenantId: "test-tenant-id" },
      body: { name: "test-role" },
      params: { id: "123" },
    };
    res = resEmitter;
    next = jest.fn();
  });

  afterEach(() => {
    spyInfo.mockRestore();
    spyError.mockRestore();
  });

  describe("auditAction", () => {
    it("should log audit action and intercept res.json", async () => {
      const middleware = auditAction("role_create", "Role");
      await middleware(req, res, next);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("AUDIT: role_create"),
        expect.objectContaining({
          userId: "test-user-id",
          tenantId: "test-tenant-id",
          resource: "Role",
          action: "role_create",
        }),
      );
      expect(next).toHaveBeenCalled();

      // Trigger the intercepted res.json
      const testBody = { success: true };
      res.json(testBody);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("AUDIT: role_create complete"),
        expect.objectContaining({
          userId: "test-user-id",
          tenantId: "test-tenant-id",
          statusCode: 200,
          success: true,
        }),
      );
    });

    it("should default user info if req.user is missing", async () => {
      delete req.user;
      const middleware = auditAction("role_create", "Role");
      await middleware(req, res, next);

      expect(logger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          userId: "anonymous",
          tenantId: null,
        }),
      );
    });
  });

  describe("withAudit", () => {
    it("should audit log start, call handler, and log complete on success", async () => {
      const handler = jest.fn().mockImplementation(async (req, res, next) => {
        res.statusCode = 201;
      });

      const middleware = withAudit("role_delete", "Role")(handler);
      await middleware(req, res, next);

      expect(logger.info).toHaveBeenCalledWith(
        "AUDIT START: role_delete",
        expect.any(Object),
      );
      expect(handler).toHaveBeenCalledWith(req, res, next);
      expect(logger.info).toHaveBeenCalledWith(
        "AUDIT COMPLETE: role_delete",
        expect.objectContaining({
          statusCode: 201,
          success: true,
        }),
      );
    });

    it("should audit log error when handler throws", async () => {
      const testError = new Error("something went wrong");
      const handler = jest.fn().mockRejectedValue(testError);

      const middleware = withAudit("role_delete", "Role")(handler);
      await expect(middleware(req, res, next)).rejects.toThrow(
        "something went wrong",
      );

      expect(logger.error).toHaveBeenCalledWith(
        "AUDIT ERROR: role_delete",
        expect.objectContaining({
          error: "something went wrong",
        }),
      );
    });

    it("should default userId to anonymous when req.user is missing in withAudit", async () => {
      delete req.user;
      const handler = jest.fn().mockImplementation(async (req, res, next) => {
        res.statusCode = 200;
      });

      const middleware = withAudit("role_delete", "Role")(handler);
      await middleware(req, res, next);

      expect(logger.info).toHaveBeenCalledWith(
        "AUDIT START: role_delete",
        expect.objectContaining({
          userId: "anonymous",
          tenantId: null,
        }),
      );
    });
  });

  describe("recordAudit", () => {
    let logActionSpy;

    beforeEach(() => {
      logActionSpy = jest
        .spyOn(auditService, "logAction")
        .mockResolvedValue(undefined);
    });

    afterEach(() => {
      logActionSpy.mockRestore();
    });

    it("should throw error for invalid action", () => {
      expect(() => recordAudit("INVALID_ACTION", "Resource")).toThrow(
        'recordAudit: invalid audit action "INVALID_ACTION"',
      );
    });

    it("should call next() immediately and log audit after finish", async () => {
      const middleware = recordAudit("CREATE", "User");
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(logActionSpy).not.toHaveBeenCalled();

      // Simulate response finish with success status
      res.statusCode = 201;
      res.emitFinish();

      expect(logActionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "CREATE",
          resourceType: "User",
        }),
      );
    });

    it("should not log when statusCode >= 400", async () => {
      const middleware = recordAudit("CREATE", "User");
      await middleware(req, res, next);

      res.statusCode = 500;
      res.emitFinish();

      expect(logActionSpy).not.toHaveBeenCalled();
    });

    it("should use resolveResourceId when provided", async () => {
      const resolveResourceId = jest.fn().mockReturnValue("custom-id");
      const middleware = recordAudit("UPDATE", "User", { resolveResourceId });
      await middleware(req, res, next);

      res.statusCode = 200;
      res.emitFinish();

      expect(resolveResourceId).toHaveBeenCalledWith(req, res);
      expect(logActionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: "custom-id",
        }),
      );
    });

    it("should use idParam from opts when provided", async () => {
      req.params = { userId: "param-id" };
      const middleware = recordAudit("DELETE", "User", { idParam: "userId" });
      await middleware(req, res, next);

      res.statusCode = 200;
      res.emitFinish();

      expect(logActionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: "param-id",
        }),
      );
    });

    it("should default to req.params.id when no opts provided", async () => {
      req.params = { id: "default-id" };
      const middleware = recordAudit("DELETE", "User");
      await middleware(req, res, next);

      res.statusCode = 200;
      res.emitFinish();

      expect(logActionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: "default-id",
        }),
      );
    });

    it("should set resourceId to null when resolveResourceId returns falsy", async () => {
      const middleware = recordAudit("CREATE", "User", {
        resolveResourceId: () => null,
      });
      await middleware(req, res, next);

      res.statusCode = 200;
      res.emitFinish();

      expect(logActionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: null,
        }),
      );
    });

    it("should handle errors in resolveResourceId gracefully", async () => {
      const middleware = recordAudit("CREATE", "User", {
        resolveResourceId: () => {
          throw new Error("resolve error");
        },
      });
      await middleware(req, res, next);

      res.statusCode = 200;
      res.emitFinish();

      expect(logActionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: null,
        }),
      );
    });

    it("should use req.tenantId when req.user.tenantId is missing", async () => {
      delete req.user.tenantId;
      req.tenantId = "req-tenant-id";
      const middleware = recordAudit("CREATE", "User");
      await middleware(req, res, next);

      res.statusCode = 200;
      res.emitFinish();

      expect(logActionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "req-tenant-id",
        }),
      );
    });

    it("should use req.ip when available", async () => {
      req.ip = "192.168.1.1";
      const middleware = recordAudit("CREATE", "User");
      await middleware(req, res, next);

      res.statusCode = 200;
      res.emitFinish();

      expect(logActionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          ipAddress: "192.168.1.1",
        }),
      );
    });

    it("should use req.get for userAgent when available", async () => {
      req.get = jest.fn().mockReturnValue("TestBrowser/1.0");
      const middleware = recordAudit("CREATE", "User");
      await middleware(req, res, next);

      res.statusCode = 200;
      res.emitFinish();

      expect(logActionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userAgent: "TestBrowser/1.0",
        }),
      );
    });

    it("should handle missing req.get gracefully", async () => {
      delete req.get;
      const middleware = recordAudit("CREATE", "User");
      await middleware(req, res, next);

      res.statusCode = 200;
      res.emitFinish();

      expect(logActionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userAgent: null,
        }),
      );
    });

    it("should use x-forwarded-for when req.ip is missing", async () => {
      delete req.ip;
      req.headers = { "x-forwarded-for": "10.0.0.1" };
      const middleware = recordAudit("CREATE", "User");
      await middleware(req, res, next);

      res.statusCode = 200;
      res.emitFinish();

      expect(logActionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          ipAddress: "10.0.0.1",
        }),
      );
    });

    it("should not call logAction when finish event is not emitted", async () => {
      const middleware = recordAudit("CREATE", "User");
      await middleware(req, res, next);

      expect(logActionSpy).not.toHaveBeenCalled();
    });
  });
});
