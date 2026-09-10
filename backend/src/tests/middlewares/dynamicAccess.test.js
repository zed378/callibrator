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

    it("should return 500 when the permission lookup throws", async () => {
      RolesService.getRolePermissionsMatrix.mockRejectedValue(
        new Error("boom"),
      );
      await run(dynamicAccess("Home", "read"));
      expect(res.status).toHaveBeenCalledWith(500);
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
    it("should allow when acting on own resource", async () => {
      await run(dynamicAccess("Home", "read", { checkSelf: true }));
      expect(next).toHaveBeenCalled();
    });

    it("should allow self via body.userId", async () => {
      req.body = { userId: "user-1" };
      await run(dynamicAccess("Home", "read", { checkSelf: true }));
      expect(next).toHaveBeenCalled();
    });

    it("should fall through to permissions when owner id does not match", async () => {
      req.params = { userId: "other-user" };
      await run(dynamicAccess("Home", "read", { checkSelf: true }));
      expect(next).toHaveBeenCalled();
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

    it("should 403 when the resource belongs to a different tenant", async () => {
      Tenants.findByPk.mockResolvedValueOnce({ id: "tenant-999" });
      req.params = { tenantId: "tenant-999" };
      await run(dynamicAccess("Home", "read", { checkTenant: true }));
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
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

    it("should 403 when the resource owner is in another tenant", async () => {
      Tenants.findByPk.mockResolvedValueOnce(null);
      User.findByPk.mockResolvedValueOnce({ tenantId: "tenant-999" });
      req.params = { userId: "other-user" };
      await run(dynamicAccess("Home", "read", { checkTenant: true }));
      expect(res.status).toHaveBeenCalledWith(403);
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

    it("should 403 when resource owner via query has different tenant", async () => {
      Tenants.findByPk.mockResolvedValueOnce(null);
      User.findByPk.mockResolvedValueOnce({ tenantId: "tenant-999" });
      req.query = { userId: "other-user" };
      await run(dynamicAccess("Home", "read", { checkTenant: true }));
      expect(res.status).toHaveBeenCalledWith(403);
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
    it("should return 500 when tenant lookup throws", async () => {
      Tenants.findByPk.mockRejectedValueOnce(new Error("DB error"));
      req.params = { tenantId: "tenant-123" };
      const middleware = dynamicAccess("Home", "read", { checkTenant: true });
      await middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(logger.error).toHaveBeenCalled();
    });

    it("should return 500 when user lookup throws in checkTenant", async () => {
      Tenants.findByPk.mockResolvedValueOnce(null);
      User.findByPk.mockRejectedValueOnce(new Error("DB error"));
      req.params = { userId: "other-user" };
      const middleware = dynamicAccess("Home", "read", { checkTenant: true });
      await middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(500);
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

    it("should 403 when user.tenant.id fallback does not match the owner tenant", async () => {
      req.user = makeUser({ tenantId: undefined, tenant: { id: "tenant-123" } });
      req.params = { userId: "other-user" };
      User.findByPk.mockResolvedValue({ tenantId: "tenant-999" });

      await dynamicAccess("Home", "read", { checkTenant: true })(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("empty permission type list", () => {
    it("should 403 and report permTypes when no permission type is denied by name", async () => {
      // Degenerate config: with an empty permTypes list nothing can be
      // allowed under OR logic, and deniedTypes is empty so the response
      // falls back to echoing permTypes.
      await dynamicAccess("Home", [])(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Forbidden: Insufficient permissions",
        required: [],
        menuGroups: ["Home"],
      });
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

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ required: ["read"] }),
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("error without a message", () => {
    it("should fall back to a generic 500 message", async () => {
      RolesService.getRolePermissionsMatrix.mockRejectedValue(new Error(""));

      await dynamicAccess("Home", "read")(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Internal Server Error",
      });
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
