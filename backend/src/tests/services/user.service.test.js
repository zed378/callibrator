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
  getUploadUrl: jest.fn((f) => `/uploads/profile/${f}`),
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
jest.mock("../../validators/user.validator", () => ({
  validate: jest.fn((data) => ({ value: { ...data }, error: null })),
  formatErrors: jest.fn((d) => d),
  createUserSchema: "createUserSchema",
  updateUserSchema: "updateUserSchema",
  updateUserRoleSchema: "updateUserRoleSchema",
  checkUsernameSchema: "checkUsernameSchema",
}));

// ================================================================
// IMPORTS (after mocks are registered)
// ================================================================
const { db } = require("../../config");
const { Users, Roles } = require("../../models");
const { logger } = require("../../middlewares/activityLog.middleware");
const { hashPassword } = require("../../utils/password.util");
const { deleteUpload } = require("../../utils/upload.util");
const { validate: validateInput } = require("../../validators/user.validator");
const { DEFAULT_LIMIT } = require("../../constants");

const {
  fetchUsers,
  fetchSpecificUser,
  checkUsernameAvailability,
  userRoleUpdate,
  userCreate,
  editUser,
  updateUserAvatar,
  removeUserAvatar,
  deleteUser,
} = require("../../services/user.service");

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
    validateInput.mockReturnValue({
      value: {
        username: "test",
        firstName: "Test",
        lastName: "User",
        email: "test@test.com",
        password: "password123",
        roleId: "role-uuid",
        tenantId: "tenant-uuid",
        status: "ACTIVE",
      },
      error: null,
    });
  });

  // --------------------------------------------------------------
  // fetchUsers
  // --------------------------------------------------------------
  describe("fetchUsers", () => {
    const makeUserRow = (extra = {}) => {
      const data = {
        id: "u1",
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
        role: { get: () => ({ id: "r1", name: "admin", description: "Admin" }) },
      };
    };

    it("should fetch users with pagination", async () => {
      Users.findAndCountAll.mockResolvedValueOnce({
        rows: [makeUserRow()],
        count: 1,
      });
      db.transaction.mockResolvedValueOnce(mockTransaction());
      Users.findAll.mockResolvedValueOnce([{ status: "ACTIVE", count: 5 }]);

      const result = await fetchUsers({ tenantId: "t1", page: 1, limit: 10 });

      expect(result.success).toBe(true);
      expect(result.meta.page).toBe(1);
      expect(result.meta.totalPages).toBe(1);
      expect(result.data.rows.length).toBe(1);
      expect(result.data.rows[0].avatarUrl).toContain("avatar.png");
    });

    it("should throw when transaction fails", async () => {
      db.transaction.mockRejectedValueOnce(new Error("DB error"));
      await expectRejectsWithMessage(fetchUsers({ tenantId: "t1" }), "DB error");
    });
  });

  // --------------------------------------------------------------
  // fetchSpecificUser
  // --------------------------------------------------------------
  describe("fetchSpecificUser", () => {
    it("should return user by ID", async () => {
      const mockUser = {
        get: () => ({
          id: "u1",
          username: "test",
          email: "test@test.com",
          avatar_url: "a.png",
        }),
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);

      const result = await fetchSpecificUser("u1");
      expect(result.success).toBe(true);
      expect(result.data.username).toBe("test");
    });

    it("should throw 404 when user not found", async () => {
      Users.findByPk.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(fetchSpecificUser("nonexistent"), "User not found");
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
      Users.findOne.mockResolvedValueOnce({ id: "u1", username: "newuser" });
      const result = await checkUsernameAvailability({ username: "newuser" });
      expect(result.data.available).toBe(false);
    });
  });

  // --------------------------------------------------------------
  // userRoleUpdate
  // --------------------------------------------------------------
  describe("userRoleUpdate", () => {
    const makeMockUser = (overrides = {}) => ({
      get: () => ({ id: "u1", role_id: "old-role", ...overrides }),
      update: jest.fn().mockResolvedValue({}),
    });

    it("should update user role successfully", async () => {
      Users.findByPk.mockResolvedValueOnce(makeMockUser());
      Roles.findByPk.mockResolvedValueOnce({ id: "new-role", name: "editor", status: "active" });
      db.transaction.mockResolvedValueOnce(mockTransaction());

      const result = await userRoleUpdate({
        userId: "u1",
        roleId: "new-role",
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
        userRoleUpdate({ userId: "nonexistent", roleId: "role-uuid", updatedBy: "admin" }),
        "User not found",
      );
    });

    it("should throw 400 when role is inactive", async () => {
      Users.findByPk.mockResolvedValueOnce(makeMockUser());
      Roles.findByPk.mockResolvedValueOnce({ id: "inactive-role", name: "banned", status: "inactive" });
      db.transaction.mockResolvedValueOnce(mockTransaction());
      await expectRejectsWithMessage(
        userRoleUpdate({ userId: "u1", roleId: "inactive-role", updatedBy: "admin", actorIsSuperAdmin: true }),
        "Cannot assign inactive role to user",
      );
    });

    it("should throw 400 when user already has this role", async () => {
      const mockUser = {
        get: () => ({ id: "u1", role_id: "same-role" }),
        role_id: "same-role",
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);
      Roles.findByPk.mockResolvedValueOnce({ id: "same-role", name: "admin", status: "active" });
      db.transaction.mockResolvedValueOnce(mockTransaction());
      await expectRejectsWithMessage(
        userRoleUpdate({ userId: "u1", roleId: "same-role", updatedBy: "admin", actorIsSuperAdmin: true }),
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
      Roles.findByPk.mockResolvedValueOnce({ id: "r1", status: "active" });
      const createdUser = {
        id: "u1",
        tenantId: "t1",
        username: "newuser",
        firstName: "Test",
        lastName: "User",
        email: "test@test.com",
        role_id: "r1",
        status: "ACTIVE",
        is_email_verified: true,
        createdAt: new Date(),
        isEmailVerified: true,
        roleId: "r1",
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
        roleId: "r1",
        tenantId: "t1",
      });
      expect(result.success).toBe(true);
      expect(result.data.username).toBe("newuser");
    });

    it("should throw 409 when username already exists", async () => {
      Users.findOne.mockResolvedValueOnce({ id: "u1" });
      db.transaction.mockResolvedValueOnce({
        commit: jest.fn(),
        rollback: jest.fn(),
        finished: Promise.resolve(),
      });
      await expectRejectsWithMessage(
        userCreate({
          username: "taken",
          firstName: "T",
          lastName: "U",
          email: "t@t.com",
          password: "password123",
          roleId: "r1",
        }),
        "Username already used",
      );
    });

    it("should throw 409 when email already exists", async () => {
      Users.findOne.mockResolvedValueOnce(null);
      Users.findOne.mockResolvedValueOnce({ id: "u2" });
      db.transaction.mockResolvedValueOnce({
        commit: jest.fn(),
        rollback: jest.fn(),
        finished: Promise.resolve(),
      });
      await expectRejectsWithMessage(
        userCreate({
          username: "new",
          firstName: "T",
          lastName: "U",
          email: "taken@test.com",
          password: "password123",
          roleId: "r1",
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
          firstName: "T",
          lastName: "U",
          email: "n@n.com",
          password: "password123",
          roleId: "missing-role",
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
    const makeEditableUser = (overrides = {}) => ({
      get: () => ({
        id: "u1",
        username: "old",
        email: "old@test.com",
        firstName: "Old",
        lastName: "Name",
        status: "ACTIVE",
        ...overrides,
      }),
      update: jest.fn().mockResolvedValue({}),
    });

    it("should update user successfully", async () => {
      const mockUser = {
        get: () => ({
          id: "u1",
          username: "old",
          email: "old@test.com",
          firstName: "Old",
          lastName: "Name",
          status: "ACTIVE",
          tenantId: "t1",
          is_email_verified: true,
          is_active: true,
          updatedAt: new Date(),
        }),
        id: "u1",
        username: "newuser",
        email: "new@test.com",
        firstName: "New",
        lastName: "Name",
        status: "ACTIVE",
        tenantId: "t1",
        roleId: "r1",
        isEmailVerified: true,
        is_active: true,
        updatedAt: new Date(),
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);
      db.transaction.mockResolvedValueOnce(mockTransaction());

      const result = await editUser({
        userId: "u1",
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
      await expectRejectsWithMessage(editUser({ userId: "nonexistent", updatedBy: "admin" }), "User not found");
    });
  });

  // --------------------------------------------------------------
  // deleteUser
  // --------------------------------------------------------------
  describe("deleteUser", () => {
    it("should delete user successfully", async () => {
      const mockUser = {
        get: () => ({
          id: "u1",
          username: "touser",
          email: "t@t.com",
          picture: "/uploads/pic.png",
        }),
        id: "u1",
        username: "touser",
        email: "t@t.com",
        picture: "/uploads/pic.png",
        destroy: jest.fn().mockResolvedValue(1),
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);
      deleteUpload.mockResolvedValue(undefined);

      const result = await deleteUser({
        userId: "u1",
        deletedBy: "admin",
        actorIsSuperAdmin: true,
      });
      expect(result.success).toBe(true);
      expect(result.data.username).toBe("touser");
    });

    it("should throw 400 when trying to delete self", async () => {
      const mockUser = {
        get: () => ({
          id: "u1",
          username: "self",
          email: "s@s.com",
          picture: null,
        }),
        id: "u1",
        username: "self",
        email: "s@s.com",
        picture: null,
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);
      await expectRejectsWithMessage(
        deleteUser({ userId: "u1", deletedBy: "u1", actorIsSuperAdmin: true }),
        "You cannot delete your own account",
      );
    });

    it("should throw 400 when userId is missing", async () => {
      await expectRejectsWithMessage(deleteUser({ userId: null, deletedBy: "admin" }), "User ID is required");
    });

    it("should deny cross-tenant delete for a non-super-admin", async () => {
      const mockUser = {
        get: () => ({ id: "u2", username: "victim" }),
        id: "u2",
        tenantId: "tenant-B",
        role: { name: "USER" },
        roleId: "role-user",
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);
      await expectRejectsWithMessage(
        deleteUser({
          userId: "u2",
          deletedBy: "admin",
          actorIsSuperAdmin: false,
          actorTenantId: "tenant-A",
        }),
        "resource belongs to a different tenant",
      );
    });
  });

  // --------------------------------------------------------------
  // Access-control guards (tenant isolation + SUPER_ADMIN escalation)
  // --------------------------------------------------------------
  describe("access-control guards", () => {
    it("userRoleUpdate denies granting SUPER_ADMIN for a non-super-admin", async () => {
      const mockUser = {
        get: () => ({ id: "u1", role_id: "old-role" }),
        tenantId: "tenant-A",
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);
      Roles.findByPk.mockResolvedValueOnce({
        id: "super-role",
        name: "SUPERADMIN",
        status: "active",
      });
      db.transaction.mockResolvedValueOnce(mockTransaction());
      await expectRejectsWithMessage(
        userRoleUpdate({
          userId: "u1",
          roleId: "super-role",
          updatedBy: "admin",
          actorIsSuperAdmin: false,
          actorTenantId: "tenant-A",
        }),
        "cannot assign the SUPER_ADMIN role",
      );
    });

    it("userRoleUpdate denies cross-tenant modification", async () => {
      const mockUser = {
        get: () => ({ id: "u1", role_id: "old-role" }),
        tenantId: "tenant-B",
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);
      db.transaction.mockResolvedValueOnce(mockTransaction());
      await expectRejectsWithMessage(
        userRoleUpdate({
          userId: "u1",
          roleId: "new-role",
          updatedBy: "admin",
          actorIsSuperAdmin: false,
          actorTenantId: "tenant-A",
        }),
        "resource belongs to a different tenant",
      );
    });

    it("userCreate denies creating a SUPER_ADMIN for a non-super-admin", async () => {
      Users.findOne.mockResolvedValueOnce(null);
      Users.findOne.mockResolvedValueOnce(null);
      Roles.findByPk.mockResolvedValueOnce({
        id: "super-role",
        name: "SUPER_ADMIN",
        status: "active",
      });
      db.transaction.mockResolvedValueOnce(mockTransaction());
      await expectRejectsWithMessage(
        userCreate({
          username: "new",
          firstName: "T",
          lastName: "U",
          email: "n@n.com",
          password: "password123",
          roleId: "super-role",
          actorIsSuperAdmin: false,
          actorTenantId: "tenant-A",
        }),
        "cannot create a SUPER_ADMIN account",
      );
    });
  });

  // --------------------------------------------------------------
  // Avatar (regression: writes must use MODEL attributes, not columns)
  // --------------------------------------------------------------
  describe("updateUserAvatar", () => {
    it("persists the filename to the avatarUrl attribute", async () => {
      const mockUser = {
        picture: "default.svg",
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);

      const result = await updateUserAvatar("u1", "new-avatar.png", "actor-1");

      // `avatar_url` (the column) is NOT a model attribute — Sequelize would
      // silently drop it and the upload would report success without saving.
      expect(mockUser.update).toHaveBeenCalledWith(
        { avatarUrl: "new-avatar.png" },
        expect.objectContaining({ silent: true }),
      );
      expect(result.data.avatar).toBe("new-avatar.png");
      expect(result.status).toBe(200);
    });

    it("removes the previous avatar file but keeps default.svg", async () => {
      const mockUser = {
        picture: "/uploads/profile/old.png",
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);

      await updateUserAvatar("u1", "new.png", "actor-1");
      expect(deleteUpload).toHaveBeenCalledWith("old.png", "uploads/profile");
    });

    it("throws 404 when the user does not exist", async () => {
      Users.findByPk.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(
        updateUserAvatar("nope", "a.png", "actor-1"),
        "User not found",
      );
    });
  });

  describe("removeUserAvatar", () => {
    it("resets avatarUrl to default.svg (not the read-only `picture` getter)", async () => {
      const mockUser = {
        picture: "/uploads/profile/current.png",
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValueOnce(mockUser);

      const result = await removeUserAvatar("u1", "actor-1");

      expect(deleteUpload).toHaveBeenCalledWith(
        "current.png",
        "uploads/profile",
      );
      expect(mockUser.update).toHaveBeenCalledWith(
        { avatarUrl: "default.svg" },
        expect.objectContaining({ silent: true }),
      );
      expect(result.data.avatar).toBe("default.svg");
    });

    it("throws 404 when the user does not exist", async () => {
      Users.findByPk.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(
        removeUserAvatar("nope", "actor-1"),
        "User not found",
      );
    });
  });
});
