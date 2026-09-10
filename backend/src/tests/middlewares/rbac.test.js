/**
 * Tests for rbac middleware
 * Tests role-based access control with role name matching, level comparison,
 * allowHigher option, super-admin bypass, and notSuperAdmin middleware.
 */
const { ROLE_NAMES, ROLE_LEVELS } = require("../../constants");
const { rbac, checkRoleLevel, notSuperAdmin } = require("../../middlewares/rbac.middleware");
const { createMockReq, createMockNext } = require("../utils/test.utils");

describe("rbac middleware", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = createMockReq();
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = createMockNext();
  });

  // --- rbac() ---

  describe("rbac", () => {
    it("should reject when req.user is missing", () => {
      req.user = null;
      const middleware = rbac(["USER"]);
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 401, message: expect.stringContaining("Unauthorized") }),
      );
    });

    it("should reject when user has no role name", () => {
      req.user = { role: {} };
      const middleware = rbac(["USER"]);
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 401 }),
      );
    });

    it("should allow SUPER_ADMIN to bypass all checks", () => {
      req.user = { role: { name: ROLE_NAMES.SUPER_ADMIN } };
      const middleware = rbac(["USER"]);
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should allow SUPERADMIN (alias) to bypass all checks", () => {
      req.user = { role: { name: "SUPERADMIN" } };
      const middleware = rbac(["USER"]);
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should allow when user role is explicitly in the allowlist", () => {
      req.user = { role: { name: ROLE_NAMES.USER } };
      const middleware = rbac([ROLE_NAMES.USER]);
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should allow with allowHigher=true when user level exceeds minimum", () => {
      req.user = { role: { name: ROLE_NAMES.SUPERVISOR, role_level: ROLE_LEVELS.SUPERVISOR } };
      const middleware = rbac([ROLE_NAMES.TECHNICIAN]); // level 5
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should reject when user level is below minimum with allowHigher=true", () => {
      req.user = { role: { name: ROLE_NAMES.USER, role_level: ROLE_LEVELS.USER } };
      const middleware = rbac([ROLE_NAMES.SUPERVISOR]); // level 6
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 403, message: expect.stringContaining("Forbidden") }),
      );
    });

    it("should allow when user role name exactly matches with allowHigher=false", () => {
      req.user = { role: { name: ROLE_NAMES.TECHNICIAN, role_level: ROLE_LEVELS.TECHNICIAN } };
      const middleware = rbac([ROLE_NAMES.TECHNICIAN], { allowHigher: false });
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should reject when user level is higher but allowHigher is false", () => {
      req.user = { role: { name: ROLE_NAMES.ENGINEERING_MANAGER, role_level: ROLE_LEVELS.ENGINEERING_MANAGER } };
      const middleware = rbac([ROLE_NAMES.TECHNICIAN], { allowHigher: false });
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 403 }),
      );
    });

    it("should allow any authenticated user when rbac() is called with no requiredRoles", () => {
      req.user = { role: { name: ROLE_NAMES.USER, role_level: ROLE_LEVELS.USER } };
      const middleware = rbac();
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should use roleLevel fallback when role_level is missing", () => {
      req.user = { role: { name: ROLE_NAMES.SUPERVISOR, roleLevel: ROLE_LEVELS.SUPERVISOR } };
      const middleware = rbac([ROLE_NAMES.TECHNICIAN]);
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should pass when no listed roles map to known levels (minRequiredLevel=0)", () => {
      req.user = { role: { name: "FAKE_ROLE" } };
      const middleware = rbac(["NONEXISTENT_ROLE"]);
      middleware(req, res, next);
      // When no roles map to known levels, minRequiredLevel=0 and userRoleLevel=0
      // so the allowHigher check passes (0 >= 0)
      expect(next).toHaveBeenCalled();
    });
  });

  // --- checkRoleLevel ---

  describe("checkRoleLevel", () => {
    it("should pass when user role level meets the minimum", () => {
      req.user = { role: { roleLevel: 5 } };
      const middleware = checkRoleLevel(5);
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should reject when user role level is below minimum", () => {
      req.user = { role: { roleLevel: 3 } };
      const middleware = checkRoleLevel(5);
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 403, message: expect.stringContaining("Forbidden") }),
      );
    });

    it("should reject when req.user is missing", () => {
      req.user = null;
      const middleware = checkRoleLevel(1);
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 401 }),
      );
    });

    it("should reject when req.user.role is missing", () => {
      req.user = {};
      const middleware = checkRoleLevel(1);
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 401 }),
      );
    });

    it("should treat missing roleLevel as 0", () => {
      req.user = { role: {} };
      const middleware = checkRoleLevel(1);
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 403 }),
      );
    });
  });

  // --- notSuperAdmin ---

  describe("notSuperAdmin", () => {
    it("should pass for non-super-admin users", () => {
      req.user = { role: { name: ROLE_NAMES.USER } };
      const middleware = notSuperAdmin();
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should pass when req.user is null", () => {
      req.user = null;
      const middleware = notSuperAdmin();
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should reject SUPER_ADMIN", () => {
      req.user = { role: { name: ROLE_NAMES.SUPER_ADMIN } };
      const middleware = notSuperAdmin();
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 403, message: expect.stringContaining("Forbidden") }),
      );
    });

    it("should reject SUPERADMIN alias", () => {
      req.user = { role: { name: "SUPERADMIN" } };
      const middleware = notSuperAdmin();
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 403 }),
      );
    });

    it("should pass for users without a role", () => {
      req.user = {};
      const middleware = notSuperAdmin();
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe("extra branch checks", () => {
    it("should default to status 500 when error is generic in rbac middleware", () => {
      req.user = { role: { name: "USER" } };
      const middleware = rbac(null); // Will throw TypeError when mapping requiredRoles
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 500 }),
      );
    });

    it("should default minLevel to 1 in checkRoleLevel", () => {
      req.user = { role: { roleLevel: 0 } };
      const middleware = checkRoleLevel();
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 403 }),
      );
    });

    it("should skip undefined ROLE_LEVELS during module initialization", () => {
      jest.isolateModules(() => {
        jest.doMock("../../constants", () => ({
          ROLE_NAMES: { TEST_ROLE: "TEST_ROLE", OTHER_ROLE: "OTHER_ROLE" },
          ROLE_LEVELS: { TEST_ROLE: 5 }, // OTHER_ROLE has no level
        }));
        const { rbac } = require("../../middlewares/rbac.middleware");
        expect(rbac).toBeDefined();
      });
    });
  });

  // --- generic (non-Error) failure handling ---
  //
  // Each middleware's catch block falls back to "Internal Server Error" when the
  // thrown value carries no message, and classifies the status purely from the
  // message text. A throw that is neither Unauthorized nor Forbidden must
  // surface as a 500 rather than being mislabelled as an auth failure.

  describe("non-Error throws", () => {
    // Make a user object whose `role` access throws a value with no `.message`.
    const userWithThrowingRole = () => {
      const user = {};
      Object.defineProperty(user, "role", {
        get() {
          throw { code: "EUNEXPECTED" };
        },
      });
      return user;
    };

    it("rbac should return a 500 when a value without a message is thrown", () => {
      req.user = userWithThrowingRole();
      rbac(["USER"])(req, res, next);
      expect(next).toHaveBeenCalledWith({
        status: 500,
        message: "Internal Server Error",
        isOperational: true,
      });
    });

    it("checkRoleLevel should return a 500 when a value without a message is thrown", () => {
      const role = {};
      Object.defineProperty(role, "roleLevel", {
        get() {
          throw { code: "EUNEXPECTED" };
        },
      });
      req.user = { role };
      checkRoleLevel(5)(req, res, next);
      expect(next).toHaveBeenCalledWith({
        status: 500,
        message: "Internal Server Error",
        isOperational: true,
      });
    });

    it("notSuperAdmin should return a 500 when a value without a message is thrown", () => {
      const role = {};
      Object.defineProperty(role, "name", {
        get() {
          throw { code: "EUNEXPECTED" };
        },
      });
      req.user = { role };
      notSuperAdmin()(req, res, next);
      expect(next).toHaveBeenCalledWith({
        status: 500,
        message: "Internal Server Error",
        isOperational: true,
      });
    });
  });
});
