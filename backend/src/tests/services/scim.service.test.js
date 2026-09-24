const { Op } = require("sequelize");

jest.mock("../../models", () => ({
  Users: {
    findOne: jest.fn(),
    findAndCountAll: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },
  Role: {
    findOne: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },
}));

// Mirrors the real src/utils/password.util.js surface:
//   hashPassword(password) -> Promise<string>, comparePassword(plain, hash) -> Promise<bool>
jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn().mockResolvedValue("hashed:mock"),
  comparePassword: jest.fn().mockResolvedValue(true),
}));

const scim = require("../../services/scim.service");
const { Users, Role } = require("../../models");
const { hashPassword } = require("../../utils/password.util");
const { ROLE_IDS } = require("../../constants");

describe("scim.service", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getUsers", () => {
    // assertAssignableRole (A-27) looks the role up; default to an ordinary,
    // non-system role so existing cases exercise the happy path.
    Role.findOne.mockResolvedValue({ id: "r-user", name: "USER", isSystem: false });
    it("returns paginated list with default pagination and filter=null", async () => {
      Users.findAndCountAll.mockResolvedValue({
        count: 1,
        rows: [
          {
            id: "u1",
            email: "a@b.com",
            firstName: "A",
            lastName: "B",
            isActive: true,
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });
      const result = await scim.getUsers("t1");
      expect(result.totalResults).toBe(1);
      expect(result.Resources[0].userName).toBe("a@b.com");
    });

    it("filters by active=true", async () => {
      Users.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
      await scim.getUsers("t1", 1, 10, "active eq true");
      expect(Users.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
            status: "ACTIVE",
          }),
        })
      );
    });

    it("filters by active=false", async () => {
      Users.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
      await scim.getUsers("t1", 1, 10, "active eq false");
      expect(Users.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: false,
            status: "SUSPENDED",
          }),
        })
      );
    });

    it("filters by email", async () => {
      Users.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
      await scim.getUsers("t1", 1, 10, 'email eq "a@b.com"');
      expect(Users.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            email: "a@b.com",
          }),
        })
      );
    });
  });

  describe("getUserById", () => {
    it("returns user details", async () => {
      Users.findOne.mockResolvedValue({
        id: "u1",
        email: "a@b.com",
        firstName: "A",
        lastName: "B",
        isActive: true,
        status: "ACTIVE",
      });
      const result = await scim.getUserById("t1", "u1");
      expect(result.id).toBe("u1");
    });

    it("throws 404 when user not found", async () => {
      Users.findOne.mockResolvedValue(null);
      await expect(scim.getUserById("t1", "u1")).rejects.toThrow("User not found");
    });
  });

  describe("createUser", () => {
    it("creates a new user successfully", async () => {
      Users.findOne.mockResolvedValue(null);
      Users.create.mockResolvedValue({
        id: "u1",
        email: "a@b.com",
        firstName: "A",
        lastName: "B",
        isActive: true,
        status: "ACTIVE",
      });

      const result = await scim.createUser("t1", {
        userName: "a@b.com",
        name: { givenName: "A", familyName: "B" },
      });
      expect(result.userName).toBe("a@b.com");
    });

    it("throws 400 when email or userName is missing", async () => {
      await expect(scim.createUser("t1", {})).rejects.toThrow("Email/userName is required");
    });

    it("throws 409 when user already exists", async () => {
      Users.findOne.mockResolvedValue({ id: "u1" });
      await expect(
        scim.createUser("t1", { userName: "existing@test.com" })
      ).rejects.toThrow("User already exists in the system");
    });

    it("D-06: stores the address lowercased and trimmed, and checks for it lowercased", async () => {
      Users.findOne.mockResolvedValue(null);
      Users.create.mockImplementation(async (v) => ({ ...v, id: "u1" }));

      await scim.createUser("t1", { emails: [{ value: "  Ada.Lovelace@Hospital-B.ORG " }] });

      expect(Users.findOne).toHaveBeenCalledWith({ where: { email: "ada.lovelace@hospital-b.org" } });
      expect(Users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "ada.lovelace@hospital-b.org",
          username: "ada.lovelace@hospital-b.org",
        }),
      );
    });

    it("prefers the primary emails[0].value over userName", async () => {
      Users.findOne.mockResolvedValue(null);
      Users.create.mockImplementation(async (v) => ({ ...v, id: "u1" }));

      await scim.createUser("t1", {
        userName: "login-name",
        emails: [{ value: "from-emails@test.com", primary: true }],
      });

      expect(Users.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: "from-emails@test.com", username: "from-emails@test.com" })
      );
    });

    it("falls back to userName when the emails array is empty", async () => {
      Users.findOne.mockResolvedValue(null);
      Users.create.mockImplementation(async (v) => ({ ...v, id: "u1" }));

      await scim.createUser("t1", { userName: "a@b.com", emails: [] });

      expect(Users.create).toHaveBeenCalledWith(expect.objectContaining({ email: "a@b.com" }));
    });

    it("defaults the name to SCIM User and the role to ROLE_IDS.USER", async () => {
      Users.findOne.mockResolvedValue(null);
      Users.create.mockImplementation(async (v) => ({ ...v, id: "u1" }));

      await scim.createUser("t1", { userName: "a@b.com" });

      expect(Users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: "SCIM",
          lastName: "User",
          roleId: ROLE_IDS.USER,
          isActive: true,
          status: "ACTIVE",
          isEmailVerified: true,
        })
      );
    });

    it("provisions a suspended user when active is false", async () => {
      Users.findOne.mockResolvedValue(null);
      Users.create.mockImplementation(async (v) => ({ ...v, id: "u1" }));

      const result = await scim.createUser("t1", { userName: "a@b.com", active: false, roleId: "r9" });

      expect(Users.create).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false, status: "SUSPENDED", roleId: "r9" })
      );
      expect(result.active).toBe(false);
    });

    it("stores a hashed password, never a plaintext one", async () => {
      Users.findOne.mockResolvedValue(null);
      Users.create.mockImplementation(async (v) => ({ ...v, id: "u1" }));

      await scim.createUser("t1", { userName: "a@b.com" });

      const { password } = Users.create.mock.calls[0][0];
      expect(password).toBe("hashed:mock");
      expect(hashPassword).toHaveBeenCalledWith(expect.any(String));
      expect(hashPassword.mock.calls[0][0]).toHaveLength(32);
    });
  });

  describe("updateUser", () => {
    it("updates user details", async () => {
      const mockUpdate = jest.fn();
      Users.findOne.mockResolvedValue({
        id: "u1",
        firstName: "A",
        lastName: "B",
        isActive: true,
        status: "ACTIVE",
        update: mockUpdate,
      });

      await scim.updateUser("t1", "u1", {
        name: { givenName: "NewFirst", familyName: "NewLast" },
        roleId: 2,
        active: false,
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        firstName: "NewFirst",
        lastName: "NewLast",
        roleId: 2,
        isActive: false,
        status: "SUSPENDED",
      });
    });

    it("throws 404 when user to update not found", async () => {
      Users.findOne.mockResolvedValue(null);
      await expect(scim.updateUser("t1", "u1", {})).rejects.toThrow("User not found");
    });

    it("applies no updates when the payload carries no recognised fields", async () => {
      const mockUpdate = jest.fn();
      Users.findOne.mockResolvedValue({ id: "u1", update: mockUpdate });

      await scim.updateUser("t1", "u1", {});

      expect(mockUpdate).toHaveBeenCalledWith({});
    });

    it("ignores a name object with neither givenName nor familyName", async () => {
      const mockUpdate = jest.fn();
      Users.findOne.mockResolvedValue({ id: "u1", update: mockUpdate });

      await scim.updateUser("t1", "u1", { name: {}, roleId: null, active: "yes" });

      expect(mockUpdate).toHaveBeenCalledWith({});
    });

    it("reactivates a user when active is true", async () => {
      const mockUpdate = jest.fn();
      Users.findOne.mockResolvedValue({ id: "u1", update: mockUpdate });

      await scim.updateUser("t1", "u1", { active: true });

      expect(mockUpdate).toHaveBeenCalledWith({ isActive: true, status: "ACTIVE" });
    });

    it("scopes the lookup to the tenant", async () => {
      Users.findOne.mockResolvedValue({ id: "u1", update: jest.fn() });
      await scim.updateUser("t1", "u1", {});
      expect(Users.findOne).toHaveBeenCalledWith({ where: { id: "u1", tenantId: "t1" } });
    });
  });

  describe("patchUser", () => {
    it("applies patch operations for replace, add, and remove", async () => {
      const mockUpdate = jest.fn();
      Users.findOne.mockResolvedValue({
        id: "u1",
        firstName: "A",
        lastName: "B",
        isActive: true,
        status: "ACTIVE",
        update: mockUpdate,
      });

      const patchOps = [
        { op: "replace", value: { name: { givenName: "X", familyName: "Y" }, active: false, roleId: "33333333-3333-4333-8333-333333333333" } },
        { op: "add", value: { roleId: "44444444-4444-4444-8444-444444444444" } },
        { op: "remove", path: "roleId" },
      ];

      await scim.patchUser("t1", "u1", patchOps);

      expect(mockUpdate).toHaveBeenCalled();
    });

    it("handles partial name replacements in the value-object form", async () => {
      const mockUpdate = jest.fn();
      Users.findOne.mockResolvedValue({
        id: "u1",
        update: mockUpdate,
      });

      await scim.patchUser("t1", "u1", [
        { op: "replace", value: { name: { givenName: "X" } } },
        { op: "replace", value: { name: { familyName: "Y" } } },
      ]);

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledWith({
        firstName: "X",
        lastName: "Y",
      });
    });

    it("throws 404 when user to patch not found", async () => {
      Users.findOne.mockResolvedValue(null);
      await expect(scim.patchUser("t1", "u1", [])).rejects.toThrow("User not found");
    });

    it("reactivates via replace active=true", async () => {
      const mockUpdate = jest.fn();
      Users.findOne.mockResolvedValue({ id: "u1", update: mockUpdate });

      await scim.patchUser("t1", "u1", [{ op: "replace", value: { active: true } }]);

      expect(mockUpdate).toHaveBeenCalledWith({ isActive: true, status: "ACTIVE" });
    });

    it("ignores unknown keys inside the value-object form", async () => {
      const mockUpdate = jest.fn();
      Users.findOne.mockResolvedValue({ id: "u1", update: mockUpdate });

      await scim.patchUser("t1", "u1", [
        { op: "replace", value: { unknownKey: "x" } },
        { op: "add", value: { unknownKey: "x" } },
      ]);

      expect(mockUpdate).toHaveBeenCalledWith({});
    });

    it("resets roleId to the default role on remove", async () => {
      const mockUpdate = jest.fn();
      Users.findOne.mockResolvedValue({ id: "u1", update: mockUpdate });

      await scim.patchUser("t1", "u1", [{ op: "remove", path: "roleId" }]);

      expect(mockUpdate).toHaveBeenCalledWith({ roleId: ROLE_IDS.USER });
    });

    it("sets roleId via an add op", async () => {
      const mockUpdate = jest.fn();
      Users.findOne.mockResolvedValue({ id: "u1", update: mockUpdate });

      await scim.patchUser("t1", "u1", [{ op: "add", value: { roleId: "77777777-7777-4777-8777-777777777777" } }]);

      expect(mockUpdate).toHaveBeenCalledWith({ roleId: "77777777-7777-4777-8777-777777777777" });
    });
  });

  describe("deleteUser", () => {
    it("deletes user successfully", async () => {
      const mockDestroy = jest.fn();
      Users.findOne.mockResolvedValue({
        id: "u1",
        destroy: mockDestroy,
      });

      const result = await scim.deleteUser("t1", "u1");
      expect(result.status).toBe(204);
      expect(mockDestroy).toHaveBeenCalled();
    });

    it("throws 404 when user to delete not found", async () => {
      Users.findOne.mockResolvedValue(null);
      await expect(scim.deleteUser("t1", "u1")).rejects.toThrow("User not found");
    });
  });

});

// ==========================================================================
// A-27 — SCIM must never hand out privileged roles, and must not touch system
// roles. Before 2026-09-23 a caller could name the committed SUPERADMIN role id
// and take over the platform.
// ==========================================================================
describe("scim.service — privileged role guards (A-27)", () => {
  const SUPERADMIN_ID = "9be20605-cc6a-4d91-8246-9756b4a1754b";

  beforeEach(() => {
    jest.clearAllMocks();
    Role.findOne.mockResolvedValue({ id: "r-user", name: "USER", isSystem: false });
  });

  it("refuses to create a user with the SUPERADMIN role", async () => {
    Users.findOne.mockResolvedValue(null);
    await expect(
      scim.createUser("t1", { userName: "a@b.c", roleId: SUPERADMIN_ID }),
    ).rejects.toMatchObject({ status: 403 });
    expect(Users.create).not.toHaveBeenCalled();
  });

  it("refuses to update a user into the SUPERADMIN role", async () => {
    Users.findOne.mockResolvedValue({ id: "u1", update: jest.fn() });
    await expect(
      scim.updateUser("t1", "u1", { roleId: SUPERADMIN_ID }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses to patch a user into the SUPERADMIN role", async () => {
    const update = jest.fn();
    Users.findOne.mockResolvedValue({ id: "u1", update });
    await expect(
      // The legacy value-object form. The SCIM-standard path form is covered
      // by the A-33 block below and is refused the same way.
      scim.patchUser("t1", "u1", [{ op: "replace", value: { roleId: SUPERADMIN_ID } }]),
    ).rejects.toMatchObject({ status: 403 });
    expect(update).not.toHaveBeenCalled();
  });

  // The constant is not the only way to name the platform role: a row that is
  // flagged isSystem and named SUPERADMIN is refused whatever its id.
  it("refuses a system role named SUPERADMIN under a different id", async () => {
    Users.findOne.mockResolvedValue(null);
    Role.findOne.mockResolvedValue({ id: "r-other", name: "superadmin", isSystem: true });
    await expect(
      scim.createUser("t1", { userName: "a@b.c", roleId: "22222222-2222-2222-2222-222222222222" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(Users.create).not.toHaveBeenCalled();
  });

  it("refuses an unknown roleId", async () => {
    Users.findOne.mockResolvedValue(null);
    Role.findOne.mockResolvedValue(null);
    await expect(
      scim.createUser("t1", { userName: "a@b.c", roleId: "11111111-1111-1111-1111-111111111111" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ==========================================================================
// A-33 — RFC 7644 § 3.5.2 `path` handling, and RFC 7644 § 3.4.2.2 filters.
//
// Before 2026-09-23 both patch handlers read only `op.value`, as an object, and
// never looked at `op.path`. `{ "op": "replace", "path": "active", "value":
// false }` — the form Okta, Entra ID and OneLogin all send to deprovision —
// made `Object.entries(false)` === [], so the endpoint answered 200 with the
// user unchanged. GET /Users dropped a `userName eq` filter the same way and
// returned the whole tenant.
//
// These cases assert BEHAVIOUR (what the row becomes, what comes back), not the
// shape of the implementation.
// ==========================================================================
describe("scim.service — RFC 7644 patch paths and filters (A-33)", () => {
  const SUPERADMIN_ID = ROLE_IDS.SUPER_ADMIN;

  let update;

  beforeEach(() => {
    jest.clearAllMocks();
    update = jest.fn();
    Users.findOne.mockResolvedValue({ id: "u1", update });
    Users.findAll.mockResolvedValue([]);
    Users.update.mockResolvedValue([1]);
    Role.findOne.mockResolvedValue({ id: "r-user", name: "USER", isSystem: false });
  });

  describe("patchUser — path form", () => {
    it("deactivates the user given the standard IdP deprovision operation", async () => {
      await scim.patchUser("t1", "u1", [{ op: "replace", path: "active", value: false }]);

      expect(update).toHaveBeenCalledWith({ isActive: false, status: "SUSPENDED" });
    });

    it("reactivates the user given path active=true", async () => {
      await scim.patchUser("t1", "u1", [{ op: "replace", path: "active", value: true }]);

      expect(update).toHaveBeenCalledWith({ isActive: true, status: "ACTIVE" });
    });

    it("accepts the string booleans Entra ID sends", async () => {
      await scim.patchUser("t1", "u1", [{ op: "replace", path: "active", value: "False" }]);

      expect(update).toHaveBeenCalledWith({ isActive: false, status: "SUSPENDED" });
    });

    it("accepts the string \"true\" as a reactivation", async () => {
      await scim.patchUser("t1", "u1", [{ op: "replace", path: "active", value: "True" }]);

      expect(update).toHaveBeenCalledWith({ isActive: true, status: "ACTIVE" });
    });

    it.each([
      ["an unrecognised string", "maybe"],
      ["a number", 1],
    ])("rejects %s as an active value with 400", async (_label, value) => {
      await expect(
        scim.patchUser("t1", "u1", [{ op: "replace", path: "active", value }]),
      ).rejects.toMatchObject({ status: 400 });
      expect(update).not.toHaveBeenCalled();
    });

    it("resolves a path carrying the core User schema URN", async () => {
      await scim.patchUser("t1", "u1", [
        { op: "replace", path: "urn:ietf:params:scim:schemas:core:2.0:User:active", value: false },
      ]);

      expect(update).toHaveBeenCalledWith({ isActive: false, status: "SUSPENDED" });
    });

    it("matches attribute names case-insensitively, as RFC 7643 requires", async () => {
      await scim.patchUser("t1", "u1", [{ op: "replace", path: "Name.GivenName", value: "Ada" }]);

      expect(update).toHaveBeenCalledWith({ firstName: "Ada" });
    });

    it("renames via name.familyName", async () => {
      await scim.patchUser("t1", "u1", [{ op: "replace", path: "name.familyName", value: "Lovelace" }]);

      expect(update).toHaveBeenCalledWith({ lastName: "Lovelace" });
    });

    it("D-06: a userName patch is stored lowercased in both columns", async () => {
      await scim.patchUser("t1", "u1", [{ op: "replace", path: "userName", value: "New@B.COM" }]);

      expect(update).toHaveBeenCalledWith({ email: "new@b.com", username: "new@b.com" });
    });

    it("writes userName to both email and username, as createUser does", async () => {
      await scim.patchUser("t1", "u1", [{ op: "replace", path: "userName", value: " new@b.com " }]);

      expect(update).toHaveBeenCalledWith({ email: "new@b.com", username: "new@b.com" });
    });

    it("rejects an empty string value with 400", async () => {
      await expect(
        scim.patchUser("t1", "u1", [{ op: "replace", path: "userName", value: "   " }]),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects a non-string value where a string is required with 400", async () => {
      await expect(
        scim.patchUser("t1", "u1", [{ op: "replace", path: "name.givenName", value: 7 }]),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("assigns a role via the path form", async () => {
      await scim.patchUser("t1", "u1", [{ op: "add", path: "roleId", value: "77777777-7777-4777-8777-777777777777" }]);

      expect(update).toHaveBeenCalledWith({ roleId: "77777777-7777-4777-8777-777777777777" });
    });

    // The point of the whole exercise: the new code path must not be a second
    // way into a privileged role.
    it("refuses a path-form roleId naming SUPERADMIN with 403 and writes nothing", async () => {
      await expect(
        scim.patchUser("t1", "u1", [{ op: "replace", path: "roleId", value: SUPERADMIN_ID }]),
      ).rejects.toMatchObject({ status: 403 });
      expect(update).not.toHaveBeenCalled();
    });

    it("refuses a path-form roleId naming a system role called SUPERADMIN under another id", async () => {
      Role.findOne.mockResolvedValue({ id: "r-other", name: "superadmin", isSystem: true });

      await expect(
        scim.patchUser("t1", "u1", [{ op: "add", path: "roleId", value: "88888888-8888-4888-8888-888888888888" }]),
      ).rejects.toMatchObject({ status: 403 });
      expect(update).not.toHaveBeenCalled();
    });

    it("refuses a path-form roleId that names no role with 400", async () => {
      Role.findOne.mockResolvedValue(null);

      await expect(
        scim.patchUser("t1", "u1", [{ op: "replace", path: "roleId", value: "99999999-9999-4999-8999-999999999999" }]),
      ).rejects.toMatchObject({ status: 400 });
      expect(update).not.toHaveBeenCalled();
    });

    it("rejects an unsupported path with 400 rather than ignoring it", async () => {
      await expect(
        scim.patchUser("t1", "u1", [
          { op: "replace", path: 'emails[type eq "work"].value', value: "x@y.z" },
        ]),
      ).rejects.toMatchObject({ status: 400 });
      expect(update).not.toHaveBeenCalled();
    });

    it("rejects a non-string path with 400", async () => {
      await expect(
        scim.patchUser("t1", "u1", [{ op: "replace", path: ["roleId"], value: "77777777-7777-4777-8777-777777777777" }]),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects an operation with neither a path nor an object value", async () => {
      await expect(
        scim.patchUser("t1", "u1", [{ op: "replace", value: false }]),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects an array value with no path", async () => {
      await expect(
        scim.patchUser("t1", "u1", [{ op: "add", value: ["x"] }]),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects an unrecognised op with 400", async () => {
      await expect(
        scim.patchUser("t1", "u1", [{ value: { active: false } }]),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("patchUser — remove", () => {
    it("requires a path, because RFC 7644 does", async () => {
      await expect(
        scim.patchUser("t1", "u1", [{ op: "remove" }]),
      ).rejects.toMatchObject({ status: 400 });
      expect(update).not.toHaveBeenCalled();
    });

    it("rejects removing an attribute it cannot clear, rather than pretending to", async () => {
      await expect(
        scim.patchUser("t1", "u1", [{ op: "remove", path: "active" }]),
      ).rejects.toMatchObject({ status: 400 });
      expect(update).not.toHaveBeenCalled();
    });

    it("rejects removing an unsupported path with 400", async () => {
      await expect(
        scim.patchUser("t1", "u1", [{ op: "remove", path: "emails" }]),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("getUsers — filter", () => {
    beforeEach(() => {
      Users.findAndCountAll.mockResolvedValue({
        count: 1,
        rows: [
          {
            id: "u1",
            email: "ada@b.com",
            firstName: "Ada",
            lastName: "L",
            isActive: true,
            status: "ACTIVE",
          },
        ],
      });
    });

    // The Okta/Entra "does this user already exist?" probe. It used to return
    // the whole tenant.
    it("narrows to one user on a userName eq filter", async () => {
      const result = await scim.getUsers("t1", 1, 100, 'userName eq "ada@b.com"');

      // A-49: userName matches the username column as well as the email — a
      // user whose username differs from their address was unfindable.
      expect(Users.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: "t1", [Op.or]: [{ email: "ada@b.com" }, { username: "ada@b.com" }] },
        }),
      );
      expect(result.totalResults).toBe(1);
      expect(result.Resources).toHaveLength(1);
      expect(result.Resources[0].userName).toBe("ada@b.com");
    });

    it("D-06: an email filter matches the stored (lowercased) address whatever case the IdP sends", async () => {
      await scim.getUsers("t1", 1, 100, 'emails.value eq "Ada@B.com"');
      expect(Users.findAndCountAll).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { tenantId: "t1", email: "ada@b.com" } }),
      );

      await scim.getUsers("t1", 1, 100, 'userName eq "Ada@B.com"');
      expect(Users.findAndCountAll).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { tenantId: "t1", [Op.or]: [{ email: "ada@b.com" }, { username: "Ada@B.com" }] },
        }),
      );
    });

    it("accepts the emails.value spelling", async () => {
      await scim.getUsers("t1", 1, 100, 'emails.value eq "ada@b.com"');

      expect(Users.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: "t1", email: "ada@b.com" } }),
      );
    });

    it("accepts a quoted active value", async () => {
      await scim.getUsers("t1", 1, 100, 'active eq "false"');

      expect(Users.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: "t1", isActive: false, status: "SUSPENDED" },
        }),
      );
    });

    it("combines terms joined by and", async () => {
      await scim.getUsers("t1", 1, 100, 'userName eq "ada@b.com" and active eq true');

      expect(Users.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: "t1",
            [Op.or]: [{ email: "ada@b.com" }, { username: "ada@b.com" }],
            isActive: true,
            status: "ACTIVE",
          },
        }),
      );
    });

    // Returning everything to a client that asked a narrow question is the bug;
    // RFC 7644 § 3.4.2.2 calls for an invalidFilter 400.
    it("rejects an unsupported filter with 400 instead of returning the tenant", async () => {
      await expect(
        scim.getUsers("t1", 1, 100, 'userName sw "ada"'),
      ).rejects.toMatchObject({ status: 400 });
      expect(Users.findAndCountAll).not.toHaveBeenCalled();
    });

    it("rejects an unsupported term inside an and-filter", async () => {
      await expect(
        scim.getUsers("t1", 1, 100, 'userName eq "ada@b.com" and title eq "x"'),
      ).rejects.toMatchObject({ status: 400 });
      expect(Users.findAndCountAll).not.toHaveBeenCalled();
    });
  });
});
