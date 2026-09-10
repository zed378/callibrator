/**
 * Additional branch/error coverage for user.service.js
 *
 * Conventions mirror user.service.test.js:
 *  - `sequelize` is mocked because Sequelize 3.x does not export `Op` at the
 *    top level, and the service does `require("sequelize").Op`.
 *  - Models are mocked via jest.mock("../../models"); the real src/models/index.js
 *    exports the plural aliases `Users` (models.User) and `Roles` (models.Role).
 *
 * The real utils/appError.util.js is deliberately NOT mocked here so that the
 * production `new AppError(status, message)` signature and `.status` (never
 * `.statusCode`) are exercised as-is.
 */

// ================================================================
// MOCKS
// ================================================================

jest.mock("sequelize", () => ({
  Sequelize: { fn: jest.fn(), col: jest.fn() },
  Op: {
    ne: Symbol("ne"),
    notIn: Symbol("notIn"),
    like: Symbol("like"),
    and: Symbol("and"),
    or: Symbol("or"),
  },
}));

jest.mock("../../config", () => ({
  db: { transaction: jest.fn() },
}));

jest.mock("../../models", () => ({
  Users: {
    findOne: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
    findAndCountAll: jest.fn(),
    findAll: jest.fn(),
  },
  Roles: {
    findOne: jest.fn(),
    findByPk: jest.fn(),
  },
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(),
}));

jest.mock("../../utils/upload.util", () => ({
  deleteUpload: jest.fn(),
  getUploadUrl: jest.fn((f) => `/uploads/profile/${f}`),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock("../../constants", () => ({
  SUPER_ADMIN_ROLE_ID: "super-admin-uuid",
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
}));

// Real export names from src/validators/user.validator.js:
// validate, formatErrors, createUserSchema, updateUserSchema,
// updateRoleSchema, usernameCheckSchema.
// The service aliases `updateRoleSchema` -> `updateUserRoleSchema`.
// `validate(body, schema)` really returns Joi's `{ error, value }`.
jest.mock("../../validators/user.validator", () => ({
  validate: jest.fn(),
  formatErrors: jest.fn((details) => details),
  createUserSchema: "createUserSchema",
  updateUserSchema: "updateUserSchema",
  updateRoleSchema: "updateRoleSchema",
  usernameCheckSchema: "usernameCheckSchema",
}));

// ================================================================
// IMPORTS
// ================================================================
const { db } = require("../../config");
const { Users, Roles } = require("../../models");
const { logger } = require("../../middlewares/activityLog.middleware");
const { hashPassword } = require("../../utils/password.util");
const { deleteUpload } = require("../../utils/upload.util");
const { validate: validateInput } = require("../../validators/user.validator");
const { AppError } = require("../../utils/appError.util");

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
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
});

/**
 * The service throws plain objects ({ status, message }) from most paths, so
 * `rejects.toThrow()` cannot be used. Capture and return the thrown value.
 */
const catchErr = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("Expected the promise to reject, but it resolved");
};

describe("user.service - branch & error coverage", () => {
  beforeEach(() => {
    // clearMocks:true wipes call history but NOT implementations, and
    // resetMocks:false means queued *Once values would leak between tests.
    // Reset every model mock explicitly and use non-Once defaults.
    Users.findOne.mockReset().mockResolvedValue(null);
    Users.findByPk.mockReset().mockResolvedValue(null);
    Users.create.mockReset().mockResolvedValue({});
    Users.findAndCountAll.mockReset().mockResolvedValue({ rows: [], count: 0 });
    Users.findAll.mockReset().mockResolvedValue([]);
    Roles.findOne.mockReset().mockResolvedValue(null);
    Roles.findByPk.mockReset().mockResolvedValue(null);
    db.transaction.mockReset().mockResolvedValue(mockTransaction());
    hashPassword.mockReset().mockResolvedValue("hashed_pw");
    deleteUpload.mockReset().mockResolvedValue(undefined);
    validateInput.mockReset().mockImplementation((data) => ({
      value: { ...data },
      error: null,
    }));
  });

  // ==============================================================
  // validate() helper — the shared 400 path
  // ==============================================================
  describe("validation failures", () => {
    it("should throw a 400 with formatted errors when userCreate input is invalid", async () => {
      validateInput.mockReturnValue({
        value: undefined,
        error: { details: [{ path: ["email"], message: "email is required" }] },
      });

      const err = await catchErr(userCreate({ username: "x" }));

      expect(err.status).toBe(400);
      expect(err.message).toBe("Validation failed");
      expect(err.errors).toEqual([
        { path: ["email"], message: "email is required" },
      ]);
      // Validation happens before any DB work
      expect(db.transaction).not.toHaveBeenCalled();
      expect(Users.create).not.toHaveBeenCalled();
    });

    it("should throw a 400 when userRoleUpdate input is invalid", async () => {
      validateInput.mockReturnValue({
        value: undefined,
        error: { details: [{ path: ["roleId"], message: "roleId must be a uuid" }] },
      });

      const err = await catchErr(userRoleUpdate({ userId: "u1" }));

      expect(err.status).toBe(400);
      expect(err.message).toBe("Validation failed");
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("should throw a 400 when editUser input is invalid", async () => {
      validateInput.mockReturnValue({
        value: undefined,
        error: { details: [{ path: ["status"], message: "invalid status" }] },
      });

      const err = await catchErr(editUser({ userId: "u1" }));

      expect(err.status).toBe(400);
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  // ==============================================================
  // fetchUsers
  // ==============================================================
  describe("fetchUsers", () => {
    const makeRow = (extra = {}) => {
      const data = { id: "u1", username: "u", email: "u@t.com", ...extra };
      return {
        get: () => data,
        picture: "pic.png",
        first_name: "First",
        last_name: "Last",
      };
    };

    it("should resolve a role passed as an object and skip tenant scoping for SUPER_ADMIN", async () => {
      Users.findAndCountAll.mockResolvedValue({ rows: [makeRow()], count: 1 });

      await fetchUsers({
        tenantId: "t1",
        role: { id: "super-admin-uuid" },
        includeSystemAccount: true,
      });

      const where = Users.findAndCountAll.mock.calls[0][0].where;
      // SUPER_ADMIN sees every tenant, so no tenantId/roleId restriction
      expect(where.tenantId).toBeUndefined();
      expect(where.roleId).toBeUndefined();
      // Roles.findOne is only used for string roles
      expect(Roles.findOne).not.toHaveBeenCalled();
    });

    it("should scope to the tenant and exclude SUPER_ADMIN for a non-super-admin role object", async () => {
      const { Op } = require("sequelize");
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await fetchUsers({ tenantId: "t1", role: { id: "regular-role" } });

      const where = Users.findAndCountAll.mock.calls[0][0].where;
      expect(where.tenantId).toBe("t1");
      expect(where.roleId).toEqual({ [Op.notIn]: ["super-admin-uuid"] });
    });

    it("should resolve a role passed as a string via Roles.findOne", async () => {
      Roles.findOne.mockResolvedValue({ id: "super-admin-uuid" });
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await fetchUsers({ tenantId: "t1", role: "SUPER_ADMIN" });

      expect(Roles.findOne).toHaveBeenCalledWith({
        where: { name: "SUPER_ADMIN" },
        attributes: ["id"],
      });
      // Resolved to the super-admin id -> tenant scoping skipped
      expect(Users.findAndCountAll.mock.calls[0][0].where.tenantId).toBeUndefined();
    });

    it("should fall back to tenant scoping when a string role does not resolve", async () => {
      Roles.findOne.mockResolvedValue(null);
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await fetchUsers({ tenantId: "t1", role: "UNKNOWN_ROLE" });

      expect(Users.findAndCountAll.mock.calls[0][0].where.tenantId).toBe("t1");
    });

    it("should build a lowercased LIKE search across username, names and email", async () => {
      const { Op } = require("sequelize");
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await fetchUsers({ tenantId: "t1", find: "  AbC" });

      const where = Users.findAndCountAll.mock.calls[0][0].where;
      expect(where[Op.or]).toEqual([
        { username: { [Op.like]: "%  abc%" } },
        { firstName: { [Op.like]: "%  abc%" } },
        { lastName: { [Op.like]: "%  abc%" } },
        { email: { [Op.like]: "%  abc%" } },
      ]);
    });

    it("should ignore a whitespace-only search term", async () => {
      const { Op } = require("sequelize");
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await fetchUsers({ tenantId: "t1", find: "   " });

      expect(Users.findAndCountAll.mock.calls[0][0].where[Op.or]).toBeUndefined();
    });

    it("should ignore a non-string search term", async () => {
      const { Op } = require("sequelize");
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await fetchUsers({ tenantId: "t1", find: 123 });

      expect(Users.findAndCountAll.mock.calls[0][0].where[Op.or]).toBeUndefined();
    });

    it("should apply an explicit roleFilter", async () => {
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await fetchUsers({ tenantId: "t1", roleFilter: "role-editor" });

      expect(Users.findAndCountAll.mock.calls[0][0].where.roleId).toBe("role-editor");
    });

    it("should not let roleFilter narrow to SUPER_ADMIN", async () => {
      const { Op } = require("sequelize");
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await fetchUsers({ tenantId: "t1", roleFilter: "super-admin-uuid" });

      // The notIn guard stays in place rather than being replaced by the filter
      expect(Users.findAndCountAll.mock.calls[0][0].where.roleId).toEqual({
        [Op.notIn]: ["super-admin-uuid"],
      });
    });

    it("should hide the seeded system account by default", async () => {
      const { Op } = require("sequelize");
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await fetchUsers({ tenantId: "t1" });

      expect(Users.findAndCountAll.mock.calls[0][0].where[Op.and]).toEqual([
        { username: { [Op.ne]: "sys" } },
        { email: { [Op.ne]: "sys@mail.com" } },
      ]);
    });

    it("should include the system account when explicitly requested", async () => {
      const { Op } = require("sequelize");
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await fetchUsers({ tenantId: "t1", includeSystemAccount: true });

      expect(Users.findAndCountAll.mock.calls[0][0].where[Op.and]).toBeUndefined();
    });

    it("should clamp limit to MAX_LIMIT and floor page at 1", async () => {
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      const result = await fetchUsers({ tenantId: "t1", page: -5, limit: 5000 });

      const args = Users.findAndCountAll.mock.calls[0][0];
      expect(args.limit).toBe(100); // MAX_LIMIT
      expect(args.offset).toBe(0); // page floored to 1
      expect(result.meta.limit).toBe(100);
    });

    it("should fall back to DEFAULT_LIMIT for a non-numeric limit", async () => {
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await fetchUsers({ tenantId: "t1", limit: "abc" });

      expect(Users.findAndCountAll.mock.calls[0][0].limit).toBe(20);
    });

    it("should aggregate status counts and expose pagination flags", async () => {
      Users.findAndCountAll.mockResolvedValue({
        rows: [makeRow()],
        count: 45,
      });
      Users.findAll.mockResolvedValue([
        { status: "ACTIVE", count: "40" },
        { status: "LOCKED", count: "5" },
        { status: "GHOST", count: "99" }, // unknown status is ignored
      ]);

      const result = await fetchUsers({ tenantId: "t1", page: 2, limit: 20 });

      expect(result.meta.statusCounts).toEqual({
        ACTIVE: 40,
        INACTIVE: 0,
        LOCKED: 5,
        SUSPENDED: 0,
      });
      expect(result.meta.total).toBe(45);
      expect(result.meta.totalPages).toBe(3);
      expect(result.meta.hasNextPage).toBe(true);
      expect(result.meta.hasPrevPage).toBe(true);
    });

    it("should still succeed with zeroed counts when the status query fails", async () => {
      Users.findAndCountAll.mockResolvedValue({ rows: [makeRow()], count: 1 });
      Users.findAll.mockRejectedValue(new Error("group by exploded"));

      const result = await fetchUsers({ tenantId: "t1" });

      expect(result.success).toBe(true);
      expect(result.meta.statusCounts).toEqual({
        ACTIVE: 0,
        INACTIVE: 0,
        LOCKED: 0,
        SUSPENDED: 0,
      });
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to fetch user status counts",
        expect.objectContaining({ error: "group by exploded" }),
      );
    });

    it("should roll back the transaction and rethrow when the query fails", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Users.findAndCountAll.mockRejectedValue(new Error("query failed"));

      const err = await catchErr(fetchUsers({ tenantId: "t1" }));

      expect(tx.rollback).toHaveBeenCalled();
      expect(tx.commit).not.toHaveBeenCalled();
      expect(err).toEqual({ status: 500, message: "query failed" });
    });

    it("should not attempt a rollback when the transaction was never opened", async () => {
      db.transaction.mockRejectedValue(new Error("no connection"));

      const err = await catchErr(fetchUsers({ tenantId: "t1" }));

      expect(err).toEqual({ status: 500, message: "no connection" });
    });

    it("should preserve a thrown status and default a missing message", async () => {
      Users.findAndCountAll.mockRejectedValue({ status: 418 });

      const err = await catchErr(fetchUsers({ tenantId: "t1" }));

      expect(err).toEqual({ status: 418, message: "Internal server error" });
    });

    it("should log the role id when role is an object", async () => {
      Users.findAndCountAll.mockRejectedValue(new Error("boom"));

      await catchErr(fetchUsers({ tenantId: "t1", role: { id: "r-9" } }));

      expect(logger.error).toHaveBeenCalledWith(
        "Error fetching users",
        expect.objectContaining({ role: "r-9" }),
      );
    });
  });

  // ==============================================================
  // fetchSpecificUser
  // ==============================================================
  describe("fetchSpecificUser", () => {
    it("should default the message when the failure carries none", async () => {
      Users.findByPk.mockRejectedValue({ status: 503 });

      const err = await catchErr(fetchSpecificUser("u1"));

      expect(err).toEqual({ status: 503, message: "Internal server error" });
    });

    it("should map an unexpected error to a 500", async () => {
      Users.findByPk.mockRejectedValue(new Error("connection reset"));

      const err = await catchErr(fetchSpecificUser("u1"));

      expect(err).toEqual({ status: 500, message: "connection reset" });
    });
  });

  // ==============================================================
  // checkUsernameAvailability
  // ==============================================================
  describe("checkUsernameAvailability", () => {
    it("should normalise the username before querying and in the response", async () => {
      const { Op } = require("sequelize");
      Users.findOne.mockResolvedValue(null);

      const result = await checkUsernameAvailability({ username: "  MiXeD  " });

      expect(Users.findOne).toHaveBeenCalledWith({
        where: { username: { [Op.like]: "mixed" } },
        attributes: ["id", "username"],
      });
      expect(result.data.username).toBe("mixed");
      expect(result.data.available).toBe(true);
      expect(result.message).toBe("Username is available");
    });

    it("should map a lookup failure to a 500", async () => {
      Users.findOne.mockRejectedValue(new Error("db gone"));

      const err = await catchErr(checkUsernameAvailability({ username: "x" }));

      expect(err).toEqual({ status: 500, message: "db gone" });
      expect(logger.error).toHaveBeenCalledWith(
        "Error checking username availability",
        expect.objectContaining({ err: "db gone" }),
      );
    });

    it("should reject when username is not a string", async () => {
      const err = await catchErr(checkUsernameAvailability({ username: 42 }));

      expect(err.status).toBe(500);
      expect(Users.findOne).not.toHaveBeenCalled();
    });
  });

  // ==============================================================
  // userRoleUpdate
  // ==============================================================
  describe("userRoleUpdate", () => {
    const makeUser = (overrides = {}) => ({
      id: "u1",
      tenantId: "tenant-A",
      role_id: "old-role",
      update: jest.fn().mockResolvedValue({}),
      ...overrides,
    });

    it("should throw 404 when the target role does not exist", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Users.findByPk.mockResolvedValue(makeUser());
      Roles.findByPk.mockResolvedValue(null);

      const err = await catchErr(
        userRoleUpdate({ userId: "u1", roleId: "ghost", actorIsSuperAdmin: true }),
      );

      expect(err).toEqual({ status: 404, message: "Role not found" });
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should block a non-super-admin from granting the SUPER_ADMIN role id", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      Users.findByPk.mockResolvedValue(makeUser());
      Roles.findByPk.mockResolvedValue({
        id: "super-admin-uuid",
        name: "Anything",
        status: "active",
      });

      const err = await catchErr(
        userRoleUpdate({
          userId: "u1",
          roleId: "super-admin-uuid",
          actorIsSuperAdmin: false,
          actorTenantId: "tenant-A",
        }),
      );

      expect(err.status).toBe(403);
      expect(err.message).toBe("Forbidden: cannot assign the SUPER_ADMIN role");
    });

    it("should block a non-super-admin from granting a role named SUPER_ADMIN", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      Users.findByPk.mockResolvedValue(makeUser());
      Roles.findByPk.mockResolvedValue({
        id: "other",
        name: "SUPER_ADMIN",
        status: "active",
      });

      const err = await catchErr(
        userRoleUpdate({
          userId: "u1",
          roleId: "other",
          actorIsSuperAdmin: false,
          actorTenantId: "tenant-A",
        }),
      );

      expect(err.status).toBe(403);
    });

    it("should allow a super-admin to grant the SUPER_ADMIN role", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      const user = makeUser();
      Users.findByPk.mockResolvedValue(user);
      Roles.findByPk.mockResolvedValue({
        id: "super-admin-uuid",
        name: "SUPER_ADMIN",
        status: "active",
      });

      const result = await userRoleUpdate({
        userId: "u1",
        roleId: "super-admin-uuid",
        updatedBy: "root",
        actorIsSuperAdmin: true,
      });

      expect(user.update).toHaveBeenCalledWith(
        { roleId: "super-admin-uuid" },
        { transaction: tx },
      );
      expect(tx.commit).toHaveBeenCalled();
      expect(result.data).toEqual({
        userId: "u1",
        roleId: "super-admin-uuid",
        roleName: "SUPER_ADMIN",
      });
    });

    it("should allow a non-super-admin to grant a normal role within their tenant", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      const user = makeUser({ tenantId: "tenant-A" });
      Users.findByPk.mockResolvedValue(user);
      Roles.findByPk.mockResolvedValue({
        id: "editor",
        name: "EDITOR",
        status: "active",
      });

      const result = await userRoleUpdate({
        userId: "u1",
        roleId: "editor",
        actorIsSuperAdmin: false,
        actorTenantId: "tenant-A",
      });

      expect(result.status).toBe(200);
      expect(user.update).toHaveBeenCalled();
    });

    it("should map an update failure to a 500 and roll back", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Users.findByPk.mockResolvedValue(
        makeUser({ update: jest.fn().mockRejectedValue(new Error("write failed")) }),
      );
      Roles.findByPk.mockResolvedValue({ id: "editor", name: "E", status: "active" });

      const err = await catchErr(
        userRoleUpdate({ userId: "u1", roleId: "editor", actorIsSuperAdmin: true }),
      );

      expect(err).toEqual({ status: 500, message: "write failed" });
      expect(tx.rollback).toHaveBeenCalled();
    });
  });

  // ==============================================================
  // userCreate
  // ==============================================================
  describe("userCreate", () => {
    const baseInput = {
      username: "newuser",
      firstName: "New",
      lastName: "User",
      email: "new@test.com",
      password: "password123",
      roleId: "role-1",
      tenantId: "tenant-client",
    };

    const activeRole = { id: "role-1", name: "EDITOR", status: "active", description: "Editors" };

    it("should reject an inactive role", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Users.findOne.mockResolvedValue(null);
      Roles.findByPk.mockResolvedValue({ id: "role-1", name: "E", status: "archived" });

      const err = await catchErr(
        userCreate({ ...baseInput, actorIsSuperAdmin: true }),
      );

      expect(err).toEqual({ status: 400, message: "Cannot assign inactive role to user" });
      expect(Users.create).not.toHaveBeenCalled();
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should throw 500 when the user disappears right after creation", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      Users.findOne.mockResolvedValue(null);
      Roles.findByPk.mockResolvedValue(activeRole);
      Users.create.mockResolvedValue({ id: "u-new" });
      Users.findByPk.mockResolvedValue(null); // read-back finds nothing

      const err = await catchErr(userCreate({ ...baseInput, actorIsSuperAdmin: true }));

      expect(err).toEqual({ status: 500, message: "User was not created successfully" });
    });

    it("should ignore the client tenantId for a non-super-admin", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      Users.findOne.mockResolvedValue(null);
      Roles.findByPk.mockResolvedValue(activeRole);
      const created = { id: "u-new", username: "newuser" };
      Users.create.mockResolvedValue(created);
      Users.findByPk.mockResolvedValue(created);

      await userCreate({
        ...baseInput,
        actorIsSuperAdmin: false,
        actorTenantId: "tenant-actor",
      });

      expect(Users.create.mock.calls[0][0].tenantId).toBe("tenant-actor");
    });

    it("should honour the supplied tenantId for a super-admin", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      Users.findOne.mockResolvedValue(null);
      Roles.findByPk.mockResolvedValue(activeRole);
      const created = { id: "u-new" };
      Users.create.mockResolvedValue(created);
      Users.findByPk.mockResolvedValue(created);

      await userCreate({ ...baseInput, actorIsSuperAdmin: true });

      expect(Users.create.mock.calls[0][0].tenantId).toBe("tenant-client");
    });

    it("should fall back to the client tenantId when a non-super-admin has none", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      Users.findOne.mockResolvedValue(null);
      Roles.findByPk.mockResolvedValue(activeRole);
      const created = { id: "u-new" };
      Users.create.mockResolvedValue(created);
      Users.findByPk.mockResolvedValue(created);

      await userCreate({ ...baseInput, actorIsSuperAdmin: false, actorTenantId: null });

      expect(Users.create.mock.calls[0][0].tenantId).toBe("tenant-client");
    });

    it("should null out blank first/last names, lowercase the email and hash the password", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      Users.findOne.mockResolvedValue(null);
      Roles.findByPk.mockResolvedValue(activeRole);
      const created = { id: "u-new" };
      Users.create.mockResolvedValue(created);
      Users.findByPk.mockResolvedValue(created);
      hashPassword.mockResolvedValue("$2b$hashed");

      await userCreate({
        ...baseInput,
        firstName: "   ",
        lastName: undefined,
        email: "  MiXeD@Test.COM ",
        username: "  spaced  ",
        status: undefined,
        actorIsSuperAdmin: true,
      });

      expect(hashPassword).toHaveBeenCalledWith("password123");
      expect(Users.create.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          username: "spaced",
          firstName: null,
          lastName: null,
          email: "mixed@test.com",
          password: "$2b$hashed",
          role_id: "role-1",
          status: "ACTIVE", // defaulted
          is_email_verified: true,
        }),
      );
    });

    it("should return a null roleDescription when the role has none", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      Users.findOne.mockResolvedValue(null);
      Roles.findByPk.mockResolvedValue({ id: "role-1", name: "EDITOR", status: "active" });
      const created = { id: "u-new", username: "newuser" };
      Users.create.mockResolvedValue(created);
      Users.findByPk.mockResolvedValue(created);

      const result = await userCreate({ ...baseInput, actorIsSuperAdmin: true });

      expect(result.status).toBe(201);
      expect(result.data.roleDescription).toBeNull();
      expect(result.data.roleName).toBe("EDITOR");
    });

    it("should skip the rollback once the transaction has finished", async () => {
      const tx = {
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        finished: "commit",
      };
      db.transaction.mockResolvedValue(tx);
      Users.findOne.mockResolvedValue(null);
      Roles.findByPk.mockResolvedValue(activeRole);
      Users.create.mockResolvedValue({ id: "u-new" });
      Users.findByPk.mockRejectedValue(new Error("read-back failed"));

      const err = await catchErr(userCreate({ ...baseInput, actorIsSuperAdmin: true }));

      expect(err).toEqual({ status: 500, message: "read-back failed" });
      expect(tx.commit).toHaveBeenCalled();
      expect(tx.rollback).not.toHaveBeenCalled();
    });
  });

  // ==============================================================
  // editUser
  // ==============================================================
  describe("editUser", () => {
    const makeUser = (overrides = {}) => ({
      id: "u1",
      tenantId: "tenant-A",
      username: "old",
      email: "old@test.com",
      firstName: "Old",
      lastName: "Name",
      status: "ACTIVE",
      isEmailVerified: false,
      is_active: true,
      update: jest.fn().mockResolvedValue({}),
      ...overrides,
    });

    it("should deny a cross-tenant edit for a non-super-admin", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Users.findByPk.mockResolvedValue(makeUser({ tenantId: "tenant-B" }));

      const err = await catchErr(
        editUser({
          userId: "u1",
          username: "hijack",
          actorIsSuperAdmin: false,
          actorTenantId: "tenant-A",
        }),
      );

      expect(err).toEqual({
        status: 403,
        message: "Access denied: resource belongs to a different tenant",
      });
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should throw 409 when the new username is taken by someone else", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      const user = makeUser();
      Users.findByPk.mockResolvedValue(user);
      Users.findOne.mockResolvedValue({ id: "u2" });

      const err = await catchErr(
        editUser({ userId: "u1", username: "taken", actorIsSuperAdmin: true }),
      );

      expect(err).toEqual({ status: 409, message: "Username already used" });
      expect(user.update).not.toHaveBeenCalled();
    });

    it("should throw 409 when the new email is taken by someone else", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      const user = makeUser();
      Users.findByPk.mockResolvedValue(user);
      Users.findOne.mockResolvedValue({ id: "u2" });

      const err = await catchErr(
        editUser({ userId: "u1", email: "taken@test.com", actorIsSuperAdmin: true }),
      );

      expect(err).toEqual({ status: 409, message: "Email already registered" });
    });

    it("should skip the uniqueness checks when username and email are unchanged", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      const user = makeUser();
      Users.findByPk.mockResolvedValue(user);

      await editUser({
        userId: "u1",
        username: "old",
        email: "old@test.com",
        actorIsSuperAdmin: true,
      });

      expect(Users.findOne).not.toHaveBeenCalled();
      expect(user.update).toHaveBeenCalled();
    });

    it("should keep existing values for fields that are not supplied", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      const user = makeUser();
      Users.findByPk.mockResolvedValue(user);
      // Only userId comes through validation
      validateInput.mockReturnValue({ value: { userId: "u1" }, error: null });

      await editUser({ userId: "u1", actorIsSuperAdmin: true });

      expect(user.update).toHaveBeenCalledWith(
        {
          tenantId: "tenant-A",
          username: "old",
          firstName: "Old",
          lastName: "Name",
          email: "old@test.com",
          status: "ACTIVE",
          isEmailVerified: false,
          isActive: true,
        },
        { transaction: tx },
      );
    });

    it("should apply every supplied field, trimming and lowercasing where relevant", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      const user = makeUser();
      Users.findByPk.mockResolvedValue(user);
      Users.findOne.mockResolvedValue(null);

      await editUser({
        userId: "u1",
        tenantId: "tenant-Z",
        username: "  brand-new  ",
        firstName: "  Fresh  ",
        lastName: "  Face  ",
        email: "  NEW@Test.Com  ",
        status: "INACTIVE",
        isEmailVerified: true,
        is_active: false,
        actorIsSuperAdmin: true,
      });

      expect(user.update).toHaveBeenCalledWith(
        {
          tenantId: "tenant-Z",
          username: "brand-new",
          firstName: "Fresh",
          lastName: "Face",
          email: "new@test.com",
          status: "INACTIVE",
          isEmailVerified: true,
          isActive: false,
        },
        { transaction: tx },
      );
    });

    it("should allow clearing first and last name to null", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      const user = makeUser();
      Users.findByPk.mockResolvedValue(user);
      validateInput.mockReturnValue({
        value: { userId: "u1", firstName: null, lastName: null },
        error: null,
      });

      await editUser({ userId: "u1", actorIsSuperAdmin: true });

      const payload = user.update.mock.calls[0][0];
      expect(payload.firstName).toBeUndefined();
      expect(payload.lastName).toBeUndefined();
    });

    it("should roll back and map an update failure to a 500", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Users.findByPk.mockResolvedValue(
        makeUser({ update: jest.fn().mockRejectedValue(new Error("update blew up")) }),
      );

      const err = await catchErr(editUser({ userId: "u1", actorIsSuperAdmin: true }));

      expect(err).toEqual({ status: 500, message: "update blew up" });
      expect(tx.rollback).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        "Error updating user",
        expect.objectContaining({ err: "update blew up" }),
      );
    });
  });

  // ==============================================================
  // updateUserAvatar / removeUserAvatar
  // ==============================================================
  describe("updateUserAvatar", () => {
    it("should rethrow the 404 AppError untouched when the user is missing", async () => {
      Users.findByPk.mockResolvedValue(null);

      const err = await catchErr(updateUserAvatar("nope", "a.png", "admin"));

      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(404);
      expect(err.message).toBe("User not found");
    });

    it("should not delete the shared default avatar", async () => {
      Users.findByPk.mockResolvedValue({
        picture: "/uploads/profile/default.svg",
        update: jest.fn().mockResolvedValue({}),
      });

      await updateUserAvatar("u1", "new.png", "admin");

      expect(deleteUpload).not.toHaveBeenCalled();
    });

    it("should wrap an unexpected failure in a 500 AppError", async () => {
      Users.findByPk.mockRejectedValue(new Error("db down"));

      const err = await catchErr(updateUserAvatar("u1", "a.png", "admin"));

      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(500);
      expect(err.message).toBe("Failed to update user avatar");
      expect(logger.error).toHaveBeenCalledWith("Error updating user avatar", {
        error: "db down",
      });
    });

    it("should rethrow a plain error that already carries a status", async () => {
      Users.findByPk.mockRejectedValue({ status: 409, message: "conflict" });

      const err = await catchErr(updateUserAvatar("u1", "a.png", "admin"));

      expect(err).toEqual({ status: 409, message: "conflict" });
    });
  });

  describe("removeUserAvatar", () => {
    it("should rethrow the 404 AppError untouched when the user is missing", async () => {
      Users.findByPk.mockResolvedValue(null);

      const err = await catchErr(removeUserAvatar("nope", "admin"));

      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(404);
    });

    it("should still reset the picture when deleting the old file fails", async () => {
      const user = {
        picture: "/uploads/profile/old.png",
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValue(user);
      deleteUpload.mockRejectedValue(new Error("ENOENT"));

      const result = await removeUserAvatar("u1", "admin");

      expect(logger.warn).toHaveBeenCalledWith(
        "Failed to delete avatar file: old.png",
        expect.any(Error),
      );
      expect(user.update).toHaveBeenCalledWith(
        { avatarUrl: "default.svg" },
        { silent: true },
      );
      expect(result.data).toEqual({ avatar: "default.svg" });
    });

    it("should not delete the shared default avatar but still reset it", async () => {
      const user = {
        picture: "default.svg",
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValue(user);

      await removeUserAvatar("u1", "admin");

      expect(deleteUpload).not.toHaveBeenCalled();
      expect(user.update).toHaveBeenCalledWith(
        { avatarUrl: "default.svg" },
        { silent: true },
      );
    });

    it("should wrap an unexpected failure in a 500 AppError", async () => {
      Users.findByPk.mockRejectedValue(new Error("db down"));

      const err = await catchErr(removeUserAvatar("u1", "admin"));

      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(500);
      expect(err.message).toBe("Failed to remove user avatar");
    });

    it("should rethrow a plain error that already carries a status", async () => {
      Users.findByPk.mockRejectedValue({ status: 400, message: "bad" });

      const err = await catchErr(removeUserAvatar("u1", "admin"));

      expect(err).toEqual({ status: 400, message: "bad" });
    });
  });

  // ==============================================================
  // deleteUser
  // ==============================================================
  describe("deleteUser", () => {
    const makeUser = (overrides = {}) => ({
      id: "u2",
      username: "victim",
      email: "victim@test.com",
      tenantId: "tenant-A",
      roleId: "role-user",
      picture: null,
      role: { id: "role-user", name: "USER" },
      destroy: jest.fn().mockResolvedValue(1),
      ...overrides,
    });

    it("should throw 404 when the user does not exist", async () => {
      Users.findByPk.mockResolvedValue(null);

      const err = await catchErr(
        deleteUser({ userId: "ghost", deletedBy: "admin", actorIsSuperAdmin: true }),
      );

      expect(err).toEqual({ status: 404, message: "User not found" });
    });

    it("should refuse to delete the seeded system account by username", async () => {
      const user = makeUser({ username: "sys", email: "other@mail.com" });
      Users.findByPk.mockResolvedValue(user);

      const err = await catchErr(
        deleteUser({ userId: "u2", deletedBy: "root", actorIsSuperAdmin: true }),
      );

      expect(err).toEqual({
        status: 403,
        message: "The default system administrator account cannot be deleted",
      });
      expect(user.destroy).not.toHaveBeenCalled();
    });

    it("should refuse to delete the seeded system account by email, even for a super-admin", async () => {
      const user = makeUser({ username: "notsys", email: "sys@mail.com" });
      Users.findByPk.mockResolvedValue(user);

      const err = await catchErr(
        deleteUser({ userId: "u2", deletedBy: "root", actorIsSuperAdmin: true }),
      );

      expect(err.status).toBe(403);
      expect(user.destroy).not.toHaveBeenCalled();
    });

    it("should block a non-super-admin from deleting a SUPER_ADMIN by role id", async () => {
      const user = makeUser({ roleId: "super-admin-uuid", role: { name: "Whatever" } });
      Users.findByPk.mockResolvedValue(user);

      const err = await catchErr(
        deleteUser({
          userId: "u2",
          deletedBy: "admin",
          actorIsSuperAdmin: false,
          actorTenantId: "tenant-A",
        }),
      );

      expect(err).toEqual({
        status: 403,
        message: "Forbidden: cannot delete a SUPER_ADMIN account",
      });
      expect(user.destroy).not.toHaveBeenCalled();
    });

    it("should block a non-super-admin from deleting a user whose role is named SUPER_ADMIN", async () => {
      Users.findByPk.mockResolvedValue(makeUser({ role: { name: "SUPER_ADMIN" } }));

      const err = await catchErr(
        deleteUser({
          userId: "u2",
          deletedBy: "admin",
          actorIsSuperAdmin: false,
          actorTenantId: "tenant-A",
        }),
      );

      expect(err.status).toBe(403);
    });

    it("should block a non-super-admin from deleting a user whose role is named SUPERADMIN", async () => {
      Users.findByPk.mockResolvedValue(makeUser({ role: { name: "SUPERADMIN" } }));

      const err = await catchErr(
        deleteUser({
          userId: "u2",
          deletedBy: "admin",
          actorIsSuperAdmin: false,
          actorTenantId: "tenant-A",
        }),
      );

      expect(err.status).toBe(403);
    });

    it("should tolerate a user with no role association", async () => {
      const user = makeUser({ role: null });
      Users.findByPk.mockResolvedValue(user);

      const result = await deleteUser({
        userId: "u2",
        deletedBy: "admin",
        actorIsSuperAdmin: false,
        actorTenantId: "tenant-A",
      });

      expect(result.success).toBe(true);
      expect(user.destroy).toHaveBeenCalled();
    });

    it("should let a super-admin delete a SUPER_ADMIN account", async () => {
      const user = makeUser({ roleId: "super-admin-uuid", role: { name: "SUPER_ADMIN" } });
      Users.findByPk.mockResolvedValue(user);

      const result = await deleteUser({
        userId: "u2",
        deletedBy: "root",
        actorIsSuperAdmin: true,
      });

      expect(user.destroy).toHaveBeenCalled();
      expect(result.data).toEqual({
        id: "u2",
        username: "victim",
        email: "victim@test.com",
      });
    });

    it("should delete the avatar file before destroying the user", async () => {
      const user = makeUser({ picture: "/uploads/profile/mine.png" });
      Users.findByPk.mockResolvedValue(user);

      await deleteUser({ userId: "u2", deletedBy: "admin", actorIsSuperAdmin: true });

      expect(deleteUpload).toHaveBeenCalledWith("mine.png", "uploads/profile");
      expect(user.destroy).toHaveBeenCalled();
    });

    it("should not delete the shared default avatar", async () => {
      const user = makeUser({ picture: "default.svg" });
      Users.findByPk.mockResolvedValue(user);

      await deleteUser({ userId: "u2", deletedBy: "admin", actorIsSuperAdmin: true });

      expect(deleteUpload).not.toHaveBeenCalled();
      expect(user.destroy).toHaveBeenCalled();
    });

    it("should still delete the user when avatar removal fails", async () => {
      const user = makeUser({ picture: "/uploads/profile/mine.png" });
      Users.findByPk.mockResolvedValue(user);
      deleteUpload.mockRejectedValue(new Error("ENOENT"));

      const result = await deleteUser({
        userId: "u2",
        deletedBy: "admin",
        actorIsSuperAdmin: true,
      });

      expect(logger.warn).toHaveBeenCalledWith(
        "Failed to delete user avatar: mine.png",
        expect.any(Error),
      );
      expect(user.destroy).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("should map a destroy failure to a 500", async () => {
      Users.findByPk.mockResolvedValue(
        makeUser({ destroy: jest.fn().mockRejectedValue(new Error("FK constraint")) }),
      );

      const err = await catchErr(
        deleteUser({ userId: "u2", deletedBy: "admin", actorIsSuperAdmin: true }),
      );

      expect(err).toEqual({ status: 500, message: "FK constraint" });
      expect(logger.error).toHaveBeenCalledWith(
        "Error deleting user",
        expect.objectContaining({ err: "FK constraint" }),
      );
    });

    it("should allow deletion when deletedBy is not supplied", async () => {
      const user = makeUser();
      Users.findByPk.mockResolvedValue(user);

      const result = await deleteUser({ userId: "u2", actorIsSuperAdmin: true });

      expect(result.success).toBe(true);
      expect(user.destroy).toHaveBeenCalled();
    });

    it("should preserve a thrown status while defaulting a missing message", async () => {
      Users.findByPk.mockRejectedValue({ status: 418 });

      const err = await catchErr(
        deleteUser({ userId: "u2", deletedBy: "admin", actorIsSuperAdmin: true }),
      );

      expect(err).toEqual({ status: 418, message: "Internal server error" });
    });
  });

  // ==============================================================
  // HOST_URL-derived avatar base URL
  // ==============================================================
  describe("avatarBaseUrl", () => {
    const originalHostUrl = process.env.HOST_URL;

    afterEach(() => {
      if (originalHostUrl === undefined) {
        delete process.env.HOST_URL;
      } else {
        process.env.HOST_URL = originalHostUrl;
      }
    });

    it("should prefix the avatar base URL with HOST_URL when it is set", async () => {
      process.env.HOST_URL = "https://cdn.example.com";
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      const result = await fetchUsers({ tenantId: "t1" });

      expect(result.data.avatarBaseUrl).toBe(
        "https://cdn.example.com/uploads/profile/",
      );
    });

    it("should fall back to a relative avatar base URL when HOST_URL is unset", async () => {
      delete process.env.HOST_URL;
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      const result = await fetchUsers({ tenantId: "t1" });

      expect(result.data.avatarBaseUrl).toBe("/uploads/profile/");
    });

    it("should shape fetchSpecificUser with the HOST_URL-derived picture fields", async () => {
      process.env.HOST_URL = "https://cdn.example.com";
      Users.findByPk.mockResolvedValue({
        get: () => ({ id: "u1", username: "test" }),
        picture: "me.png",
        first_name: "Te",
        last_name: "St",
      });

      const result = await fetchSpecificUser("u1");

      expect(result.data).toEqual({
        id: "u1",
        username: "test",
        avatarUrl: "me.png",
        picture: "me.png",
        first_name: "Te",
        last_name: "St",
      });
    });
  });

  // ==============================================================
  // Error-shape fallbacks ({ status } with no message, missing transaction)
  // ==============================================================
  describe("error shape fallbacks", () => {
    it("checkUsernameAvailability should default a missing message", async () => {
      Users.findOne.mockRejectedValue({ status: 400 });

      const err = await catchErr(checkUsernameAvailability({ username: "x" }));

      expect(err).toEqual({ status: 400, message: "Internal server error" });
    });

    it("userRoleUpdate should not roll back when the transaction never opened", async () => {
      db.transaction.mockRejectedValue(new Error("pool exhausted"));

      const err = await catchErr(
        userRoleUpdate({ userId: "u1", roleId: "r1", actorIsSuperAdmin: true }),
      );

      expect(err).toEqual({ status: 500, message: "pool exhausted" });
    });

    it("userRoleUpdate should default a missing message", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      Users.findByPk.mockRejectedValue({ status: 409 });

      const err = await catchErr(
        userRoleUpdate({ userId: "u1", roleId: "r1", actorIsSuperAdmin: true }),
      );

      expect(err).toEqual({ status: 409, message: "Internal server error" });
    });

    it("userCreate should not roll back when the transaction never opened", async () => {
      db.transaction.mockRejectedValue(new Error("pool exhausted"));

      const err = await catchErr(
        userCreate({
          username: "u",
          email: "e@e.com",
          password: "p",
          roleId: "r1",
          actorIsSuperAdmin: true,
        }),
      );

      expect(err).toEqual({ status: 500, message: "pool exhausted" });
    });

    it("userCreate should default a missing message", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      Users.findOne.mockRejectedValue({ status: 409 });

      const err = await catchErr(
        userCreate({
          username: "u",
          email: "e@e.com",
          password: "p",
          roleId: "r1",
          actorIsSuperAdmin: true,
        }),
      );

      expect(err).toEqual({ status: 409, message: "Internal server error" });
    });

    it("editUser should not roll back when the transaction never opened", async () => {
      db.transaction.mockRejectedValue(new Error("pool exhausted"));

      const err = await catchErr(editUser({ userId: "u1", actorIsSuperAdmin: true }));

      expect(err).toEqual({ status: 500, message: "pool exhausted" });
    });

    it("editUser should default a missing message", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      Users.findByPk.mockRejectedValue({ status: 418 });

      const err = await catchErr(editUser({ userId: "u1", actorIsSuperAdmin: true }));

      expect(err).toEqual({ status: 418, message: "Internal server error" });
    });

    it("fetchUsers should default page and limit when they are omitted", async () => {
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      const result = await fetchUsers({ tenantId: "t1" });

      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20); // DEFAULT_LIMIT
      expect(result.meta.hasPrevPage).toBe(false);
      expect(result.meta.hasNextPage).toBe(false);
    });

    it("fetchSpecificUser should fall back to a relative avatar base URL when HOST_URL is unset", async () => {
      const original = process.env.HOST_URL;
      delete process.env.HOST_URL;
      Users.findByPk.mockResolvedValue({
        get: () => ({ id: "u1" }),
        picture: null,
      });

      const result = await fetchSpecificUser("u1");

      expect(result.success).toBe(true);
      expect(result.data.avatarUrl).toBeNull();

      if (original !== undefined) {
        process.env.HOST_URL = original;
      }
    });

    it("userRoleUpdate should tolerate being called with no input at all", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      Users.findByPk.mockResolvedValue(null);

      const err = await catchErr(userRoleUpdate());

      expect(err).toEqual({ status: 404, message: "User not found" });
    });

    it("editUser should tolerate being called with no input at all", async () => {
      db.transaction.mockResolvedValue(mockTransaction());
      Users.findByPk.mockResolvedValue(null);

      const err = await catchErr(editUser());

      expect(err).toEqual({ status: 404, message: "User not found" });
    });

    it("userCreate should tolerate being called with no input at all", async () => {
      db.transaction.mockResolvedValue(mockTransaction());

      const err = await catchErr(userCreate());

      // No username to trim -> the guard clause fails and is mapped to a 500
      expect(err.status).toBe(500);
      expect(Users.create).not.toHaveBeenCalled();
    });

    it("fetchUsers should coerce a non-numeric page to 1 in the meta block", async () => {
      Users.findAndCountAll.mockResolvedValue({ rows: [], count: 100 });

      const result = await fetchUsers({ tenantId: "t1", page: "abc", limit: 10 });

      expect(result.meta.page).toBe(1);
      expect(result.meta.hasNextPage).toBe(true);
      expect(result.meta.hasPrevPage).toBe(false);
    });
  });
});
