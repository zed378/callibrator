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
        { op: "replace", value: { name: { givenName: "X", familyName: "Y" }, active: false, roleId: 3 } },
        { op: "add", value: { roleId: 4 } },
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

      await scim.patchUser("t1", "u1", [{ op: "add", value: { roleId: "r7" } }]);

      expect(mockUpdate).toHaveBeenCalledWith({ roleId: "r7" });
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

  describe("Groups", () => {
    describe("getGroups", () => {
      it("returns groups with displayName filter", async () => {
        Role.findAndCountAll.mockResolvedValue({
          count: 1,
          rows: [{ id: "g1", name: "ADMIN", createdAt: new Date(), updatedAt: new Date() }],
        });
        Users.findAll.mockResolvedValue([]);

        const result = await scim.getGroups("t1", 1, 10, 'displayName eq "ADMIN"');
        expect(result.totalResults).toBe(1);
        expect(result.Resources[0].displayName).toBe("ADMIN");
        expect(Role.findAndCountAll).toHaveBeenCalledWith(
          expect.objectContaining({ where: { name: "ADMIN" } })
        );
      });

      it("queries roles unfiltered with default paging when no filter is given", async () => {
        Role.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

        const result = await scim.getGroups("t1");

        expect(Role.findAndCountAll).toHaveBeenCalledWith({
          where: {},
          offset: 0,
          limit: 100,
        });
        expect(result.startIndex).toBe(1);
        expect(result.itemsPerPage).toBe(0);
      });

      it("ignores a filter that does not match the displayName grammar", async () => {
        Role.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

        await scim.getGroups("t1", 1, 10, 'userName eq "nope"');

        expect(Role.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
      });

      it("clamps a zero/negative startIndex and count to a valid window", async () => {
        Role.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

        await scim.getGroups("t1", 0, 0);

        expect(Role.findAndCountAll).toHaveBeenCalledWith(
          expect.objectContaining({ offset: 0, limit: 1 })
        );
      });

      // Role has no tenantId column; tenant scoping lives on the Users lookup.
      it("never filters roles by tenantId, but scopes member lookups to the tenant", async () => {
        Role.findAndCountAll.mockResolvedValue({ count: 1, rows: [{ id: "g1", name: "ADMIN" }] });
        Users.findAll.mockResolvedValue([{ id: "u1", email: "a@b.com" }]);

        const result = await scim.getGroups("t1");

        expect(Role.findAndCountAll.mock.calls[0][0].where).not.toHaveProperty("tenantId");
        expect(Users.findAll).toHaveBeenCalledWith({
          where: { tenantId: "t1", roleId: "g1" },
          attributes: ["id", "email"],
        });
        expect(result.Resources[0].members).toEqual([{ value: "u1", display: "a@b.com" }]);
      });
    });

    describe("getGroupById", () => {
      it("returns group details with members", async () => {
        Role.findOne.mockResolvedValue({
          id: "g1",
          name: "ADMIN",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        Users.findAll.mockResolvedValue([{ id: "u1", email: "a@b.com" }]);

        const result = await scim.getGroupById("t1", "g1");
        expect(result.displayName).toBe("ADMIN");
        expect(result.members[0].value).toBe("u1");
      });

      it("throws 404 when group not found", async () => {
        Role.findOne.mockResolvedValue(null);
        await expect(scim.getGroupById("t1", "g1")).rejects.toThrow("Group not found");
      });
    });

    describe("createGroup", () => {
      it("creates group and associates members (as strings or objects)", async () => {
        Role.findOne.mockResolvedValue(null);
        Role.create.mockResolvedValue({
          id: "g1",
          name: "NEW_GROUP",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        Users.findOne.mockResolvedValue({ id: "u1", update: jest.fn() });
        Users.findAll.mockResolvedValue([{ id: "u1", email: "a@b.com" }]);

        const result = await scim.createGroup("t1", {
          displayName: "New Group",
          members: ["u1", { value: "u2" }],
        });

        expect(result.displayName).toBe("NEW_GROUP");
      });

      it("throws 400 when displayName is missing", async () => {
        await expect(scim.createGroup("t1", {})).rejects.toThrow("displayName is required");
      });

      it("throws 409 when group already exists", async () => {
        Role.findOne.mockResolvedValue({ id: "g1" });
        await expect(
          scim.createGroup("t1", { displayName: "Existing" })
        ).rejects.toThrow("Group already exists");
      });

      it("creates a global role without a tenantId and skips member assignment when members is absent", async () => {
        Role.findOne.mockResolvedValue(null);
        Role.create.mockResolvedValue({ id: "g1", name: "NEW_GROUP" });
        Users.findAll.mockResolvedValue([]);

        const result = await scim.createGroup("t1", { displayName: "New Group" });

        expect(Role.create).toHaveBeenCalledWith({
          name: "NEW GROUP",
          description: "SCIM-provisioned group: New Group",
          nameToShow: "New Group",
          isSystem: false,
          status: "active",
          sortOrder: 99,
        });
        expect(Role.create.mock.calls[0][0]).not.toHaveProperty("tenantId");
        expect(Users.findOne).not.toHaveBeenCalled();
        expect(result.members).toEqual([]);
      });

      it("skips member assignment when the members array is empty", async () => {
        Role.findOne.mockResolvedValue(null);
        Role.create.mockResolvedValue({ id: "g1", name: "G" });
        Users.findAll.mockResolvedValue([]);

        await scim.createGroup("t1", { displayName: "G", members: [] });

        expect(Users.findOne).not.toHaveBeenCalled();
      });

      it("silently skips members that are not in the tenant", async () => {
        Role.findOne.mockResolvedValue(null);
        Role.create.mockResolvedValue({ id: "g1", name: "G" });
        Users.findOne.mockResolvedValue(null); // member belongs to another tenant
        Users.findAll.mockResolvedValue([]);

        const result = await scim.createGroup("t1", { displayName: "G", members: ["u-other"] });

        expect(Users.findOne).toHaveBeenCalledWith({ where: { id: "u-other", tenantId: "t1" } });
        expect(result.members).toEqual([]);
      });

      it("assigns the new role to members given as strings or {value} objects", async () => {
        Role.findOne.mockResolvedValue(null);
        Role.create.mockResolvedValue({ id: "g1", name: "G" });
        const update = jest.fn();
        Users.findOne.mockResolvedValue({ id: "u1", update });
        Users.findAll.mockResolvedValue([]);

        await scim.createGroup("t1", { displayName: "G", members: ["u1", { value: "u2" }] });

        expect(Users.findOne).toHaveBeenCalledWith({ where: { id: "u1", tenantId: "t1" } });
        expect(Users.findOne).toHaveBeenCalledWith({ where: { id: "u2", tenantId: "t1" } });
        expect(update).toHaveBeenCalledWith({ roleId: "g1" });
        expect(update).toHaveBeenCalledTimes(2);
      });
    });

    describe("updateGroup", () => {
      it("updates group name and updates members", async () => {
        const mockUpdateRole = jest.fn();
        Role.findOne.mockResolvedValue({
          id: "g1",
          update: mockUpdateRole,
        });
        Users.update.mockResolvedValue([1]);
        Users.findAll.mockResolvedValue([]);

        const result = await scim.updateGroup("t1", "g1", {
          displayName: "Updated Group",
          nameToShow: "Updated Group Pretty",
          members: ["u1", { value: "u2" }],
        });

        expect(mockUpdateRole).toHaveBeenCalledWith({
          name: "UPDATED GROUP",
          nameToShow: "Updated Group Pretty",
        });
        expect(Users.update).toHaveBeenCalled();
      });

      it("throws 404 when group not found", async () => {
        Role.findOne.mockResolvedValue(null);
        await expect(scim.updateGroup("t1", "g1", {})).rejects.toThrow("Group not found");
      });

      it("applies no updates and touches no members for an empty payload", async () => {
        const mockUpdateRole = jest.fn();
        Role.findOne.mockResolvedValue({ id: "g1", update: mockUpdateRole });
        Users.findAll.mockResolvedValue([]);

        await scim.updateGroup("t1", "g1", {});

        expect(mockUpdateRole).toHaveBeenCalledWith({});
        expect(Users.update).not.toHaveBeenCalled();
        expect(Role.findOne).toHaveBeenCalledWith({ where: { id: "g1" } });
      });

      it("scopes the member reassignment to the tenant", async () => {
        Role.findOne.mockResolvedValue({ id: "g1", update: jest.fn() });
        Users.update.mockResolvedValue([1]);
        Users.findAll.mockResolvedValue([]);

        await scim.updateGroup("t1", "g1", { members: ["u1", { value: "u2" }] });

        expect(Users.update).toHaveBeenCalledWith(
          { roleId: "g1" },
          { where: { id: { [Op.in]: ["u1", "u2"] }, tenantId: "t1" } }
        );
      });
    });

    describe("patchGroup", () => {
      it("applies patch ops (replace, add, remove) on group", async () => {
        Role.findOne.mockResolvedValue({
          id: "g1",
          update: jest.fn(),
        });
        Users.update.mockResolvedValue([1]);
        Users.findAll.mockResolvedValue([]);

        const patchOps = [
          { op: "replace", value: { displayName: "New Display Name" } },
          { op: "add", value: { members: ["u1"] } },
          { op: "remove", value: { members: [{ value: "u2" }] } },
        ];

        await scim.patchGroup("t1", "g1", patchOps);
        expect(Users.update).toHaveBeenCalled();
      });

      it("throws 404 when group not found", async () => {
        Role.findOne.mockResolvedValue(null);
        await expect(scim.patchGroup("t1", "g1", [])).rejects.toThrow("Group not found");
      });

      it("renames the group on a replace displayName op", async () => {
        const update = jest.fn();
        Role.findOne.mockResolvedValue({ id: "g1", update });
        Users.findAll.mockResolvedValue([]);

        await scim.patchGroup("t1", "g1", [
          { op: "replace", value: { displayName: "New Display Name" } },
        ]);

        expect(update).toHaveBeenCalledWith({
          name: "NEW DISPLAY NAME",
          nameToShow: "New Display Name",
        });
      });

      it("adds members (strings or objects) scoped to the tenant", async () => {
        Role.findOne.mockResolvedValue({ id: "g1", update: jest.fn() });
        Users.update.mockResolvedValue([1]);
        Users.findAll.mockResolvedValue([]);

        await scim.patchGroup("t1", "g1", [
          { op: "add", value: { members: ["u1", { value: "u2" }] } },
        ]);

        expect(Users.update).toHaveBeenCalledWith(
          { roleId: "g1" },
          { where: { id: { [Op.in]: ["u1", "u2"] }, tenantId: "t1" } }
        );
      });

      it("demotes removed members to the default role", async () => {
        Role.findOne.mockResolvedValue({ id: "g1", update: jest.fn() });
        Users.update.mockResolvedValue([1]);
        Users.findAll.mockResolvedValue([]);

        await scim.patchGroup("t1", "g1", [
          { op: "remove", value: { members: ["u1", { value: "u2" }] } },
        ]);

        expect(Users.update).toHaveBeenCalledWith(
          { roleId: ROLE_IDS.USER },
          { where: { id: { [Op.in]: ["u1", "u2"] }, tenantId: "t1" } }
        );
      });

      // A-33: an operation that names nothing this module can apply used to be
      // dropped with a 200. Every one of these shapes is now a 400.
      it.each([
        ["an empty value object", { op: "replace", value: {} }],
        ["no value and no path", { op: "replace" }],
        ["an unknown op", { op: "unknown", value: { displayName: "X" } }],
      ])("rejects %s with 400 instead of a silent 200", async (_label, operation) => {
        const update = jest.fn();
        Role.findOne.mockResolvedValue({ id: "g1", update });
        Users.findAll.mockResolvedValue([]);

        await expect(scim.patchGroup("t1", "g1", [operation])).rejects.toMatchObject({ status: 400 });

        expect(update).not.toHaveBeenCalled();
        expect(Users.update).not.toHaveBeenCalled();
      });
    });

    describe("deleteGroup", () => {
      it("deletes group successfully", async () => {
        const mockDestroy = jest.fn();
        Role.findOne.mockResolvedValue({
          id: "g1",
          destroy: mockDestroy,
        });

        const result = await scim.deleteGroup("t1", "g1");
        expect(result.status).toBe(204);
        expect(mockDestroy).toHaveBeenCalled();
      });

      it("throws 404 when group to delete not found", async () => {
        Role.findOne.mockResolvedValue(null);
        await expect(scim.deleteGroup("t1", "g1")).rejects.toThrow("Group not found");
      });
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

  it("refuses to rename a system role", async () => {
    Role.findOne.mockResolvedValue({ id: "r-sys", name: "HEALTHCARE ADMIN", isSystem: true, update: jest.fn() });
    await expect(
      scim.updateGroup("t1", "r-sys", { displayName: "anything" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses to delete a system role", async () => {
    const destroy = jest.fn();
    Role.findOne.mockResolvedValue({ id: "r-sys", name: "SUPERADMIN", isSystem: true, destroy });
    await expect(scim.deleteGroup("t1", "r-sys")).rejects.toMatchObject({ status: 403 });
    expect(destroy).not.toHaveBeenCalled();
  });

  it("refuses to patch a system role", async () => {
    Role.findOne.mockResolvedValue({ id: "r-sys", name: "USER", isSystem: true, update: jest.fn() });
    await expect(
      scim.patchGroup("t1", "r-sys", [{ op: "replace", value: { displayName: "x" } }]),
    ).rejects.toMatchObject({ status: 403 });
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
      await scim.patchUser("t1", "u1", [{ op: "add", path: "roleId", value: "r7" }]);

      expect(update).toHaveBeenCalledWith({ roleId: "r7" });
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
        scim.patchUser("t1", "u1", [{ op: "add", path: "roleId", value: "r-other" }]),
      ).rejects.toMatchObject({ status: 403 });
      expect(update).not.toHaveBeenCalled();
    });

    it("refuses a path-form roleId that names no role with 400", async () => {
      Role.findOne.mockResolvedValue(null);

      await expect(
        scim.patchUser("t1", "u1", [{ op: "replace", path: "roleId", value: "nope" }]),
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
        scim.patchUser("t1", "u1", [{ op: "replace", path: ["roleId"], value: "r7" }]),
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

  describe("patchGroup — path form", () => {
    beforeEach(() => {
      Role.findOne.mockResolvedValue({ id: "g1", name: "ENGINEERS", isSystem: false, update });
    });

    it("adds members given the standard IdP membership operation", async () => {
      await scim.patchGroup("t1", "g1", [
        { op: "add", path: "members", value: [{ value: "u1" }, { value: "u2" }] },
      ]);

      expect(Users.update).toHaveBeenCalledWith(
        { roleId: "g1" },
        { where: { id: { [Op.in]: ["u1", "u2"] }, tenantId: "t1" } },
      );
    });

    it("resolves a members path carrying the core Group schema URN", async () => {
      await scim.patchGroup("t1", "g1", [
        { op: "add", path: "urn:ietf:params:scim:schemas:core:2.0:Group:members", value: ["u1"] },
      ]);

      expect(Users.update).toHaveBeenCalledWith(
        { roleId: "g1" },
        { where: { id: { [Op.in]: ["u1"] }, tenantId: "t1" } },
      );
    });

    it("treats a replace on members as an assignment, like PUT does", async () => {
      await scim.patchGroup("t1", "g1", [{ op: "replace", path: "members", value: "u3" }]);

      expect(Users.update).toHaveBeenCalledWith(
        { roleId: "g1" },
        { where: { id: { [Op.in]: ["u3"] }, tenantId: "t1" } },
      );
    });

    it("renames the group given path displayName", async () => {
      await scim.patchGroup("t1", "g1", [
        { op: "replace", path: "displayName", value: "Platform Team" },
      ]);

      expect(update).toHaveBeenCalledWith({ name: "PLATFORM TEAM", nameToShow: "Platform Team" });
    });

    it("removes the single member named by an Okta value filter", async () => {
      await scim.patchGroup("t1", "g1", [{ op: "remove", path: 'members[value eq "u9"]' }]);

      expect(Users.update).toHaveBeenCalledWith(
        { roleId: ROLE_IDS.USER },
        { where: { id: { [Op.in]: ["u9"] }, tenantId: "t1" } },
      );
    });

    it("removes the members named in the value", async () => {
      await scim.patchGroup("t1", "g1", [
        { op: "remove", path: "members", value: [{ value: "u1" }] },
      ]);

      expect(Users.update).toHaveBeenCalledWith(
        { roleId: ROLE_IDS.USER },
        { where: { id: { [Op.in]: ["u1"] }, tenantId: "t1" } },
      );
    });

    it("empties the group, tenant-scoped, when remove members carries no value", async () => {
      await scim.patchGroup("t1", "g1", [{ op: "remove", path: "members" }]);

      expect(Users.update).toHaveBeenCalledWith(
        { roleId: ROLE_IDS.USER },
        { where: { roleId: "g1", tenantId: "t1" } },
      );
    });

    it("rejects an empty members value with 400", async () => {
      await expect(
        scim.patchGroup("t1", "g1", [{ op: "add", path: "members", value: [] }]),
      ).rejects.toMatchObject({ status: 400 });
      expect(Users.update).not.toHaveBeenCalled();
    });

    it("rejects removing displayName with 400", async () => {
      await expect(
        scim.patchGroup("t1", "g1", [{ op: "remove", path: "displayName" }]),
      ).rejects.toMatchObject({ status: 400 });
      expect(update).not.toHaveBeenCalled();
    });

    it("rejects a non-string displayName with 400", async () => {
      await expect(
        scim.patchGroup("t1", "g1", [{ op: "replace", path: "displayName", value: { x: 1 } }]),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects an unsupported group path with 400", async () => {
      await expect(
        scim.patchGroup("t1", "g1", [{ op: "add", path: "externalId", value: "x" }]),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects a non-string group path with 400", async () => {
      await expect(
        scim.patchGroup("t1", "g1", [{ op: "add", path: ["members"], value: ["u1"] }]),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects a group operation with neither a path nor an object value", async () => {
      await expect(
        scim.patchGroup("t1", "g1", [{ op: "add", value: ["u1"] }]),
      ).rejects.toMatchObject({ status: 400 });
    });

    // The asymmetry docs/DEVELOPER/09-SCIM-PROVISIONING.md flagged: updateGroup
    // guarded member assignment, patchGroup did not.
    it("runs a path-form member add through the A-27 role guard", async () => {
      Role.findOne.mockResolvedValue({ id: SUPERADMIN_ID, name: "SUPERADMIN", isSystem: false, update });

      await expect(
        scim.patchGroup("t1", SUPERADMIN_ID, [{ op: "add", path: "members", value: ["u1"] }]),
      ).rejects.toMatchObject({ status: 403 });
      expect(Users.update).not.toHaveBeenCalled();
    });

    it("runs a value-form member add through the A-27 role guard too", async () => {
      Role.findOne.mockResolvedValue({ id: SUPERADMIN_ID, name: "SUPERADMIN", isSystem: false, update });

      await expect(
        scim.patchGroup("t1", SUPERADMIN_ID, [{ op: "add", value: { members: ["u1"] } }]),
      ).rejects.toMatchObject({ status: 403 });
      expect(Users.update).not.toHaveBeenCalled();
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

      expect(Users.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: "t1", email: "ada@b.com" } }),
      );
      expect(result.totalResults).toBe(1);
      expect(result.Resources).toHaveLength(1);
      expect(result.Resources[0].userName).toBe("ada@b.com");
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
          where: { tenantId: "t1", email: "ada@b.com", isActive: true, status: "ACTIVE" },
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
