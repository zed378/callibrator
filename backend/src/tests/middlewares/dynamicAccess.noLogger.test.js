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

  it("should still return 500 when the permission lookup throws", async () => {
    RolesService.getRolePermissionsMatrix.mockRejectedValue(new Error("boom"));

    await dynamicAccess("Home", "read")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "boom",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should still fall back to role permissions when the override lookup fails", async () => {
    getUserOverrideMatrix.mockRejectedValue(new Error("override down"));

    await dynamicAccess("Home", "read")(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
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
