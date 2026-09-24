/**
 * Tests for dynamicAccess middleware when the activityLog logger is
 * unavailable.
 *
 * dynamicAccess.middleware.js guards every logging call with
 * `typeof logger !== "undefined"`. activityLog.middleware normally exports
 * `{ activityLogger, logger }`; here it exports neither, so the destructured
 * `logger` binding is undefined and the guards must take their false path.
 * The middleware still has to produce its normal responses rather than
 * crashing with "Cannot read properties of undefined".
 */

jest.mock("../../models", () => ({
  User: { findByPk: jest.fn() },
  Tenants: { findByPk: jest.fn() },
}));

jest.mock("../../services/roles.service", () => ({
  getRolePermissionsMatrix: jest.fn(),
}));

jest.mock("../../services/apiKey.service", () => ({
  scopeAllows: jest.fn().mockReturnValue(false),
}));

jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn(),
}));

// The logger is deliberately absent from this module's exports.
jest.mock("../../middlewares/activityLog.middleware", () => ({}));

const {
  dynamicAccess,
  hasDynamicPermission,
} = require("../../middlewares/dynamicAccess.middleware");
const RolesService = require("../../services/roles.service");
const {
  getUserOverrideMatrix,
} = require("../../services/userPermission.service");

describe("dynamicAccess without a logger", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    RolesService.getRolePermissionsMatrix.mockResolvedValue({
      Home: ["read", "write"],
    });
    getUserOverrideMatrix.mockResolvedValue({});
    next = jest.fn();
    req = {
      user: {
        id: "user-1",
        role: { id: "role-1", name: "user" },
        tenantId: "tenant-123",
      },
      params: {},
      body: {},
      query: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  it("confirms the mocked activityLog module exports no logger", () => {
    const activityLog = require("../../middlewares/activityLog.middleware");
    expect(activityLog.logger).toBeUndefined();
  });

  it("should still hand a thrown permission lookup to next(err) when there is no logger", async () => {
    const boom = new Error("boom");
    RolesService.getRolePermissionsMatrix.mockRejectedValue(boom);

    await dynamicAccess("Home", "read")(req, res, next);

    // A-13: the error goes to the global error handler (which sanitizes it in
    // production); this middleware writes nothing itself.
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("should still fall back to role permissions when the override lookup fails", async () => {
    getUserOverrideMatrix.mockRejectedValue(new Error("override down"));

    await dynamicAccess("Home", "read")(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  // AZ-04: the isolation refusal must still be produced — as a 404, the same
  // body as not-found — when there is nowhere to log the reason.
  it("should still refuse a foreign tenant with 404 when there is no logger", async () => {
    const { Tenants } = require("../../models");
    Tenants.findByPk.mockResolvedValueOnce({ id: "tenant-999" });
    req.params = { tenantId: "tenant-999" };

    await dynamicAccess("Home", "read", { checkTenant: true })(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      status: 404,
      message: "Tenant not found",
      data: null,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should still refuse an in-tenant permission failure with 403 when there is no logger", async () => {
    RolesService.getRolePermissionsMatrix.mockResolvedValue({ Home: [] });

    await dynamicAccess("Home", "write")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("should still return 500 from hasDynamicPermission when the lookup throws", async () => {
    RolesService.getRolePermissionsMatrix.mockRejectedValue(new Error("boom"));
    req.body = { menuGroup: "Home", permissionType: "read" };

    await hasDynamicPermission(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Internal Server Error",
    });
  });
});
