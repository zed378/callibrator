const { describe, it, expect, beforeEach } = require("@jest/globals");

jest.mock("../../models", () => ({
  MenuGroup: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
  },
  Role: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
  },
  RoleMenuPermission: {
    findAll: jest.fn(),
    findOrCreate: jest.fn(),
    destroy: jest.fn(),
  },
}));

// A-173: create/update/delete run in a managed transaction, audit through
// logAction and clear the permissions cache after the commit; those effects
// are asserted against the schema-enforcing ledger in menuGroup.audit.a173.test.js.
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb("TX")) },
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../services/redis.service", () => ({
  del: jest.fn().mockResolvedValue(0),
  delPattern: jest.fn().mockResolvedValue(0),
  cacheKeys: { permissions: (roleId) => `permissions:role:${roleId}` },
}));

// ADR-102: visibility is the effective permission's (effectivePermission
// .adr102 / menuEffectiveAccess.adr102 test the rule itself on the real seed).
// Here a leaf is visible when its slug is in `mockVisible`, so these tests
// check the tree walk: pruning, nesting and one entry per top-level page.
const mockVisible = new Set();
jest.mock("../../services/effectivePermission.service", () => ({
  loadPermissionSources: jest.fn(async () => ({ superAdmin: false, matrix: {}, overrides: {} })),
  menuEntryVisible: jest.fn((_principal, _sources, slug) => mockVisible.has(slug)),
  effectivePermissionMap: jest.fn(() => ({})),
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

const { MenuGroup, Role, RoleMenuPermission } = require("../../models");
const {
  listMenuGroups,
  getRoleMenuAssignments,
  getAvailableRoles,
  createMenuGroup,
  updateMenuGroup,
  deleteMenuGroup,
  assignMenuToRole,
  revokeMenuFromRole,
  bulkAssign,
  bulkRevoke,
  mapSlugToPath,
  formatMenuGroup,
} = require("../../services/menuGroup.service");

// ---- helper ----
const expectRejectsWithMessage = async (promise, message) => {
  try {
    await promise;
    expect(true).toBe(false);
  } catch (err) {
    expect(err).toBeDefined();
    const actual = (err && err.message) || String(err);
    expect(actual).toContain(message);
  }
};

// ---- fix: MenuGroup.findAll returns plain arrays in service, not instances ----
const mockMenuGroupInstance = (extra = {}) => {
  const obj = {
    id: "mg-1",
    name: "Dashboard",
    slug: "dashboard",
    icon: "dashboard",
    sortOrder: 1,
    parentId: null,
    children: [],
    ...extra,
  };
  return obj;
};

const mockRoleInstance = (extra = {}) => ({ id: "role-1", name: "Admin", sortOrder: 1, ...extra });

// ================================================================
describe("menuGroup.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVisible.clear();
    Role.findByPk.mockResolvedValue({ id: "role-1", name: "Admin", roleLevel: 8 });
  });

  describe("mapSlugToPath", () => {
    it("should map known slugs to their known paths", () => {
      // S7 (ADR-102): Home is the dashboard home, not the public landing page.
      expect(mapSlugToPath("home")).toBe("/dashboard");
      expect(mapSlugToPath("dashboard")).toBe("/dashboard");
      expect(mapSlugToPath("change-password")).toBe("/dashboard/change-password");
      expect(mapSlugToPath("menu-groups")).toBe("/dashboard/menu-groups");
    });

    it("should fallback to /dashboard/{slug} for unknown slugs", () => {
      expect(mapSlugToPath("my-custom")).toBe("/dashboard/my-custom");
    });
  });

  describe("formatMenuGroup", () => {
    it("should format a group without children", () => {
      const group = mockMenuGroupInstance({ children: [] });
      const result = formatMenuGroup(group);
      expect(result.id).toBe("mg-1");
      expect(result.label).toBe("Dashboard");
      expect(result.path).toBe("/dashboard");
      expect(result.items).toEqual([]);
    });

    it("should format a group with children", () => {
      const child = {
        id: "mg-2",
        name: "Settings",
        slug: "settings",
        icon: "settings",
        sortOrder: 1,
      };
      const group = mockMenuGroupInstance({ children: [child] });
      const result = formatMenuGroup(group);
      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe("mg-2");
    });

    it("should set isAssigned when isAssignedMap provided", () => {
      const group = mockMenuGroupInstance({});
      const map = { "mg-1": true };
      const result = formatMenuGroup(group, map);
      expect(result.isAssigned).toBe(true);
    });
  });

  // ================================================================
  describe("listMenuGroups", () => {
    it("should return all active parent groups without role filter", async () => {
      const groupA = mockMenuGroupInstance({ id: "g-1", name: "Group A" });
      MenuGroup.findAll.mockResolvedValueOnce([groupA]);

      const result = await listMenuGroups(null);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("g-1");
      expect(MenuGroup.findAll).toHaveBeenCalled();
    });

    it("should annotate with isAssigned when roleId provided", async () => {
      const groupA = mockMenuGroupInstance({ id: "g-1" });
      MenuGroup.findAll.mockResolvedValueOnce([groupA]);
      RoleMenuPermission.findAll.mockResolvedValueOnce([
        { menuGroupId: "g-1" },
        { menuGroupId: "g-2" },
      ]);

      const result = await listMenuGroups("role-1");
      expect(result).toHaveLength(1);
      expect(result[0].isAssigned).toBe(true);
      expect(RoleMenuPermission.findAll).toHaveBeenCalledWith({ where: { roleId: "role-1" } });
    });
  });

  // ================================================================
  describe("getRoleMenuAssignments", () => {
    it("shows a group with the children whose page the role can use (ADR-102)", async () => {
      const child = mockMenuGroupInstance({ id: "c-1", name: "Child 1", slug: "child-1", sortOrder: 1 });
      const hidden = mockMenuGroupInstance({ id: "c-2", name: "Child 2", slug: "child-2", sortOrder: 2 });
      const parent = mockMenuGroupInstance({
        id: "p-1", name: "Parent", slug: "parent", sortOrder: 1,
        children: [child, hidden],
      });
      MenuGroup.findAll.mockResolvedValueOnce([parent]);
      mockVisible.add("child-1");

      const result = await getRoleMenuAssignments("role-1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("p-1");
      expect(result[0].items.map((i) => i.id)).toEqual(["c-1"]);
    });

    it("a grant on the parent alone no longer shows its children (the old cascade)", async () => {
      const parent = mockMenuGroupInstance({
        id: "p-1", name: "Parent", slug: "parent", sortOrder: 1,
        children: [mockMenuGroupInstance({ id: "c-1", slug: "c1" })],
      });
      MenuGroup.findAll.mockResolvedValueOnce([parent]);
      mockVisible.add("parent");

      expect(await getRoleMenuAssignments("role-1")).toEqual([]);
    });

    it("an unknown role has no menu", async () => {
      Role.findByPk.mockResolvedValueOnce(null);
      expect(await getRoleMenuAssignments("nope")).toEqual([]);
      expect(MenuGroup.findAll).not.toHaveBeenCalled();
    });

    it("the requester's own role: the menu is resolved for the requester (their overrides)", async () => {
      const effective = require("../../services/effectivePermission.service");
      MenuGroup.findAll.mockResolvedValueOnce([]);
      await getRoleMenuAssignments("role-1", { id: "u-1", roleId: "role-1", role: { id: "role-1", name: "Admin" } });
      expect(Role.findByPk).not.toHaveBeenCalled();
      expect(effective.loadPermissionSources).toHaveBeenCalledWith({
        id: "u-1",
        role: { id: "role-1", name: "Admin" },
      });
    });

    it("another role (a super admin's preview): the role's own grants, no user", async () => {
      const effective = require("../../services/effectivePermission.service");
      MenuGroup.findAll.mockResolvedValueOnce([]);
      await getRoleMenuAssignments("role-1", { id: "sa", role: { id: "role-sa", name: "SUPERADMIN" } });
      expect(effective.loadPermissionSources).toHaveBeenCalledWith({
        role: { id: "role-1", name: "Admin", roleLevel: 8 },
      });
    });

    it("top-level links to the same page are shown once (Home and Dashboard)", async () => {
      MenuGroup.findAll.mockResolvedValueOnce([
        mockMenuGroupInstance({ id: "home", slug: "home", sortOrder: 0 }),
        mockMenuGroupInstance({ id: "dash", slug: "dashboard", sortOrder: 1 }),
      ]);
      mockVisible.add("home").add("dashboard");

      const result = await getRoleMenuAssignments("role-1");
      expect(result.map((g) => g.id)).toEqual(["home"]);
      expect(result[0].path).toBe("/dashboard");
    });
  });

  // ================================================================
  describe("getAvailableRoles", () => {
    it("should fetch all roles ordered by sortOrder", async () => {
      Role.findAll.mockResolvedValueOnce([mockRoleInstance()]);
      const result = await getAvailableRoles();
      expect(Role.findAll).toHaveBeenCalledWith({ order: [["sortOrder", "ASC"]] });
      expect(result).toHaveLength(1);
    });
  });

  // ================================================================
  describe("createMenuGroup", () => {
    it("should create a new menu group with auto-generated slug", async () => {
      const created = mockMenuGroupInstance({ id: "new-1", name: "New Group", slug: "new-group" });
      MenuGroup.create.mockResolvedValueOnce(created);

      const result = await createMenuGroup({ name: "New Group", icon: "icon" });
      expect(result.id).toBe("new-1");
      expect(result.label).toBe("New Group");
      expect(result.path).toBe("/dashboard/new-group");
      expect(MenuGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "New Group",
          slug: "new-group",
        }),
        { transaction: "TX" },
      );
    });

    it("should use provided slug", async () => {
      const created = mockMenuGroupInstance({ id: "new-2", slug: "custom-slug" });
      MenuGroup.create.mockResolvedValueOnce(created);

      await createMenuGroup({ name: "Custom", slug: "custom-slug", icon: "i" });
      expect(MenuGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "custom-slug" }),
        { transaction: "TX" },
      );
    });
  });

  // ================================================================
  describe("updateMenuGroup", () => {
    it("should update a menu group", async () => {
      const group = {
        id: "mg-1",
        name: "Old Name",
        slug: "old",
        icon: "old-icon",
        sortOrder: 1,
        parentId: null,
        isActive: true,
        children: [],
        update: jest.fn().mockResolvedValue({}),
      };
      MenuGroup.findByPk.mockResolvedValueOnce(group);

      const result = await updateMenuGroup({ id: "mg-1", name: "New Name" });
      expect(result.label).toBe("Old Name");
      expect(group.update).toHaveBeenCalled();
    });

    it("should throw 404 when menu group not found", async () => {
      MenuGroup.findByPk.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(
        updateMenuGroup({ id: "missing", name: "Nope" }),
        "Menu group not found",
      );
    });
  });

  // ================================================================
  describe("deleteMenuGroup", () => {
    it("should delete an empty menu group and its grants", async () => {
      const group = {
        id: "mg-1",
        destroy: jest.fn().mockResolvedValue(1),
      };
      MenuGroup.findByPk.mockResolvedValueOnce(group);
      RoleMenuPermission.destroy.mockResolvedValueOnce(1);
      MenuGroup.findAll.mockResolvedValueOnce([]);

      await deleteMenuGroup("mg-1", { userId: "u1" });
      expect(RoleMenuPermission.destroy).toHaveBeenCalledWith({ where: { menuGroupId: "mg-1" }, transaction: "TX" });
      // A-181: children are never removed (or orphaned) by a delete.
      expect(MenuGroup.destroy).not.toHaveBeenCalled();
      expect(group.destroy).toHaveBeenCalledWith({ transaction: "TX" });
    });

    it("should throw 404 when group not found", async () => {
      MenuGroup.findByPk.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(deleteMenuGroup("missing"), "Menu group not found");
    });
  });

  // ================================================================
  describe("assignMenuToRole", () => {
    it("should throw 404 when role not found", async () => {
      Role.findByPk.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(assignMenuToRole({ roleId: "missing", menuGroupId: "mg-1" }), "Role not found");
    });

    it("should throw 404 when menu group not found", async () => {
      Role.findByPk.mockResolvedValueOnce(mockRoleInstance());
      MenuGroup.findByPk.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(
        assignMenuToRole({ roleId: "role-1", menuGroupId: "missing" }),
        "Menu group or item not found",
      );
    });

    it("should create a new permission assignment", async () => {
      Role.findByPk.mockResolvedValueOnce(mockRoleInstance());
      MenuGroup.findByPk.mockResolvedValueOnce(mockMenuGroupInstance());
      const perm = { id: "perm-1", roleId: "role-1", menuGroupId: "mg-1" };
      RoleMenuPermission.findOrCreate.mockResolvedValueOnce([perm, true]);

      const result = await assignMenuToRole({ roleId: "role-1", menuGroupId: "mg-1" }, { userId: "u1" });
      expect(result.id).toBe("perm-1");
      expect(RoleMenuPermission.findOrCreate).toHaveBeenCalledWith({
        where: { roleId: "role-1", menuGroupId: "mg-1" },
        defaults: { permissionType: "read" },
        transaction: "TX",
      });
    });

    it("should return existing permission when already assigned", async () => {
      Role.findByPk.mockResolvedValueOnce(mockRoleInstance());
      MenuGroup.findByPk.mockResolvedValueOnce(mockMenuGroupInstance());
      const perm = { id: "perm-2" };
      RoleMenuPermission.findOrCreate.mockResolvedValueOnce([perm, false]);

      const result = await assignMenuToRole({ roleId: "role-1", menuGroupId: "mg-1" });
      expect(result.id).toBe("perm-2");
    });
  });

  // ================================================================
  describe("revokeMenuFromRole", () => {
    it("should destroy the permission assignment", async () => {
      await revokeMenuFromRole({ roleId: "role-1", menuGroupId: "mg-1" }, { userId: "u1" });
      expect(RoleMenuPermission.destroy).toHaveBeenCalledWith({
        where: { roleId: "role-1", menuGroupId: "mg-1" },
        transaction: "TX",
      });
    });
  });

  // ================================================================
  describe("bulkAssign", () => {
    it("should throw 404 when role not found", async () => {
      Role.findByPk.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(bulkAssign("missing", ["mg-1"]), "Role not found");
    });

    it("should assign existing and skip already-assigned", async () => {
      Role.findByPk.mockResolvedValueOnce(mockRoleInstance());
      MenuGroup.findAll.mockResolvedValueOnce([{ id: "mg-1" }, { id: "mg-2" }]);
      RoleMenuPermission.findOrCreate.mockResolvedValueOnce([{ id: "p1" }, true]); // new
      RoleMenuPermission.findOrCreate.mockResolvedValueOnce([{ id: "p2" }, false]); // existing

      const result = await bulkAssign("role-1", ["mg-1", "mg-2"], { userId: "u1" });
      expect(result.assigned).toEqual(["mg-1"]);
      expect(result.alreadyAssigned).toEqual(["mg-2"]);
      expect(result.failed).toEqual([]);
    });

    it("should report missing groups in failed list", async () => {
      Role.findByPk.mockResolvedValueOnce(mockRoleInstance());
      MenuGroup.findAll.mockResolvedValueOnce([]);

      const result = await bulkAssign("role-1", ["missing-mg"]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].menuGroupId).toBe("missing-mg");
    });
  });

  // ================================================================
  describe("bulkRevoke", () => {
    it("should return revoked and notFound lists", async () => {
      RoleMenuPermission.destroy
        .mockResolvedValueOnce(1) // revoked
        .mockResolvedValueOnce(0); // not found

      const result = await bulkRevoke("role-1", ["mg-1", "mg-2"], { userId: "u1" });
      expect(result.revoked).toEqual(["mg-1"]);
      expect(result.notFound).toEqual(["mg-2"]);
    });
  });

  // ================================================================
  // Coverage: child sort comparator, bulkAssign catch, slug defaults
  // ================================================================
  describe("formatMenuGroup child ordering", () => {
    it("sorts children by sortOrder ascending", () => {
      const group = {
        id: "g1",
        name: "Group",
        icon: "i",
        slug: "group",
        sortOrder: 1,
        children: [
          { id: "c3", name: "Third", icon: "i3", slug: "third", sortOrder: 3 },
          { id: "c1", name: "First", icon: "i1", slug: "first", sortOrder: 1 },
          { id: "c2", name: "Second", icon: "i2", slug: "second", sortOrder: 2 },
        ],
      };

      const formatted = formatMenuGroup(group);

      expect(formatted.items.map((i) => i.id)).toEqual(["c1", "c2", "c3"]);
    });

    it("treats a missing child sortOrder as 0 in the comparator", () => {
      const group = {
        id: "g1",
        name: "Group",
        icon: "i",
        slug: "group",
        sortOrder: 1,
        children: [
          { id: "c2", name: "Second", icon: "i2", slug: "second", sortOrder: 5 },
          { id: "c1", name: "NoOrder", icon: "i1", slug: "first" },
        ],
      };

      const formatted = formatMenuGroup(group);

      expect(formatted.items.map((i) => i.id)).toEqual(["c1", "c2"]);
    });

    it("returns an empty items array when children is an empty array", () => {
      const formatted = formatMenuGroup({
        id: "g1",
        name: "Group",
        icon: "i",
        slug: "group",
        sortOrder: 1,
        children: [],
      });

      expect(formatted.items).toEqual([]);
    });

    it("returns an empty items array when children is undefined", () => {
      const formatted = formatMenuGroup({
        id: "g1",
        name: "Group",
        icon: "i",
        slug: "group",
        sortOrder: 1,
      });

      expect(formatted.items).toEqual([]);
    });

    it("leaves isAssigned undefined when no assignment map is supplied", () => {
      const formatted = formatMenuGroup({
        id: "g1",
        name: "Group",
        icon: "i",
        slug: "group",
        sortOrder: 1,
        children: [{ id: "c1", name: "Child", icon: "i1", slug: "child", sortOrder: 1 }],
      });

      expect(formatted.isAssigned).toBeUndefined();
      expect(formatted.items[0].isAssigned).toBeUndefined();
    });

    it("marks assigned parents and children from the assignment map", () => {
      const formatted = formatMenuGroup(
        {
          id: "g1",
          name: "Group",
          icon: "i",
          slug: "group",
          sortOrder: 1,
          children: [
            { id: "c1", name: "Child", icon: "i1", slug: "child", sortOrder: 1 },
            { id: "c2", name: "Other", icon: "i2", slug: "other", sortOrder: 2 },
          ],
        },
        { g1: true, c1: true },
      );

      expect(formatted.isAssigned).toBe(true);
      expect(formatted.items[0].isAssigned).toBe(true);
      expect(formatted.items[1].isAssigned).toBe(false);
    });
  });

  describe("mapSlugToPath", () => {
    it("maps a known slug to its custom dashboard path", () => {
      expect(mapSlugToPath("home")).toBe("/dashboard");
      expect(mapSlugToPath("calibration")).toBe("/dashboard/devices");
    });

    it("falls back to /dashboard/<slug> for an unknown slug", () => {
      expect(mapSlugToPath("something-new")).toBe("/dashboard/something-new");
    });
  });

  describe("createMenuGroup slug default", () => {
    it("derives a slug from the name when none is supplied", async () => {
      MenuGroup.create.mockResolvedValueOnce({
        id: "g1",
        name: "My New Group",
        slug: "my-new-group",
        sortOrder: 1,
      });

      await createMenuGroup({ name: "My New Group", icon: "i", sortOrder: 1 });

      expect(MenuGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "my-new-group" }),
        { transaction: "TX" },
      );
    });

    it("uses an explicit slug when supplied", async () => {
      MenuGroup.create.mockResolvedValueOnce({ id: "g1", name: "N", slug: "custom" });

      await createMenuGroup({ name: "My New Group", slug: "custom" });

      expect(MenuGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "custom" }),
        { transaction: "TX" },
      );
    });
  });

  describe("updateMenuGroup field fallbacks", () => {
    it("keeps existing values for every field left undefined", async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      MenuGroup.findByPk.mockResolvedValueOnce({
        id: "g1",
        name: "Old",
        slug: "old",
        icon: "old-icon",
        parentId: "p1",
        sortOrder: 7,
        isActive: true,
        update,
      });

      await updateMenuGroup({ id: "g1" });

      expect(update).toHaveBeenCalledWith({
        name: "Old",
        slug: "old",
        icon: "old-icon",
        parentId: "p1",
        sortOrder: 7,
        isActive: true,
      }, { transaction: "TX" });
    });

    it("applies falsy-but-defined values rather than falling back", async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      MenuGroup.findByPk.mockResolvedValueOnce({
        id: "g1",
        name: "Old",
        slug: "old",
        icon: "old-icon",
        parentId: "p1",
        sortOrder: 7,
        isActive: true,
        update,
      });

      await updateMenuGroup({ id: "g1", parentId: null, sortOrder: 0, isActive: false });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ parentId: null, sortOrder: 0, isActive: false }),
        { transaction: "TX" },
      );
    });
  });

  describe("grant writes with nothing to change need no actor", () => {
    it("revokeMenuFromRole with no grant to remove writes no audit row", async () => {
      RoleMenuPermission.destroy.mockResolvedValueOnce(0);
      await revokeMenuFromRole({ roleId: "role-1", menuGroupId: "mg-1" });
      expect(require("../../services/audit.service").logAction).not.toHaveBeenCalled();
    });

    it("bulkRevoke with no grant to remove writes no audit row", async () => {
      RoleMenuPermission.destroy.mockResolvedValueOnce(0);
      const result = await bulkRevoke("role-1", ["mg-1"]);
      expect(result).toEqual({ revoked: [], notFound: ["mg-1"] });
      expect(require("../../services/audit.service").logAction).not.toHaveBeenCalled();
    });
  });

  describe("bulkAssign error handling", () => {
    // A-181: all or nothing. A PostgreSQL transaction cannot continue past a
    // failed statement, so a write failure now rolls the batch back and
    // surfaces, rather than being reported as one failed item of a batch
    // whose other items were already lost.
    it("a findOrCreate rejection rejects the whole batch", async () => {
      Role.findByPk.mockResolvedValueOnce({ id: "role-1" });
      MenuGroup.findAll.mockResolvedValueOnce([{ id: "mg-1" }, { id: "mg-2" }]);
      RoleMenuPermission.findOrCreate.mockRejectedValueOnce(new Error("unique constraint violated"));

      await expect(bulkAssign("role-1", ["mg-1", "mg-2"], { userId: "u1" })).rejects.toThrow(
        "unique constraint violated",
      );
      expect(RoleMenuPermission.findOrCreate).toHaveBeenCalledTimes(1);
    });

    it("a menu-group lookup failure rejects before any write", async () => {
      Role.findByPk.mockResolvedValueOnce({ id: "role-1" });
      MenuGroup.findAll.mockRejectedValueOnce(new Error("DB down"));

      await expect(bulkAssign("role-1", ["mg-1"], { userId: "u1" })).rejects.toThrow("DB down");
      expect(RoleMenuPermission.findOrCreate).not.toHaveBeenCalled();
    });
  });

  describe("formatMenuGroup comparator with both sortOrders missing", () => {
    it("keeps children stable when neither child has a sortOrder", () => {
      const formatted = formatMenuGroup({
        id: "g1",
        name: "Group",
        icon: "i",
        slug: "group",
        sortOrder: 1,
        children: [
          { id: "c1", name: "A", icon: "i1", slug: "a" },
          { id: "c2", name: "B", icon: "i2", slug: "b" },
        ],
      });

      expect(formatted.items.map((i) => i.id)).toEqual(["c1", "c2"]);
    });

    it("sorts an ordered child ahead of an unordered one", () => {
      const formatted = formatMenuGroup({
        id: "g1",
        name: "Group",
        icon: "i",
        slug: "group",
        sortOrder: 1,
        children: [
          { id: "c1", name: "NoOrder", icon: "i1", slug: "a" },
          { id: "c2", name: "Ordered", icon: "i2", slug: "b", sortOrder: 4 },
        ],
      });

      expect(formatted.items.map((i) => i.id)).toEqual(["c1", "c2"]);
    });
  });

  describe("getRoleMenuAssignments coverage gaps", () => {
    it("omits a group none of whose children is visible", async () => {
      MenuGroup.findAll.mockResolvedValueOnce([
        {
          id: "g1", name: "Group", icon: "i", slug: "group", sortOrder: 1,
          children: [{ id: "c1", name: "A", icon: "i1", slug: "a" }],
        },
      ]);

      expect(await getRoleMenuAssignments("role-1")).toEqual([]);
    });

    it("a top-level link (no children array at all) is shown when its page is visible", async () => {
      MenuGroup.findAll.mockResolvedValueOnce([{ id: "g1", name: "Leaf", icon: "i", slug: "leaf", sortOrder: 1 }]);
      mockVisible.add("leaf");

      const result = await getRoleMenuAssignments("role-1");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("g1");
      expect(result[0].items).toEqual([]);
    });

    it("a top-level link whose page is not visible is omitted", async () => {
      MenuGroup.findAll.mockResolvedValueOnce([{ id: "g1", name: "Leaf", icon: "i", slug: "leaf", sortOrder: 1 }]);

      expect(await getRoleMenuAssignments("role-1")).toEqual([]);
    });
  });

  // ================================================================
  // 3-LEVEL NESTING (group → sub-group category → item)
  // ================================================================
  describe("three-level menus", () => {
    // Management → Organization → Tenants, mirroring the seeded shape.
    const threeLevelTree = () => [
      {
        id: "management",
        name: "Management",
        icon: "Settings",
        slug: "management",
        sortOrder: 3,
        children: [
          {
            id: "sub-org",
            name: "Organization",
            icon: "Building2",
            slug: "mgmt-organization",
            sortOrder: 0,
            children: [
              { id: "tenants", name: "Tenants", icon: "Building2", slug: "tenants", sortOrder: 0 },
              { id: "users", name: "Users", icon: "Users", slug: "users", sortOrder: 1 },
            ],
          },
          {
            id: "sub-work",
            name: "Work & Projects",
            icon: "KanbanSquare",
            slug: "mgmt-work",
            sortOrder: 1,
            children: [
              { id: "kanban", name: "Kanban Boards", icon: "KanbanSquare", slug: "kanban", sortOrder: 0 },
            ],
          },
        ],
      },
    ];

    it("requests grandchildren from the database", async () => {
      MenuGroup.findAll.mockResolvedValueOnce([]);

      await listMenuGroups(null);

      const query = MenuGroup.findAll.mock.calls[0][0];
      expect(query.include[0].as).toBe("children");
      expect(query.include[0].include[0].as).toBe("children");
      expect(query.include[0].include[0].where).toEqual({ isActive: true });
      expect(query.order).toHaveLength(3);
    });

    it("formats nested items recursively so a sub-group carries its own items", async () => {
      MenuGroup.findAll.mockResolvedValueOnce(threeLevelTree());

      const [management] = await listMenuGroups(null);

      expect(management.items.map((i) => i.id)).toEqual(["sub-org", "sub-work"]);
      expect(management.items[0].items.map((i) => i.id)).toEqual(["tenants", "users"]);
      expect(management.items[0].items[0].path).toBe("/dashboard/tenants");
      // Leaves carry no nested items key
      expect(management.items[0].items[0].items).toBeUndefined();
    });

    it("sorts sub-group items by sortOrder", async () => {
      const tree = threeLevelTree();
      tree[0].children[0].children.reverse();
      MenuGroup.findAll.mockResolvedValueOnce(tree);

      const [management] = await listMenuGroups(null);

      expect(management.items[0].items.map((i) => i.id)).toEqual(["tenants", "users"]);
    });

    it("annotates isAssigned at every depth", async () => {
      MenuGroup.findAll.mockResolvedValueOnce(threeLevelTree());
      RoleMenuPermission.findAll.mockResolvedValueOnce([
        { menuGroupId: "sub-org" },
        { menuGroupId: "tenants" },
      ]);

      const [management] = await listMenuGroups("role-1");

      expect(management.isAssigned).toBe(false);
      expect(management.items[0].isAssigned).toBe(true);
      expect(management.items[0].items[0].isAssigned).toBe(true);
      expect(management.items[0].items[1].isAssigned).toBe(false);
    });

    describe("getRoleMenuAssignments at depth 3", () => {
      it("shows each visible leaf under its sub-group and top group", async () => {
        MenuGroup.findAll.mockResolvedValueOnce(threeLevelTree());
        mockVisible.add("tenants").add("users").add("kanban");

        const result = await getRoleMenuAssignments("role-1");

        expect(result).toHaveLength(1);
        expect(result[0].items.map((i) => i.id)).toEqual(["sub-org", "sub-work"]);
        expect(result[0].items[0].items.map((i) => i.id)).toEqual(["tenants", "users"]);
        expect(result[0].items[1].items.map((i) => i.id)).toEqual(["kanban"]);
      });

      it("prunes a sub-group with no visible leaf", async () => {
        MenuGroup.findAll.mockResolvedValueOnce(threeLevelTree());
        mockVisible.add("kanban");

        const result = await getRoleMenuAssignments("role-1");

        expect(result[0].items.map((i) => i.id)).toEqual(["sub-work"]);
        expect(result[0].items[0].items.map((i) => i.id)).toEqual(["kanban"]);
      });

      it("shows one leaf of a sub-group without its siblings", async () => {
        MenuGroup.findAll.mockResolvedValueOnce(threeLevelTree());
        mockVisible.add("users");

        const result = await getRoleMenuAssignments("role-1");

        expect(result[0].items.map((i) => i.id)).toEqual(["sub-org"]);
        expect(result[0].items[0].items.map((i) => i.id)).toEqual(["users"]);
      });

      it("drops the whole group when no leaf is visible", async () => {
        MenuGroup.findAll.mockResolvedValueOnce(threeLevelTree());
        mockVisible.add("management").add("sub-org");

        expect(await getRoleMenuAssignments("role-1")).toEqual([]);
      });
    });
  });

  describe("updateMenuGroup explicit name/slug/icon", () => {
    it("applies name, slug and icon when they are supplied", async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      MenuGroup.findByPk.mockResolvedValueOnce({
        id: "g1",
        name: "Old",
        slug: "old",
        icon: "old-icon",
        parentId: null,
        sortOrder: 1,
        isActive: true,
        update,
      });

      await updateMenuGroup({
        id: "g1",
        name: "New",
        slug: "new",
        icon: "new-icon",
      });

      expect(update).toHaveBeenCalledWith({
        name: "New",
        slug: "new",
        icon: "new-icon",
        parentId: null,
        sortOrder: 1,
        isActive: true,
      }, { transaction: "TX" });
    });
  });
});
