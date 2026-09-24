/**
 * Tests for dynamicAccess middleware
 */

const { expect } = require("@jest/globals");

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

jest.mock("../../models", () => ({
  User: {
    findByPk: jest.fn(),
  },
  Tenants: {
    findByPk: jest.fn(),
  },
}));

jest.mock("../../services/roles.service", () => {
  const mockGetRolePermissionsMatrix = jest.fn().mockResolvedValue({
    Home: ["read", "write"],
    Dashboard: ["read", "write"],
    Account: ["read", "write"],
    Management: ["read", "write"],
    Report: ["read", "write"],
  });
  return {
    hasRolePermission: jest.fn().mockReturnValue(true),
    getRolePermissionsMatrix: mockGetRolePermissionsMatrix,
  };
});

jest.mock("../../services/apiKey.service", () => ({
  scopeAllows: jest.fn().mockReturnValue(true),
}));

jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const {
  dynamicAccess,
  hasDynamicPermission,
  selfOwnerIdFromPath,
} = require("../../middlewares/dynamicAccess.middleware");
const RolesService = require("../../services/roles.service");
const { scopeAllows } = require("../../services/apiKey.service");
const {
  getUserOverrideMatrix,
} = require("../../services/userPermission.service");
const { User, Tenants } = require("../../models");
const { logger } = require("../../middlewares/activityLog.middleware");

const makeUser = (overrides = {}) => ({
  id: "user-1",
  role: { id: "role-1", name: "user" },
  permissions: [],
  isApiKey: false,
  apiKeyScopes: [],
  tenantId: "tenant-123",
  tenant: { id: "tenant-123" },
  ...overrides,
});

describe("dynamicAccess middleware", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    RolesService.getRolePermissionsMatrix.mockResolvedValue({
      Home: ["read", "write"],
      Dashboard: ["read", "write"],
      Account: ["read", "write"],
      Management: ["read", "write"],
      Report: ["read", "write"],
    });
    scopeAllows.mockReturnValue(true);
    getUserOverrideMatrix.mockResolvedValue({});
    // clearMocks only clears call history, not queued *Once implementations.
    // Reset these so an unconsumed mockResolvedValueOnce from a prior test
    // (e.g. checkTenant tests that provide userId and never call Tenants.findByPk)
    // cannot leak into a later test's first call.
    User.findByPk.mockReset();
    Tenants.findByPk.mockReset();
    User.findByPk.mockResolvedValue(null);
    Tenants.findByPk.mockResolvedValue(null);
    next = jest.fn();
    req = {
      user: makeUser(),
      params: {},
      body: {},
      method: "GET",
      path: "/api/test",
      ip: "192.168.1.1",
      query: {},
    };
    res = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  const run = (mw) => mw(req, res, next);

  describe("auth / role guards", () => {
    it("should return a middleware function", () => {
      expect(typeof dynamicAccess("Home", "read")).toBe("function");
    });

    it("should return 401 when there is no user context", async () => {
      req.user = null;
      await run(dynamicAccess("Home", "read"));
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 401 when the user has no role", async () => {
      req.user = { id: "user-1" };
      await run(dynamicAccess("Home", "read"));
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("should bypass for SUPER_ADMIN role", async () => {
      req.user = makeUser({ role: { id: "role-1", name: "SUPER_ADMIN" } });
      await run(dynamicAccess("Home", "read"));
      expect(next).toHaveBeenCalled();
    });

    it("should bypass for SUPERADMIN role (alt spelling)", async () => {
      req.user = makeUser({ role: { id: "role-1", name: "SUPERADMIN" } });
      await run(dynamicAccess("Home", "read"));
      expect(next).toHaveBeenCalled();
    });

    it("should hand a thrown permission lookup to next(err) (A-13)", async () => {
      const boom = new Error("boom");
      RolesService.getRolePermissionsMatrix.mockRejectedValue(boom);
      await run(dynamicAccess("Home", "read"));
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(boom);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("permission resolution", () => {
    it("should allow when the role matrix grants the permission", async () => {
      await run(dynamicAccess("Home", "read"));
      expect(next).toHaveBeenCalled();
    });

    it("should deny with 403 when the role matrix lacks the permission", async () => {
      RolesService.getRolePermissionsMatrix.mockResolvedValueOnce({ Home: [] });
      await run(dynamicAccess("Home", "write"));
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("should let write satisfy a read request", async () => {
      RolesService.getRolePermissionsMatrix.mockResolvedValueOnce({
        Home: ["write"],
      });
      await run(dynamicAccess("Home", "read"));
      expect(next).toHaveBeenCalled();
    });

    it("should use OR logic across menu groups by default", async () => {
      RolesService.getRolePermissionsMatrix.mockResolvedValue({
        Home: ["read"],
        Dashboard: [],
      });
      await run(dynamicAccess(["Home", "Dashboard"], "read"));
      expect(next).toHaveBeenCalled();
    });

    it("should require ALL groups when requireAll is set", async () => {
      RolesService.getRolePermissionsMatrix.mockResolvedValue({
        Home: ["read"],
        Dashboard: [],
      });
      await run(
        dynamicAccess(["Home", "Dashboard"], "read", { requireAll: true }),
      );
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("should allow when requireAll is satisfied", async () => {
      RolesService.getRolePermissionsMatrix.mockResolvedValue({
        Home: ["read"],
        Dashboard: ["read"],
      });
      await run(
        dynamicAccess(["Home", "Dashboard"], "read", { requireAll: true }),
      );
      expect(next).toHaveBeenCalled();
    });
  });

  describe("per-user overrides", () => {
    it("should deny when an override sets the menu to none", async () => {
      getUserOverrideMatrix.mockResolvedValueOnce({ Home: "none" });
      await run(dynamicAccess("Home", "read"));
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should honor a permission override", async () => {
      getUserOverrideMatrix.mockResolvedValueOnce({ Home: "write" });
      RolesService.getRolePermissionsMatrix.mockResolvedValueOnce({
        Home: [],
      });
      await run(dynamicAccess("Home", "read"));
      expect(next).toHaveBeenCalled();
    });

    it("should fall back to role permissions when override lookup fails", async () => {
      getUserOverrideMatrix.mockRejectedValueOnce(new Error("lookup failed"));
      await run(dynamicAccess("Home", "read"));
      expect(logger.error).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe("checkSelf", () => {
    // The matrix grants NOTHING in these tests, so `next()` can only come from
    // the self bypass — a pass via the permission matrix cannot mask it.
    beforeEach(() => {
      RolesService.getRolePermissionsMatrix.mockResolvedValue({});
    });

    it("allows the caller when the path :userId names them, without the menu grant", async () => {
      req.params = { userId: "user-1" };
      await run(dynamicAccess("users", "update", { checkSelf: true }));
      expect(next).toHaveBeenCalledWith();
      expect(req.dynamicAccessContext.reason).toBe("self");
    });

    it("allows the caller when the path :id names them", async () => {
      req.params = { id: "user-1" };
      await run(dynamicAccess("users", "update", { checkSelf: true }));
      expect(next).toHaveBeenCalledWith();
      expect(req.dynamicAccessContext.reason).toBe("self");
    });

    // A-63 DoD — named test.
    it("the self bypass reads no body or query field", async () => {
      // Every non-path place a caller could put their own id.
      req.body = { userId: "user-1", id: "user-1" };
      req.query = { userId: "user-1", id: "user-1" };
      req.params = {};

      await run(dynamicAccess("users", "update", { checkSelf: true }));

      // Not treated as self: the matrix (empty) decides, and refuses.
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
      expect(req.dynamicAccessContext).toBeUndefined();

      // And the helper the bypass uses cannot see them either.
      expect(
        selfOwnerIdFromPath({
          params: {},
          body: { userId: "user-1" },
          query: { userId: "user-1" },
        }),
      ).toBeUndefined();
      expect(selfOwnerIdFromPath({ params: { userId: "u" } })).toBe("u");
      expect(selfOwnerIdFromPath({ params: { id: "i" } })).toBe("i");
      expect(selfOwnerIdFromPath({})).toBeUndefined();
    });

    it("falls through to the matrix when the path names someone else", async () => {
      req.params = { userId: "other-user" };
      await run(dynamicAccess("users", "update", { checkSelf: true }));
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    // A-63: the bypass used to run BEFORE checkTenant and return next(), so a
    // "self" match skipped tenant isolation entirely.
    it("never skips checkTenant: self in the path with a foreign tenantId in the body is 404", async () => {
      Tenants.findByPk.mockResolvedValueOnce({ id: "tenant-999" });
      req.params = { userId: "user-1" };
      req.body = { tenantId: "tenant-999" };

      await run(
        dynamicAccess("users", "update", { checkSelf: true, checkTenant: true }),
      );

      expect(Tenants.findByPk).toHaveBeenCalledWith("tenant-999", {
        attributes: ["id"],
      });
      expect(res.status).toHaveBeenCalledWith(404);
      expect(next).not.toHaveBeenCalled();
    });

    it("self with checkTenant passes once the owner is confirmed in the caller's tenant", async () => {
      User.findByPk.mockResolvedValueOnce({ tenantId: "tenant-123" });
      req.params = { userId: "user-1" };

      await run(
        dynamicAccess("users", "update", { checkSelf: true, checkTenant: true }),
      );

      expect(User.findByPk).toHaveBeenCalledWith("user-1", {
        attributes: ["tenantId"],
      });
      expect(next).toHaveBeenCalledWith();
      expect(req.dynamicAccessContext.reason).toBe("self");
    });
  });

  describe("checkTenant", () => {
    it("should 404 when the resource tenant is not found", async () => {
      Tenants.findByPk.mockResolvedValueOnce(null);
      req.params = { tenantId: "missing" };
      await run(dynamicAccess("Home", "read", { checkTenant: true }));
      expect(res.status).toHaveBeenCalledWith(404);
      expect(next).not.toHaveBeenCalled();
    });

    // AZ-04. Was "should 403 when the resource belongs to a different tenant"
    // asserting `expect(res.status).toHaveBeenCalledWith(403)` — the test
    // encoded the tenant-membership oracle. Foreign must equal not-found.
    it("should 404 (not 403) when the resource belongs to a different tenant", async () => {
      Tenants.findByPk.mockResolvedValueOnce({ id: "tenant-999" });
      req.params = { tenantId: "tenant-999" };
      await run(dynamicAccess("Home", "read", { checkTenant: true }));
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        status: 404,
        message: "Tenant not found",
        data: null,
      });
      expect(next).not.toHaveBeenCalled();
      // The matrix is never reached for a foreign tenant.
      expect(RolesService.getRolePermissionsMatrix).not.toHaveBeenCalled();
    });

    it("should allow when the resource belongs to the user tenant", async () => {
      Tenants.findByPk.mockResolvedValueOnce({ id: "tenant-123" });
      req.params = { tenantId: "tenant-123" };
      await run(dynamicAccess("Home", "read", { checkTenant: true }));
      expect(next).toHaveBeenCalled();
    });

    it("should 404 when the resource owner is not found (no tenantId)", async () => {
      Tenants.findByPk.mockResolvedValueOnce(null);
      User.findByPk.mockResolvedValueOnce(null);
      req.params = { userId: "other-user" };
      await run(dynamicAccess("Home", "read", { checkTenant: true }));
      expect(res.status).toHaveBeenCalledWith(404);
    });

    // AZ-04. Was "should 403 when the resource owner is in another tenant"
    // asserting `expect(res.status).toHaveBeenCalledWith(403)`.
    it("should 404 (not 403) when the resource owner is in another tenant", async () => {
      Tenants.findByPk.mockResolvedValueOnce(null);
      User.findByPk.mockResolvedValueOnce({ tenantId: "tenant-999" });
      req.params = { userId: "other-user" };
      await run(dynamicAccess("Home", "read", { checkTenant: true }));
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("should allow when the resource owner shares the tenant", async () => {
      Tenants.findByPk.mockResolvedValueOnce(null);
      User.findByPk.mockResolvedValueOnce({ tenantId: "tenant-123" });
      req.params = { userId: "other-user" };
      await run(dynamicAccess("Home", "read", { checkTenant: true }));
      expect(next).toHaveBeenCalled();
    });
  });

  describe("API key principals", () => {
    beforeEach(() => {
      req.user = makeUser({ isApiKey: true, apiKeyScopes: ["Home:read"] });
    });

    it("should authorize via scopes when allowed", async () => {
      scopeAllows.mockReturnValue(true);
      await run(dynamicAccess("Home", "read"));
      expect(scopeAllows).toHaveBeenCalledWith(["Home:read"], "Home", "read");
      expect(next).toHaveBeenCalled();
    });

    it("should deny via scopes when not allowed", async () => {
      scopeAllows.mockReturnValue(false);
      await run(dynamicAccess("Home", "write"));
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should require all scopes when requireAll is set", async () => {
      scopeAllows.mockReturnValue(false);
      await run(dynamicAccess("Home", ["read", "write"], { requireAll: true }));
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should handle null scopes for API key", async () => {
      req.user = makeUser({ isApiKey: true, apiKeyScopes: null });
      scopeAllows.mockReturnValue(false);
      await run(dynamicAccess("Home", "read"));
      expect(scopeAllows).toHaveBeenCalledWith([], "Home", "read");
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should use OR logic across permission types by default", async () => {
      scopeAllows.mockReturnValueOnce(false).mockReturnValueOnce(true);
      await run(dynamicAccess("Home", ["read", "write"]));
      expect(next).toHaveBeenCalled();
    });

    it("should require all permission types when requireAll is set for API key", async () => {
      scopeAllows.mockReturnValueOnce(true).mockReturnValueOnce(false);
      await run(dynamicAccess("Home", ["read", "write"], { requireAll: true }));
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe("normalizePermission", () => {
    it("should normalize read to read", () => {
      const {
        normalizePermission,
      } = require("../../middlewares/dynamicAccess.middleware");
      // normalizePermission is not exported, but we can test via hasDynamicPermission
    });

    it("should normalize any other verb to write", async () => {
      RolesService.getRolePermissionsMatrix.mockResolvedValueOnce({
        Home: ["write"],
      });
      req.body = { menuGroup: "Home", permissionType: "create" };
      await hasDynamicPermission(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ allowed: true }),
        }),
      );
    });

    it("should normalize update to write", async () => {
      RolesService.getRolePermissionsMatrix.mockResolvedValueOnce({
        Home: ["write"],
      });
      req.body = { menuGroup: "Home", permissionType: "update" };
      await hasDynamicPermission(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ allowed: true }),
        }),
      );
    });

    it("should normalize delete to write", async () => {
      RolesService.getRolePermissionsMatrix.mockResolvedValueOnce({
        Home: ["write"],
      });
      req.body = { menuGroup: "Home", permissionType: "delete" };
      await hasDynamicPermission(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ allowed: true }),
        }),
      );
    });
  });

  describe("checkTenant with query userId", () => {
    it("should check resource owner tenant via query.userId", async () => {
      Tenants.findByPk.mockResolvedValueOnce(null);
      User.findByPk.mockResolvedValueOnce({ tenantId: "tenant-123" });
      req.query = { userId: "other-user" };
      await run(dynamicAccess("Home", "read", { checkTenant: true }));
      expect(next).toHaveBeenCalled();
    });

    // AZ-04. Was "should 403 when resource owner via query has different
    // tenant" asserting `expect(res.status).toHaveBeenCalledWith(403)`.
    it("should 404 (not 403) when resource owner via query has different tenant", async () => {
      Tenants.findByPk.mockResolvedValueOnce(null);
      User.findByPk.mockResolvedValueOnce({ tenantId: "tenant-999" });
      req.query = { userId: "other-user" };
      await run(dynamicAccess("Home", "read", { checkTenant: true }));
      expect(res.status).toHaveBeenCalledWith(404);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("checkTenant with body userId", () => {
    it("should check resource owner tenant via body.userId", async () => {
      Tenants.findByPk.mockResolvedValueOnce(null);
      User.findByPk.mockResolvedValueOnce({ tenantId: "tenant-123" });
      req.body = { userId: "other-user" };
      await run(dynamicAccess("Home", "read", { checkTenant: true }));
      expect(next).toHaveBeenCalled();
    });
  });

  describe("error handling in dynamicAccess", () => {
    it("should hand a thrown tenant lookup to next(err) (A-13)", async () => {
      const dbError = new Error("DB error");
      Tenants.findByPk.mockRejectedValueOnce(dbError);
      req.params = { tenantId: "tenant-123" };
      const middleware = dynamicAccess("Home", "read", { checkTenant: true });
      await middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it("should hand a thrown owner lookup in checkTenant to next(err) (A-13)", async () => {
      const dbError = new Error("DB error");
      Tenants.findByPk.mockResolvedValueOnce(null);
      User.findByPk.mockRejectedValueOnce(dbError);
      req.params = { userId: "other-user" };
      const middleware = dynamicAccess("Home", "read", { checkTenant: true });
      await middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});

describe("hasDynamicPermission", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    RolesService.getRolePermissionsMatrix.mockResolvedValue({
      Home: ["read", "write"],
      Dashboard: ["read", "write"],
      Account: ["read", "write"],
      Management: ["read", "write"],
      Report: ["read", "write"],
    });
    next = jest.fn();
    req = {
      user: makeUser(),
      body: { menuGroup: "Home", permissionType: "read" },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  it("should return 400 when menuGroup is missing", async () => {
    req.body = { permissionType: "read" };
    await hasDynamicPermission(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should return 400 when permissionType is missing", async () => {
    req.body = { menuGroup: "Home" };
    await hasDynamicPermission(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should return 401 when there is no user", async () => {
    req.user = null;
    await hasDynamicPermission(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("should return 200 with allowed true", async () => {
    await hasDynamicPermission(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ allowed: true }),
      }),
    );
  });

  it("should let write satisfy read", async () => {
    RolesService.getRolePermissionsMatrix.mockResolvedValueOnce({
      Home: ["write"],
    });
    await hasDynamicPermission(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ allowed: true }),
      }),
    );
  });

  it("should return 200 with allowed false", async () => {
    RolesService.getRolePermissionsMatrix.mockResolvedValueOnce({ Home: [] });
    await hasDynamicPermission(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ allowed: false }),
      }),
    );
  });

  it("should return 400 when body is missing", async () => {
    req.body = null;
    await hasDynamicPermission(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should return 500 on error", async () => {
    RolesService.getRolePermissionsMatrix.mockRejectedValue(new Error("boom"));
    await hasDynamicPermission(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(logger.error).toHaveBeenCalled();
  });

  describe("extra tenant and override branches", () => {
    it("should use user.tenant.id as fallback when user.tenantId is undefined", async () => {
      req.user = makeUser({
        tenantId: undefined,
        tenant: { id: "tenant-123" },
      });
      Tenants.findByPk = jest.fn().mockResolvedValue({ id: "tenant-123" });
      req.params = { tenantId: "tenant-123" };
      const middleware = dynamicAccess("Home", "read", { checkTenant: true });
      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should handle error when getUserOverrideMatrix throws in checkMenuPermission", async () => {
      getUserOverrideMatrix.mockRejectedValueOnce(
        new Error("Override matrix lookup failed"),
      );
      const middleware = dynamicAccess("Home", "read");
      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "UserPermission override lookup failed: Override matrix lookup failed",
        ),
      );
    });
  });
});

describe("dynamicAccess — remaining branches", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    RolesService.getRolePermissionsMatrix.mockResolvedValue({
      Home: ["read", "write"],
    });
    scopeAllows.mockReturnValue(true);
    getUserOverrideMatrix.mockResolvedValue({});
    User.findByPk.mockReset();
    Tenants.findByPk.mockReset();
    User.findByPk.mockResolvedValue(null);
    Tenants.findByPk.mockResolvedValue(null);
    next = jest.fn();
    req = {
      user: makeUser(),
      params: {},
      body: {},
      query: {},
      method: "GET",
      path: "/api/test",
      ip: "192.168.1.1",
    };
    res = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe("checkTenant with no tenant id and no owner id", () => {
    it("should skip both tenant lookups and fall through to the permission check", async () => {
      // Neither params/body/query carry a tenantId nor a userId, so the
      // middleware has nothing to isolate on and must defer to the matrix.
      await dynamicAccess("Home", "read", { checkTenant: true })(req, res, next);

      expect(Tenants.findByPk).not.toHaveBeenCalled();
      expect(User.findByPk).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("owner tenant resolution via user.tenant fallback", () => {
    it("should fall back to user.tenant.id when user.tenantId is absent", async () => {
      req.user = makeUser({ tenantId: undefined, tenant: { id: "tenant-123" } });
      req.params = { userId: "other-user" };
      User.findByPk.mockResolvedValue({ tenantId: "tenant-123" });

      await dynamicAccess("Home", "read", { checkTenant: true })(req, res, next);

      expect(User.findByPk).toHaveBeenCalledWith("other-user", {
        attributes: ["tenantId"],
      });
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    // AZ-04. Was "should 403 when user.tenant.id fallback does not match the
    // owner tenant" asserting `expect(res.status).toHaveBeenCalledWith(403)`.
    it("should 404 (not 403) when user.tenant.id fallback does not match the owner tenant", async () => {
      req.user = makeUser({ tenantId: undefined, tenant: { id: "tenant-123" } });
      req.params = { userId: "other-user" };
      User.findByPk.mockResolvedValue({ tenantId: "tenant-999" });

      await dynamicAccess("Home", "read", { checkTenant: true })(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("empty permission type list", () => {
    it("should 403 and log permTypes when no permission type is denied by name", async () => {
      // Degenerate config: with an empty permTypes list nothing can be
      // allowed under OR logic, and deniedTypes is empty so the log falls
      // back to permTypes. In-tenant permission failure: stays 403. The
      // `required` / `menuGroups` keys moved from the body to the log.
      await dynamicAccess("Home", [])(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        status: 403,
        message: "Forbidden: Insufficient permissions",
        data: null,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        "dynamicAccess: permission refusal",
        expect.objectContaining({ required: [], menuGroups: ["Home"] }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should attach a null permission when requireAll passes vacuously", async () => {
      await dynamicAccess("Home", [], { requireAll: true })(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.dynamicAccessContext).toEqual({
        allowed: true,
        menuGroups: ["Home"],
        permissionTypes: [],
        permission: null,
      });
    });
  });

  describe("menu missing from the matrix", () => {
    it("should deny with 403 when the role matrix has no entry for the menu", async () => {
      RolesService.getRolePermissionsMatrix.mockResolvedValue({});

      await dynamicAccess("Home", "read")(req, res, next);

      // In-tenant permission failure: stays 403; what was required is in
      // the log, not the body.
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.not.objectContaining({ required: expect.anything() }),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        "dynamicAccess: permission refusal",
        expect.objectContaining({
          requestId: "unknown",
          required: ["read"],
          menuGroups: ["Home"],
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("AZ-04 — tenant isolation refusals are indistinguishable", () => {
    // Drive the middleware once and return the exact status and serialized
    // body the client would receive.
    const capture = async (setup) => {
      const r = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const n = jest.fn();
      const rq = {
        user: makeUser(),
        params: {},
        body: {},
        query: {},
        method: "GET",
      };
      setup(rq);
      await dynamicAccess("Home", "read", { checkTenant: true })(rq, r, n);
      expect(n).not.toHaveBeenCalled();
      return {
        status: r.status.mock.calls[0][0],
        body: JSON.stringify(r.json.mock.calls[0][0]),
      };
    };

    it("tenant branch: a foreign tenant id and a non-existent one are byte-identical", async () => {
      const foreign = await capture((rq) => {
        Tenants.findByPk.mockResolvedValueOnce({ id: "tenant-999" });
        rq.params = { tenantId: "tenant-999" };
      });
      const missing = await capture((rq) => {
        Tenants.findByPk.mockResolvedValueOnce(null);
        rq.params = { tenantId: "tenant-000" };
      });

      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(foreign.body).toBe(missing.body);
      expect(foreign.body).toBe(
        '{"success":false,"status":404,"message":"Tenant not found","data":null}',
      );
    });

    it("owner branch: a foreign owner and a non-existent owner are byte-identical", async () => {
      const foreign = await capture((rq) => {
        User.findByPk.mockResolvedValueOnce({ tenantId: "tenant-999" });
        rq.params = { userId: "foreign-user" };
      });
      const missing = await capture((rq) => {
        User.findByPk.mockResolvedValueOnce(null);
        rq.params = { userId: "ghost-user" };
      });

      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(foreign.body).toBe(missing.body);
      expect(foreign.body).toBe(
        '{"success":false,"status":404,"message":"Resource not found","data":null}',
      );
    });

    it("logs the refusal reason against the request id, never in the body", async () => {
      Tenants.findByPk.mockResolvedValueOnce({ id: "tenant-999" });
      req.params = { tenantId: "tenant-999" };
      req.requestId = "req-xyz";
      req.originalUrl = "/api/v1/things/tenant-999";

      await dynamicAccess("Home", "read", { checkTenant: true })(req, res, next);

      expect(logger.warn).toHaveBeenCalledWith(
        "dynamicAccess: tenant isolation refusal",
        expect.objectContaining({
          requestId: "req-xyz",
          userId: "user-1",
          reason: "cross-tenant",
          resourceTenantId: "tenant-999",
          url: "/api/v1/things/tenant-999",
        }),
      );
      expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(
        /cross-tenant|different tenant/,
      );
    });

    it("an in-tenant permission failure on a checkTenant route stays 403", async () => {
      // Own tenant, but the role lacks the menu: this is NOT an isolation
      // refusal and must not be flattened to 404.
      Tenants.findByPk.mockResolvedValueOnce({ id: "tenant-123" });
      RolesService.getRolePermissionsMatrix.mockResolvedValue({ Home: [] });
      req.params = { tenantId: "tenant-123" };
      req.requestId = "req-perm";

      await dynamicAccess("Home", "write", { checkTenant: true })(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.status).not.toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        status: 403,
        message: "Forbidden: Insufficient permissions",
        data: null,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        "dynamicAccess: permission refusal",
        expect.objectContaining({ requestId: "req-perm", required: ["write"] }),
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("error without a message", () => {
    it("should hand a message-less error to next(err) untouched (A-13)", async () => {
      const blank = new Error("");
      RolesService.getRolePermissionsMatrix.mockRejectedValue(blank);

      await dynamicAccess("Home", "read")(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(blank);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe("A-13: an internal error reaches the client only through the global error handler", () => {
    // Drives the real errorHandlers.middleware (and the real
    // fileValidation.util#sanitizeError behind it) with whatever
    // dynamicAccess passed to next(), so the claim "production clients get a
    // generic message" is checked end to end rather than assumed.
    const { errorHandler } = require("../../middlewares/errorHandlers.middleware");
    const SECRET = 'relation "role_menu_permissions" does not exist at 10.1.2.3:5432';
    let savedEnv;

    beforeEach(() => {
      savedEnv = process.env.NODE_ENV;
      req.requestId = "req-a13";
      req.originalUrl = "/api/users";
    });

    afterEach(() => {
      process.env.NODE_ENV = savedEnv;
    });

    const driveThroughHandler = async () => {
      RolesService.getRolePermissionsMatrix.mockRejectedValue(new Error(SECRET));
      await dynamicAccess("Home", "read")(req, res, next);
      expect(res.json).not.toHaveBeenCalled();
      const [err] = next.mock.calls[0];
      errorHandler(err, req, res, jest.fn());
      return res.json.mock.calls[0][0];
    };

    it("production: 500 with a generic message, no stack, no internal detail", async () => {
      process.env.NODE_ENV = "production";
      const body = await driveThroughHandler();

      expect(res.status).toHaveBeenCalledWith(500);
      expect(body).toEqual({
        success: false,
        status: 500,
        message: "An unexpected error occurred. Please try again later.",
        requestId: "req-a13",
      });
      expect(JSON.stringify(body)).not.toContain("role_menu_permissions");
    });

    it("non-production: the handler still shows the message (developer aid, unchanged)", async () => {
      process.env.NODE_ENV = "development";
      const body = await driveThroughHandler();

      expect(res.status).toHaveBeenCalledWith(500);
      expect(body.message).toBe(SECRET);
    });
  });

  describe("hasDynamicPermission menu missing from the matrix", () => {
    it("should return allowed false when the matrix has no entry for the menu", async () => {
      RolesService.getRolePermissionsMatrix.mockResolvedValue({});
      req.body = { menuGroup: "Home", permissionType: "read" };

      await hasDynamicPermission(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { allowed: false, permission: null },
      });
    });
  });
});
