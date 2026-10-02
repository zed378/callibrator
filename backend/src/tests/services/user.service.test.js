/**
 * Tests for user.service.js
 *
 * Mocks must come before requires. Key mock: sequelize provides Op (like, notIn, ne)
 * because Sequelize 3.30.0 does NOT export Op at the top level â€” the service imports
 * `const { Op, Sequelize } = require("sequelize")` which would be undefined at runtime.
 */

// ================================================================
// MOCKS
// ================================================================

// --- sequelize: provide Op (like, notIn, ne etc.) and Sequelize.fn/col ---
// Sequelize 3.30.0 does NOT export Op at the top level.
// The service does: const { Op, Sequelize } = require("sequelize")
// so we must supply Op here. We avoid require("sequelize") in the factory
// because Jest resolves "sequelize" to this mock → infinite recursion.
// A-77: user mutations write their audit row inside the transaction.
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({}),
}));
jest.mock("sequelize", () => ({
  Sequelize: { fn: jest.fn(), col: jest.fn() },
  Op: {
    eq: Symbol("eq"),
    ne: Symbol("ne"),
    gte: Symbol("gte"),
    gt: Symbol("gt"),
    lte: Symbol("lte"),
    lt: Symbol("lt"),
    not: Symbol("not"),
    is: Symbol("is"),
    in: Symbol("in"),
    notIn: Symbol("notIn"),
    like: Symbol("like"),
    notLike: Symbol("notLike"),
    iLike: Symbol("iLike"),
    notILike: Symbol("notILike"),
    startsWith: Symbol("startsWith"),
    endsWith: Symbol("endsWith"),
    substring: Symbol("substring"),
    regexp: Symbol("regexp"),
    notRegexp: Symbol("notRegexp"),
    between: Symbol("between"),
    notBetween: Symbol("notBetween"),
    overlap: Symbol("overlap"),
    contains: Symbol("contains"),
    contained: Symbol("contained"),
    adjacent: Symbol("adjacent"),
    strictLeft: Symbol("strictLeft"),
    strictRight: Symbol("strictRight"),
    noExtendRight: Symbol("noExtendRight"),
    noExtendLeft: Symbol("noExtendLeft"),
    and: Symbol("and"),
    or: Symbol("or"),
    any: Symbol("any"),
    all: Symbol("all"),
    values: Symbol("values"),
    col: Symbol("col"),
    placeholder: Symbol("placeholder"),
    join: Symbol("join"),
    match: Symbol("match"),
  },
}));

// --- config ---
jest.mock("../../config", () => ({
  db: { transaction: jest.fn() },
}));

// --- models ---
jest.mock("../../models", () => ({
  Users: {
    findOne: jest.fn().mockResolvedValue(null),
    findByPk: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    findAndCountAll: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
    findAll: jest.fn().mockResolvedValue([]),
  },
  Roles: {
    findOne: jest.fn().mockResolvedValue(null),
    findByPk: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    findAndCountAll: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
    findAll: jest.fn().mockResolvedValue([]),
  },
}));

// --- utils ---
jest.mock("../../utils/password.util", () => ({ hashPassword: jest.fn().mockResolvedValue("hashed_pw") }));
jest.mock("../../utils/upload.util", () => ({
  deleteUpload: jest.fn(),
  getUploadUrl: jest.fn((f) => `/uploads/public/profile/${f}`),
}));
jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "AppError";
      this.status = status;
    }
  }
  return { AppError };
});

// --- middleware ---
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

// --- constants ---
jest.mock("../../constants", () => ({
  SUPER_ADMIN_ROLE_ID: "super-admin-uuid",
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
}));

// --- validators ---
// The request schemas are REAL (P9-11: Zod through validators/input): every
// input below is one the API accepts, and the validated value is what the
// service acts on.

// ================================================================
// IMPORTS (after mocks are registered)
// ================================================================
const { db } = require("../../config");
const { Users, Roles } = require("../../models");
require("../../middlewares/activityLog.middleware");
const { hashPassword } = require("../../utils/password.util");
const { deleteUpload } = require("../../utils/upload.util");
require("../../constants");

const {
  fetchUsers,
  fetchSpecificUser,
  checkUsernameAvailability,
  userRoleUpdate,
  userCreate,
  editUser,
  deleteUser,
} = require("../../services/user.service");

// Ids the request schemas accept (they are uuids since P9-11 validates for real).
const U1 = "00000001-0000-4000-8000-000000000001";
const U2 = "00000002-0000-4000-8000-000000000002";
const NONEXISTENT = "00000003-0000-4000-8000-000000000003";
const ROLE_UUID = "00000004-0000-4000-8000-000000000004";
const INACTIVE_ROLE = "00000005-0000-4000-8000-000000000005";
const SAME_ROLE = "00000006-0000-4000-8000-000000000006";
const NEW_ROLE = "00000007-0000-4000-8000-000000000007";
const OLD_ROLE = "00000008-0000-4000-8000-000000000008";
const R1 = "00000009-0000-4000-8000-000000000009";
const MISSING_ROLE = "0000000a-0000-4000-8000-00000000000a";
const SUPER_ROLE = "0000000b-0000-4000-8000-00000000000b";
const T1 = "0000000c-0000-4000-8000-00000000000c";
const ROLE_USER = "0000000d-0000-4000-8000-00000000000d";

// ================================================================
// HELPERS
// ================================================================

const mockTransaction = () => ({
  commit: jest.fn(),
  rollback: jest.fn(),
});

// The service throws plain objects like { status: 404, message: "..." }
// `expect().rejects.toThrow()` only catches Error instances.
// Helper: assert rejection with a message match on the thrown object.
const expectRejectsWithMessage = async (promise, message) => {
  try {
    await promise;
    expect(true).toBe(false); // Should have thrown
  } catch (err) {
    // err may be a plain object { status, message } or an Error
    expect(err).toBeDefined();
    const actual = (err && err.message) || String(err);
    expect(actual).toContain(message);
  }
};

// ================================================================
// TESTS
// ================================================================
describe("user.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hashPassword.mockResolvedValue("hashed_pw");
    deleteUpload.mockResolvedValue(undefined);
  });

  // --------------------------------------------------------------
  // fetchUsers
  // --------------------------------------------------------------
  describe("fetchUsers", () => {
    const makeUserRow = (extra = {}) => {
      const data = {
        id: U1,
        username: "testuser",
        email: "test@test.com",
        avatar_url: "avatar.png",
        firstName: "Test",
        lastName: "User",
        ...extra,
      };
      return {
        get: () => data,
        picture: data.avatar_url,
        first_name: data.firstName,
        last_name: data.lastName,
        role: { get: () => ({ id: R1, name: "admin", description: "Admin" }) },
      };
    };

    it("should fetch users with pagination", async () => {
      Users.findAndCountAll.mockResolvedValueOnce({
        rows: [makeUserRow()],
        count: 1,
      });
      db.transaction.mockResolvedValueOnce(mockTransaction());
      Users.findAll.mockResolvedValueOnce([{ status: "ACTIVE", count: 5 }]);

      const result = await fetchUsers({ tenantId: T1, page: 1, limit: 10 });

      expect(result.success).toBe(true);
      expect(result.meta.page).toBe(1);
      expect(result.meta.totalPages).toBe(1);
      expect(result.data.rows.length).toBe(1);
      expect(result.data.rows[0].avatarUrl).toContain("avatar.png");
    });

    it("should throw when transaction fails", async () => {
      db.transaction.mockRejectedValueOnce(new Error("DB error"));
      await expectRejectsWithMessage(fetchUsers({ tenantId: T1 }), "DB error");
    });
  });

  // --------------------------------------------------------------
  // fetchSpecificUser
  // --------------------------------------------------------------
  describe("fetchSpecificUser", () => {
    it("should return user by ID", async () => {
      const mockUser = {
        get: () => ({
          id: U1,
          username: "test",
          email: "test@test.com",
          avatar_url: "a.png",
        }),
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);

      const result = await fetchSpecificUser(U1);
      expect(result.success).toBe(true);
      expect(result.data.username).toBe("test");
    });

    it("should throw 404 when user not found", async () => {
      Users.findByPk.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(fetchSpecificUser(NONEXISTENT), "User not found");
    });
  });

  // --------------------------------------------------------------
  // checkUsernameAvailability
  // --------------------------------------------------------------
  describe("checkUsernameAvailability", () => {
    it("should return available when no user exists", async () => {
      Users.findOne.mockResolvedValueOnce(null);
      const result = await checkUsernameAvailability({ username: "newuser" });
      expect(result.data.available).toBe(true);
    });

    it("should return taken when user exists", async () => {
      Users.findOne.mockResolvedValueOnce({ id: U1, username: "newuser" });
      const result = await checkUsernameAvailability({ username: "newuser" });
      expect(result.data.available).toBe(false);
    });
  });

  // --------------------------------------------------------------
  // userRoleUpdate
  // --------------------------------------------------------------
  describe("userRoleUpdate", () => {
    const makeMockUser = (overrides = {}) => ({
      get: () => ({ id: U1, role_id: OLD_ROLE, ...overrides }),
      update: jest.fn().mockResolvedValue({}),
    });

    it("should update user role successfully", async () => {
      Users.findByPk.mockResolvedValueOnce(makeMockUser());
      Roles.findByPk.mockResolvedValueOnce({ id: NEW_ROLE, name: "editor", status: "active" });
      db.transaction.mockResolvedValueOnce(mockTransaction());

      const result = await userRoleUpdate({
        userId: U1,
        roleId: NEW_ROLE,
        updatedBy: "admin",
        actorIsSuperAdmin: true,
      });
      expect(result.success).toBe(true);
      expect(result.data.roleName).toBe("editor");
    });

    it("should throw 404 when user not found", async () => {
      Users.findByPk.mockResolvedValueOnce(null);
      db.transaction.mockResolvedValueOnce(mockTransaction());
      await expectRejectsWithMessage(
        userRoleUpdate({ userId: NONEXISTENT, roleId: ROLE_UUID, updatedBy: "admin" }),
        "User not found",
      );
    });

    it("should throw 400 when role is inactive", async () => {
      Users.findByPk.mockResolvedValueOnce(makeMockUser());
      Roles.findByPk.mockResolvedValueOnce({ id: INACTIVE_ROLE, name: "banned", status: "inactive" });
      db.transaction.mockResolvedValueOnce(mockTransaction());
      await expectRejectsWithMessage(
        userRoleUpdate({ userId: U1, roleId: INACTIVE_ROLE, updatedBy: "admin", actorIsSuperAdmin: true }),
        "Cannot assign inactive role to user",
      );
    });

    it("should throw 400 when user already has this role", async () => {
      const mockUser = {
        get: () => ({ id: U1, roleId: SAME_ROLE }),
        roleId: SAME_ROLE, // the attribute; `role_id` is gone (A-148)
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);
      Roles.findByPk.mockResolvedValueOnce({ id: SAME_ROLE, name: "admin", status: "active" });
      db.transaction.mockResolvedValueOnce(mockTransaction());
      await expectRejectsWithMessage(
        userRoleUpdate({ userId: U1, roleId: SAME_ROLE, updatedBy: "admin", actorIsSuperAdmin: true }),
        "User already has this role",
      );
    });
  });

  // --------------------------------------------------------------
  // userCreate
  // --------------------------------------------------------------
  describe("userCreate", () => {
    it("should create a new user", async () => {
      Users.findOne.mockResolvedValueOnce(null);
      Roles.findByPk.mockResolvedValueOnce({ id: R1, status: "active" });
      const createdUser = {
        id: U1,
        tenantId: T1,
        username: "newuser",
        firstName: "Test",
        lastName: "User",
        email: "test@test.com",
        role_id: R1,
        status: "ACTIVE",
        is_email_verified: true,
        createdAt: new Date(),
        isEmailVerified: true,
        roleId: R1,
      };
      Users.create.mockResolvedValueOnce(createdUser);
      Users.findByPk.mockResolvedValueOnce(createdUser);
      db.transaction.mockResolvedValueOnce({
        commit: jest.fn(),
        rollback: jest.fn(),
        finished: Promise.resolve(),
      });

      const result = await userCreate({
        username: "newuser",
        firstName: "Test",
        lastName: "User",
        email: "test@test.com",
        password: "password123",
        roleId: R1,
        tenantId: T1,
        // A-125 follow-up: a non-super-admin creates in its OWN tenant.
        actorTenantId: T1,
      });
      expect(result.success).toBe(true);
      expect(result.data.username).toBe("newuser");
    });

    it("should throw 409 when username already exists", async () => {
      Users.findOne.mockResolvedValueOnce({ id: U1 });
      db.transaction.mockResolvedValueOnce({
        commit: jest.fn(),
        rollback: jest.fn(),
        finished: Promise.resolve(),
      });
      await expectRejectsWithMessage(
        userCreate({
          username: "taken",
          firstName: "Te",
          lastName: "Us",
          email: "t@t.com",
          password: "password123",
          roleId: R1,
          actorTenantId: T1,
        }),
        "Username already used",
      );
    });

    it("should throw 409 when email already exists", async () => {
      Users.findOne.mockResolvedValueOnce(null);
      Users.findOne.mockResolvedValueOnce({ id: U2 });
      db.transaction.mockResolvedValueOnce({
        commit: jest.fn(),
        rollback: jest.fn(),
        finished: Promise.resolve(),
      });
      await expectRejectsWithMessage(
        userCreate({
          username: "new",
          firstName: "Te",
          lastName: "Us",
          email: "taken@test.com",
          password: "password123",
          roleId: R1,
          actorTenantId: T1,
        }),
        "Email already registered",
      );
    });

    it("should throw 404 when role not found", async () => {
      Users.findOne.mockResolvedValueOnce(null);
      Roles.findByPk.mockResolvedValueOnce(null);
      db.transaction.mockResolvedValueOnce({
        commit: jest.fn(),
        rollback: jest.fn(),
        finished: Promise.resolve(),
      });
      await expectRejectsWithMessage(
        userCreate({
          username: "new",
          firstName: "Te",
          lastName: "Us",
          email: "n@n.com",
          password: "password123",
          roleId: MISSING_ROLE,
          actorIsSuperAdmin: true,
        }),
        "Role not found",
      );
    });
  });

  // --------------------------------------------------------------
  // editUser
  // --------------------------------------------------------------
  describe("editUser", () => {
    it("should update user successfully", async () => {
      const mockUser = {
        get: () => ({
          id: U1,
          username: "old",
          email: "old@test.com",
          firstName: "Old",
          lastName: "Name",
          status: "ACTIVE",
          tenantId: T1,
          is_email_verified: true,
          is_active: true,
          updatedAt: new Date(),
        }),
        id: U1,
        username: "newuser",
        email: "new@test.com",
        firstName: "New",
        lastName: "Name",
        status: "ACTIVE",
        tenantId: T1,
        roleId: R1,
        isEmailVerified: true,
        is_active: true,
        updatedAt: new Date(),
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);
      db.transaction.mockResolvedValueOnce(mockTransaction());

      const result = await editUser({
        userId: U1,
        username: "newuser",
        firstName: "New",
        lastName: "Name",
        email: "new@test.com",
        status: "ACTIVE",
        updatedBy: "admin",
        actorIsSuperAdmin: true,
      });
      expect(result.success).toBe(true);
      expect(result.data.username).toBe("newuser");
    });

    it("should throw 404 when user not found", async () => {
      Users.findByPk.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(editUser({ userId: NONEXISTENT, updatedBy: "admin" }), "User not found");
    });
  });

  // --------------------------------------------------------------
  // deleteUser
  // --------------------------------------------------------------
  describe("deleteUser", () => {
    it("should delete user successfully", async () => {
      const mockUser = {
        get: () => ({
          id: U1,
          username: "touser",
          email: "t@t.com",
          picture: "/uploads/pic.png",
        }),
        id: U1,
        username: "touser",
        email: "t@t.com",
        picture: "/uploads/pic.png",
        destroy: jest.fn().mockResolvedValue(1),
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);
      deleteUpload.mockResolvedValue(undefined);
      // A-77: the delete and its audit row run in one transaction.
      db.transaction.mockResolvedValueOnce(mockTransaction());

      const result = await deleteUser({
        userId: U1,
        deletedBy: "admin",
        actorIsSuperAdmin: true,
      });
      expect(result.success).toBe(true);
      expect(result.data.username).toBe("touser");
    });

    it("should throw 400 when trying to delete self", async () => {
      const mockUser = {
        get: () => ({
          id: U1,
          username: "self",
          email: "s@s.com",
          picture: null,
        }),
        id: U1,
        username: "self",
        email: "s@s.com",
        picture: null,
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);
      await expectRejectsWithMessage(
        deleteUser({ userId: U1, deletedBy: U1, actorIsSuperAdmin: true }),
        "You cannot delete your own account",
      );
    });

    it("should throw 400 when userId is missing", async () => {
      await expectRejectsWithMessage(deleteUser({ userId: null, deletedBy: "admin" }), "User ID is required");
    });

    it("should refuse cross-tenant delete as not-found for a non-super-admin (AZ-04)", async () => {
      const mockUser = {
        get: () => ({ id: U2, username: "victim" }),
        id: U2,
        tenantId: "tenant-B",
        role: { name: "USER" },
        roleId: ROLE_USER,
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);
      await expectRejectsWithMessage(
        deleteUser({
          userId: U2,
          deletedBy: "admin",
          actorIsSuperAdmin: false,
          actorTenantId: "tenant-A",
        }),
        "User not found", // AZ-04: cross-tenant is indistinguishable from missing
      );
    });
  });

  // --------------------------------------------------------------
  // Access-control guards (tenant isolation + SUPER_ADMIN escalation)
  // --------------------------------------------------------------
  describe("access-control guards", () => {
    it("userRoleUpdate denies granting SUPER_ADMIN for a non-super-admin", async () => {
      const mockUser = {
        get: () => ({ id: U1, role_id: OLD_ROLE }),
        tenantId: "tenant-A",
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);
      Roles.findByPk.mockResolvedValueOnce({
        id: SUPER_ROLE,
        name: "SUPERADMIN",
        status: "active",
      });
      db.transaction.mockResolvedValueOnce(mockTransaction());
      await expectRejectsWithMessage(
        userRoleUpdate({
          userId: U1,
          roleId: SUPER_ROLE,
          updatedBy: "admin",
          actorIsSuperAdmin: false,
          actorTenantId: "tenant-A",
        }),
        "cannot assign the SUPER_ADMIN role",
      );
    });

    it("userRoleUpdate refuses cross-tenant modification as not-found (AZ-04)", async () => {
      const mockUser = {
        get: () => ({ id: U1, role_id: OLD_ROLE }),
        tenantId: "tenant-B",
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);
      db.transaction.mockResolvedValueOnce(mockTransaction());
      await expectRejectsWithMessage(
        userRoleUpdate({
          userId: U1,
          roleId: NEW_ROLE,
          updatedBy: "admin",
          actorIsSuperAdmin: false,
          actorTenantId: "tenant-A",
        }),
        "User not found", // AZ-04: cross-tenant is indistinguishable from missing
      );
    });

    it("userCreate denies creating a SUPER_ADMIN for a non-super-admin", async () => {
      Users.findOne.mockResolvedValueOnce(null);
      Users.findOne.mockResolvedValueOnce(null);
      Roles.findByPk.mockResolvedValueOnce({
        id: SUPER_ROLE,
        name: "SUPER_ADMIN",
        status: "active",
      });
      db.transaction.mockResolvedValueOnce(mockTransaction());
      await expectRejectsWithMessage(
        userCreate({
          username: "new",
          firstName: "Te",
          lastName: "Us",
          email: "n@n.com",
          password: "password123",
          roleId: SUPER_ROLE,
          actorIsSuperAdmin: false,
          actorTenantId: "tenant-A",
        }),
        "cannot create a SUPER_ADMIN account",
      );
    });
  });

  // Avatar: see user.avatar.a96.test.js (A-96 — audited in the transaction,
  // written to the avatarUrl ATTRIBUTE, old file deleted after the commit).
});
