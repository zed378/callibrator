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
        { op: "remove", path: ["roleId"] },
      ];

      await scim.patchUser("t1", "u1", patchOps);

      expect(mockUpdate).toHaveBeenCalled();
    });

    it("handles partial name replacements and empty operations", async () => {
      const mockUpdate = jest.fn();
      Users.findOne.mockResolvedValue({
        id: "u1",
        update: mockUpdate,
      });

      await scim.patchUser("t1", "u1", [
        { op: "replace", value: { name: { givenName: "X" } } },
        { op: "replace", value: { name: { familyName: "Y" } } },
        { op: "replace", value: null },
        { op: "add", value: null },
        { op: "remove", path: null },
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

    it("ignores unknown keys and unknown ops", async () => {
      const mockUpdate = jest.fn();
      Users.findOne.mockResolvedValue({ id: "u1", update: mockUpdate });

      await scim.patchUser("t1", "u1", [
        { op: "replace", value: { unknownKey: "x" } },
        { op: "add", value: { unknownKey: "x" } },
        { op: "remove", path: ["unknownKey"] },
        { op: "noSuchOp", value: { roleId: "r9" } },
      ]);

      expect(mockUpdate).toHaveBeenCalledWith({});
    });

    it("resets roleId to the default role on remove", async () => {
      const mockUpdate = jest.fn();
      Users.findOne.mockResolvedValue({ id: "u1", update: mockUpdate });

      await scim.patchUser("t1", "u1", [{ op: "remove", path: ["roleId"] }]);

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

      it("ignores ops with no matching value payload", async () => {
        const update = jest.fn();
        Role.findOne.mockResolvedValue({ id: "g1", update });
        Users.findAll.mockResolvedValue([]);

        await scim.patchGroup("t1", "g1", [
          { op: "replace", value: {} },
          { op: "add", value: {} },
          { op: "remove", value: {} },
          { op: "replace" },
          { op: "unknown", value: { displayName: "X" } },
        ]);

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
