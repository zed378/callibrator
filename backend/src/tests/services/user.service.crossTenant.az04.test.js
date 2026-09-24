/**
 * AZ-04 (user.service instance) — cross-tenant must be indistinguishable from
 * not-found.
 *
 * CLAUDE.md: "Cross-tenant returns 404, never 403. [...] Non-existent,
 * soft-deleted and not-yours must be indistinguishable."
 *
 * `userRoleUpdate`, `editUser` and `deleteUser` each looked a user up, threw
 * 404 "User not found" when it was missing and 403 "Access denied: resource
 * belongs to a different tenant" when it belonged to someone else — a
 * tenant-membership oracle on the user id. The global tenant hooks already
 * return `null` for a foreign user on the HTTP path, so the 403 branch was
 * latent rather than live; it would have leaked the moment anyone added
 * `.unscoped()` / `skipTenantScope` or called the service outside a request
 * context. These tests pin the byte-identical outcome at all three sites by
 * mocking the lookup to return the foreign row (the "hooks bypassed" case).
 */

jest.mock("sequelize", () => ({
  Sequelize: { fn: jest.fn(), col: jest.fn() },
  Op: {
    ne: Symbol("ne"),
    like: Symbol("like"),
    or: Symbol("or"),
    notIn: Symbol("notIn"),
  },
}));

jest.mock("../../config", () => ({ db: { transaction: jest.fn() } }));

jest.mock("../../models", () => ({
  Users: { findByPk: jest.fn(), findOne: jest.fn() },
  Roles: { findByPk: jest.fn() },
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock("../../utils/password.util", () => ({ hashPassword: jest.fn() }));
jest.mock("../../utils/upload.util", () => ({
  deleteUpload: jest.fn(),
  getUploadUrl: jest.fn(),
}));

jest.mock("../../constants", () => ({
  SUPER_ADMIN_ROLE_ID: "super-admin-uuid",
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
}));

jest.mock("../../validators/user.validator", () => ({
  validate: jest.fn((data) => ({ value: { ...data }, error: null })),
  formatErrors: jest.fn((d) => d),
  createUserSchema: "createUserSchema",
  updateUserSchema: "updateUserSchema",
  updateRoleSchema: "updateRoleSchema",
  checkUsernameSchema: "checkUsernameSchema",
}));

const { db } = require("../../config");
const { Users, Roles } = require("../../models");
const { logger } = require("../../middlewares/activityLog.middleware");
const {
  userRoleUpdate,
  editUser,
  deleteUser,
} = require("../../services/user.service");

const ACTOR = { actorIsSuperAdmin: false, actorTenantId: "tenant-A" };

const foreignUser = (overrides = {}) => ({
  id: "u-foreign",
  username: "victim",
  email: "victim@b.example",
  tenantId: "tenant-B",
  roleId: "role-user",
  role: { id: "role-user", name: "USER" },
  update: jest.fn(),
  destroy: jest.fn(),
  get: () => ({ id: "u-foreign" }),
  ...overrides,
});

/** Run `call` and return whatever it rejected with (fail if it resolved). */
const rejectionOf = async (call) => {
  try {
    await call();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to reject");
};

/**
 * The three sites. `run` performs the call; `userId` is what the caller asked
 * for, so the "missing" and "foreign" cases use the same id.
 */
const SITES = [
  {
    name: "userRoleUpdate",
    run: () =>
      userRoleUpdate({
        userId: "u-foreign",
        roleId: "role-x",
        updatedBy: "actor",
        ...ACTOR,
      }),
  },
  {
    name: "editUser",
    run: () =>
      editUser({
        userId: "u-foreign",
        firstName: "Changed",
        updatedBy: "actor",
        ...ACTOR,
      }),
  },
  {
    name: "deleteUser",
    run: () =>
      deleteUser({ userId: "u-foreign", deletedBy: "actor", ...ACTOR }),
  },
];

describe("user.service — AZ-04 cross-tenant is indistinguishable from not-found", () => {
  let tx;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = { commit: jest.fn(), rollback: jest.fn() };
    db.transaction.mockResolvedValue(tx);
  });

  describe.each(SITES)("$name", ({ name, run }) => {
    it("a foreign user and a nonexistent user produce byte-identical errors", async () => {
      Users.findByPk.mockResolvedValueOnce(null);
      const missing = await rejectionOf(run);

      Users.findByPk.mockResolvedValueOnce(foreignUser());
      const foreign = await rejectionOf(run);

      expect(missing).toEqual({ status: 404, message: "User not found" });
      expect(foreign).toEqual(missing);
      expect(JSON.stringify(foreign)).toBe(JSON.stringify(missing));
      // Same keys, same order, nothing extra riding along.
      expect(Object.keys(foreign)).toEqual(Object.keys(missing));
    });

    it("logs the cross-tenant reason server-side, and only there", async () => {
      Users.findByPk.mockResolvedValueOnce(foreignUser());
      const err = await rejectionOf(run);

      expect(JSON.stringify(err)).not.toMatch(/tenant/i);
      expect(logger.warn).toHaveBeenCalledWith(
        "user.service: cross-tenant user access refused",
        expect.objectContaining({
          reason: "cross-tenant",
          operation: name,
          userId: "u-foreign",
          userTenantId: "tenant-B",
          actorTenantId: "tenant-A",
        }),
      );
    });

    it("never acts on the foreign row", async () => {
      const victim = foreignUser();
      Users.findByPk.mockResolvedValueOnce(victim);
      await rejectionOf(run);

      expect(victim.update).not.toHaveBeenCalled();
      expect(victim.destroy).not.toHaveBeenCalled();
      expect(Roles.findByPk).not.toHaveBeenCalled();
      expect(tx.commit).not.toHaveBeenCalled();
    });
  });

  it("deleteUser: a foreign seeded system account is a 404, not a 403 that confirms it exists", async () => {
    // The system-account guard ran BEFORE the tenant check, so a tenant admin
    // probing another tenant's system account got "cannot be deleted" (403) —
    // confirming the id. The tenant check now runs first.
    Users.findByPk.mockResolvedValueOnce(
      foreignUser({ username: "sys", email: "sys@mail.com" }),
    );
    const err = await rejectionOf(() =>
      deleteUser({ userId: "u-foreign", deletedBy: "actor", ...ACTOR }),
    );

    expect(err).toEqual({ status: 404, message: "User not found" });
  });

  it("deleteUser: a super-admin is still refused the system account with the explicit 403", async () => {
    Users.findByPk.mockResolvedValueOnce(
      foreignUser({ username: "sys", email: "sys@mail.com" }),
    );
    const err = await rejectionOf(() =>
      deleteUser({
        userId: "u-foreign",
        deletedBy: "actor",
        actorIsSuperAdmin: true,
        actorTenantId: null,
      }),
    );

    expect(err).toEqual({
      status: 403,
      message: "The default system administrator account cannot be deleted",
    });
  });
});
