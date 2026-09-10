const { Op } = require("sequelize");
const bcrypt = require("bcryptjs");

jest.mock("bcryptjs", () => ({
  genSalt: jest.fn().mockResolvedValue("salt"),
  hash: jest.fn().mockResolvedValue("hashedPassword"),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../utils/seedMenuGroups.util", () => ({
  seedMenuGroups: jest.fn().mockResolvedValue(true),
}));

// src/models/index.js exports singular model names plus plural aliases; the
// migration service imports Users/Roles (aliases of User/Role) and the singular
// MenuGroup/RoleMenuPermission/Warehouse/Stock*/Tenant.
jest.mock("../../models", () => ({
  Users: {
    findOne: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
  },
  Roles: {
    findAll: jest.fn(),
    bulkCreate: jest.fn(),
    findOne: jest.fn(),
    destroy: jest.fn(),
  },
  MenuGroup: {
    findOne: jest.fn(),
    destroy: jest.fn(),
  },
  RoleMenuPermission: {
    findOne: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
  },
  Tenant: {
    findOne: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
  },
  Warehouse: { destroy: jest.fn() },
  StorageLocation: { destroy: jest.fn() },
  Stock: { destroy: jest.fn() },
  StockTransfer: { destroy: jest.fn() },
  StockAdjustment: { destroy: jest.fn() },
  StockOpname: { destroy: jest.fn() },
}));

jest.mock("../../config", () => ({
  db: { sync: jest.fn() },
}));

const {
  Users,
  Roles,
  MenuGroup,
  RoleMenuPermission,
  Tenant,
  Warehouse,
  StorageLocation,
  Stock,
  StockTransfer,
  StockAdjustment,
  StockOpname,
} = require("../../models");
const { db } = require("../../config");
const { seedMenuGroups } = require("../../utils/seedMenuGroups.util");
const migrationService = require("../../services/migration.service");

describe("migration.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("seedDefaultRoles", () => {
    it("should create all default roles if none exist", async () => {
      Roles.findAll.mockResolvedValue([]);
      Roles.bulkCreate.mockResolvedValue(true);

      const result = await migrationService.seedDefaultRoles();

      expect(Roles.findAll).toHaveBeenCalled();
      expect(Roles.bulkCreate).toHaveBeenCalled();
      expect(result.rolesCreated).toBe(migrationService.DEFAULT_ROLES.length);
      expect(result.rolesSkipped).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it("should skip existing roles", async () => {
      // Mock that the first default role already exists
      const existingRole = migrationService.DEFAULT_ROLES[0];
      Roles.findAll.mockResolvedValue([existingRole]);
      Roles.bulkCreate.mockResolvedValue(true);

      const result = await migrationService.seedDefaultRoles();

      expect(result.rolesCreated).toBe(migrationService.DEFAULT_ROLES.length - 1);
      expect(result.rolesSkipped).toBe(1);
    });

    it("should handle errors", async () => {
      Roles.findAll.mockRejectedValue(new Error("DB Error"));

      const result = await migrationService.seedDefaultRoles();

      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("DB Error");
    });

    it("should not bulkCreate when every default role already exists", async () => {
      Roles.findAll.mockResolvedValue([...migrationService.DEFAULT_ROLES]);

      const result = await migrationService.seedDefaultRoles();

      expect(Roles.bulkCreate).not.toHaveBeenCalled();
      expect(result.rolesCreated).toBe(0);
      expect(result.rolesSkipped).toBe(migrationService.DEFAULT_ROLES.length);
      expect(result.errors).toEqual([]);
    });
  });

  describe("seedApplicationRoles", () => {
    it("should create all application roles if none exist", async () => {
      Roles.findAll.mockResolvedValue([]);
      Roles.bulkCreate.mockResolvedValue(true);

      const result = await migrationService.seedApplicationRoles();

      expect(Roles.findAll).toHaveBeenCalled();
      expect(Roles.bulkCreate).toHaveBeenCalled();
      expect(result.rolesCreated).toBe(migrationService.APPLICATION_ROLES.length);
    });

    it("should handle errors", async () => {
      Roles.findAll.mockRejectedValue(new Error("DB Error"));

      const result = await migrationService.seedApplicationRoles();

      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("DB Error");
    });

    it("should skip application roles that already exist", async () => {
      const existing = migrationService.APPLICATION_ROLES.slice(0, 2);
      Roles.findAll.mockResolvedValue(existing);
      Roles.bulkCreate.mockResolvedValue(true);

      const result = await migrationService.seedApplicationRoles();

      expect(result.rolesCreated).toBe(migrationService.APPLICATION_ROLES.length - 2);
      expect(result.rolesSkipped).toBe(2);
      const created = Roles.bulkCreate.mock.calls[0][0].map((r) => r.name);
      expect(created).not.toContain(existing[0].name);
      expect(created).not.toContain(existing[1].name);
    });

    it("should not bulkCreate when every application role already exists", async () => {
      Roles.findAll.mockResolvedValue([...migrationService.APPLICATION_ROLES]);

      const result = await migrationService.seedApplicationRoles();

      expect(Roles.bulkCreate).not.toHaveBeenCalled();
      expect(result.rolesCreated).toBe(0);
      expect(result.rolesSkipped).toBe(migrationService.APPLICATION_ROLES.length);
    });
  });

  describe("seedAllRoles", () => {
    it("should combine results of default and application roles", async () => {
      Roles.findAll.mockResolvedValueOnce([]); // Default
      Roles.findAll.mockResolvedValueOnce([]); // Application
      Roles.bulkCreate.mockResolvedValue(true);

      const result = await migrationService.seedAllRoles();

      expect(result.rolesCreated).toBe(
        migrationService.DEFAULT_ROLES.length + migrationService.APPLICATION_ROLES.length,
      );
      expect(result.errors.length).toBe(0);
    });
  });

  describe("seedMenuGroupsAndItems", () => {
    it("should seed menus and permissions successfully", async () => {
      seedMenuGroups.mockResolvedValue(true);

      // For each role in assignments
      Roles.findOne.mockResolvedValue({ id: "role-id" });
      // For each menu slug
      MenuGroup.findOne.mockResolvedValue({ id: "menu-id" });
      // Not existing
      RoleMenuPermission.findOne.mockResolvedValue(null);
      RoleMenuPermission.create.mockResolvedValue(true);

      const result = await migrationService.seedMenuGroupsAndItems();

      expect(seedMenuGroups).toHaveBeenCalled();
      expect(result.menuGroupsCreated).toBe(7);
      expect(result.errors.length).toBe(0);
      expect(result.permissionsAssigned).toBeGreaterThan(0);
    });

    it("should handle missing role", async () => {
      Roles.findOne.mockResolvedValue(null);

      const result = await migrationService.seedMenuGroupsAndItems();

      expect(result.permissionsAssigned).toBe(0);
    });

    it("should handle missing menu group", async () => {
      Roles.findOne.mockResolvedValue({ id: "role-id" });
      MenuGroup.findOne.mockResolvedValue(null);

      const result = await migrationService.seedMenuGroupsAndItems();

      expect(result.permissionsAssigned).toBe(0);
    });

    it("should skip existing permissions", async () => {
      Roles.findOne.mockResolvedValue({ id: "role-id" });
      MenuGroup.findOne.mockResolvedValue({ id: "menu-id" });
      RoleMenuPermission.findOne.mockResolvedValue({ id: "perm-id" }); // exists

      const result = await migrationService.seedMenuGroupsAndItems();

      expect(result.permissionsAssigned).toBe(0);
      expect(result.menuGroupsSkipped).toBeGreaterThan(0);
    });

    it("should handle errors", async () => {
      seedMenuGroups.mockRejectedValue(new Error("Seed Menus Error"));

      const result = await migrationService.seedMenuGroupsAndItems();

      expect(result.errors.length).toBe(1);
    });
  });

  describe("seedRoleMenuPermissions", () => {
    it("should assign permissions to a role", async () => {
      Roles.findOne.mockResolvedValue({ id: "role-1" });
      MenuGroup.findOne.mockResolvedValue({ id: "menu-1" });
      RoleMenuPermission.findOne.mockResolvedValue(null);
      RoleMenuPermission.create.mockResolvedValue(true);

      const result = await migrationService.seedRoleMenuPermissions("ADMIN", ["slug1"], "read");

      expect(result.permissionsAssigned).toBe(1);
      expect(result.errors.length).toBe(0);
    });

    it("should handle role not found", async () => {
      Roles.findOne.mockResolvedValue(null);

      const result = await migrationService.seedRoleMenuPermissions("ADMIN", ["slug1"], "read");

      expect(result.permissionsAssigned).toBe(0);
    });

    it("should handle menu not found", async () => {
      Roles.findOne.mockResolvedValue({ id: "role-1" });
      MenuGroup.findOne.mockResolvedValue(null);

      const result = await migrationService.seedRoleMenuPermissions("ADMIN", ["slug1"], "read");

      expect(result.permissionsAssigned).toBe(0);
    });

    it("should skip existing permissions", async () => {
      Roles.findOne.mockResolvedValue({ id: "role-1" });
      MenuGroup.findOne.mockResolvedValue({ id: "menu-1" });
      RoleMenuPermission.findOne.mockResolvedValue({ id: "perm-1" });

      const result = await migrationService.seedRoleMenuPermissions("ADMIN", ["slug1"], "read");

      expect(result.permissionsAssigned).toBe(0);
    });

    it("should handle errors", async () => {
      Roles.findOne.mockRejectedValue(new Error("DB Error"));

      const result = await migrationService.seedRoleMenuPermissions("ADMIN", ["slug1"], "read");

      expect(result.errors.length).toBe(1);
    });
  });

  describe("seedUsers", () => {
    it("should create default users that do not exist yet", async () => {
      // Current behavior: upsert by email (paranoid:false). Non-existent users
      // are created; there is no hard-delete step (existing system users may be
      // referenced by other tables via FK, so they are updated in place).
      Users.findOne.mockResolvedValue(null);
      Users.create.mockResolvedValue(true);

      const result = await migrationService.seedUsers();

      expect(Users.create).toHaveBeenCalledWith(
        expect.objectContaining({ password: expect.any(String) }),
      );
      expect(Users.destroy).not.toHaveBeenCalled();
      expect(result.usersCreated).toBeGreaterThan(0);
      expect(result.usersSkipped).toBe(0);
    });

    it("should update (not recreate) users that already exist", async () => {
      // Existing users are updated in place — never hard-deleted — and counted
      // as skipped; a soft-deleted row is restored first.
      const existing = {
        deletedAt: null,
        update: jest.fn().mockResolvedValue(true),
        restore: jest.fn().mockResolvedValue(true),
      };
      Users.findOne.mockResolvedValue(existing);

      const result = await migrationService.seedUsers();

      expect(existing.update).toHaveBeenCalled();
      expect(Users.create).not.toHaveBeenCalled();
      expect(result.usersCreated).toBe(0);
      expect(result.usersSkipped).toBeGreaterThan(0);
    });

    it("should handle errors", async () => {
      Users.findOne.mockResolvedValue(null);
      Users.create.mockRejectedValue(new Error("DB Error"));

      const result = await migrationService.seedUsers();

      expect(result.errors.length).toBe(1);
    });
  });

  describe("unseedRoles", () => {
    it("should delete roles", async () => {
      Roles.destroy.mockResolvedValue(2);

      const result = await migrationService.unseedRoles(["r1", "r2"]);

      expect(Roles.destroy).toHaveBeenCalled();
      expect(result.rolesDeleted).toBe(2);
    });

    it("should handle errors", async () => {
      Roles.destroy.mockRejectedValue(new Error("DB Error"));

      const result = await migrationService.unseedRoles(["r1"]);

      expect(result.errors.length).toBe(1);
    });
  });

  describe("unseedUsers", () => {
    it("should delete users", async () => {
      Users.destroy.mockResolvedValue(1);

      const result = await migrationService.unseedUsers(["u1@mail.com"]);

      expect(Users.destroy).toHaveBeenCalled();
      expect(result.usersDeleted).toBe(1);
    });

    it("should handle errors", async () => {
      Users.destroy.mockRejectedValue(new Error("DB Error"));

      const result = await migrationService.unseedUsers(["u1@mail.com"]);

      expect(result.errors.length).toBe(1);
    });
  });

  describe("unseedMenuData", () => {
    it("should delete permissions and menus", async () => {
      RoleMenuPermission.destroy.mockResolvedValue(5);
      MenuGroup.destroy.mockResolvedValue(3);

      const result = await migrationService.unseedMenuData();

      expect(RoleMenuPermission.destroy).toHaveBeenCalledWith({ where: {} });
      expect(MenuGroup.destroy).toHaveBeenCalledWith({ where: {} });
      expect(result.roleMenuPermissionsDeleted).toBe(5);
      expect(result.menuGroupsDeleted).toBe(3);
    });

    it("should handle errors", async () => {
      RoleMenuPermission.destroy.mockRejectedValue(new Error("DB Error"));

      const result = await migrationService.unseedMenuData();

      expect(result.errors.length).toBe(1);
    });
  });

  describe("seedAll and unseedAll", () => {
    it("should seedAll", async () => {
      // Mock all the inner functions indirectly by letting them pass
      Roles.findAll.mockResolvedValue([]);
      Roles.bulkCreate.mockResolvedValue(true);
      seedMenuGroups.mockResolvedValue(true);
      Roles.findOne.mockResolvedValue({ id: "role-1" });
      MenuGroup.findOne.mockResolvedValue({ id: "menu-1" });
      RoleMenuPermission.findOne.mockResolvedValue(null);
      Users.findOne.mockResolvedValue(null);
      Tenant.findOne.mockResolvedValue(null);
      Tenant.create.mockResolvedValue(true);

      const result = await migrationService.seedAll();

      expect(result.roles).toBeDefined();
      expect(result.menuGroups).toBeDefined();
      expect(result.users).toBeDefined();
    });

    it("should unseedAll", async () => {
      RoleMenuPermission.destroy.mockResolvedValue(0);
      MenuGroup.destroy.mockResolvedValue(0);
      Users.destroy.mockResolvedValue(0);
      Roles.destroy.mockResolvedValue(0);
      Tenant.destroy.mockResolvedValue(0);

      const result = await migrationService.unseedAll();

      expect(result.menuData).toBeDefined();
      expect(result.users).toBeDefined();
      expect(result.roles).toBeDefined();
    });
  });

  // ==========================================
  // COVERAGE — dropSeededTables
  // ==========================================

  describe("dropSeededTables", () => {
    const allDestroyMocks = () => [
      StockTransfer.destroy,
      StockAdjustment.destroy,
      StockOpname.destroy,
      Stock.destroy,
      StorageLocation.destroy,
      Warehouse.destroy,
      Users.destroy,
      Tenant.destroy,
      RoleMenuPermission.destroy,
      MenuGroup.destroy,
      Roles.destroy,
    ];

    it("should force-delete every seeded table and report the counts", async () => {
      StockTransfer.destroy.mockResolvedValue(1);
      StockAdjustment.destroy.mockResolvedValue(2);
      StockOpname.destroy.mockResolvedValue(3);
      Stock.destroy.mockResolvedValue(4);
      StorageLocation.destroy.mockResolvedValue(5);
      Warehouse.destroy.mockResolvedValue(6);
      Users.destroy.mockResolvedValue(7);
      Tenant.destroy.mockResolvedValue(8);
      RoleMenuPermission.destroy.mockResolvedValue(9);
      MenuGroup.destroy.mockResolvedValue(10);
      Roles.destroy.mockResolvedValue(11);

      const result = await migrationService.dropSeededTables();

      expect(result).toEqual({
        stockTransfersDeleted: 1,
        stockAdjustmentsDeleted: 2,
        stockOpnamesDeleted: 3,
        stocksDeleted: 4,
        storageLocationsDeleted: 5,
        warehousesDeleted: 6,
        usersDeleted: 7,
        tenantsDeleted: 8,
        roleMenuPermissionsDeleted: 9,
        menuGroupsDeleted: 10,
        rolesDeleted: 11,
        errors: [],
      });

      for (const destroy of allDestroyMocks()) {
        expect(destroy).toHaveBeenCalledWith({ where: {}, force: true });
      }
    });

    it("should delete dependents before the roles they reference", async () => {
      const order = [];
      const track = (name) => (mock) =>
        mock.mockImplementation(async () => {
          order.push(name);
          return 0;
        });
      track("stockTransfers")(StockTransfer.destroy);
      track("stockAdjustments")(StockAdjustment.destroy);
      track("stockOpnames")(StockOpname.destroy);
      track("stocks")(Stock.destroy);
      track("storageLocations")(StorageLocation.destroy);
      track("warehouses")(Warehouse.destroy);
      track("users")(Users.destroy);
      track("tenants")(Tenant.destroy);
      track("roleMenuPermissions")(RoleMenuPermission.destroy);
      track("menuGroups")(MenuGroup.destroy);
      track("roles")(Roles.destroy);

      await migrationService.dropSeededTables();

      expect(order).toEqual([
        "stockTransfers",
        "stockAdjustments",
        "stockOpnames",
        "stocks",
        "storageLocations",
        "warehouses",
        "users",
        "tenants",
        "roleMenuPermissions",
        "menuGroups",
        "roles",
      ]);
    });

    it("should collect the error and stop when a delete fails", async () => {
      StockTransfer.destroy.mockResolvedValue(1);
      StockAdjustment.destroy.mockRejectedValue(new Error("FK violation"));

      const result = await migrationService.dropSeededTables();

      expect(result.errors).toEqual(["Error dropping tables: FK violation"]);
      expect(result.stockTransfersDeleted).toBe(1);
      // Everything after the failure is left at its initial value.
      expect(result.stockAdjustmentsDeleted).toBe(0);
      expect(result.rolesDeleted).toBe(0);
      expect(Roles.destroy).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // COVERAGE — syncTables
  // ==========================================

  describe("syncTables", () => {
    it("should force-sync the database", async () => {
      db.sync.mockResolvedValue(true);

      const result = await migrationService.syncTables();

      expect(db.sync).toHaveBeenCalledWith({ force: true });
      expect(result).toEqual({ synced: true, errors: [] });
    });

    it("should report a sync failure without throwing", async () => {
      db.sync.mockRejectedValue(new Error("connection refused"));

      const result = await migrationService.syncTables();

      expect(result).toEqual({
        synced: false,
        errors: ["Error syncing tables: connection refused"],
      });
    });
  });

  // ==========================================
  // COVERAGE — resetAndSeed
  // ==========================================

  describe("resetAndSeed", () => {
    const happyPath = () => {
      for (const m of [
        StockTransfer,
        StockAdjustment,
        StockOpname,
        Stock,
        StorageLocation,
        Warehouse,
        Users,
        Tenant,
        RoleMenuPermission,
        MenuGroup,
        Roles,
      ]) {
        m.destroy.mockResolvedValue(0);
      }
      db.sync.mockResolvedValue(true);
      Roles.findAll.mockResolvedValue([]);
      Roles.bulkCreate.mockResolvedValue(true);
      seedMenuGroups.mockResolvedValue(true);
      Roles.findOne.mockResolvedValue({ id: "role-1" });
      MenuGroup.findOne.mockResolvedValue({ id: "menu-1" });
      RoleMenuPermission.findOne.mockResolvedValue(null);
      RoleMenuPermission.create.mockResolvedValue(true);
      Tenant.findOne.mockResolvedValue(null);
      Tenant.create.mockResolvedValue(true);
      Users.findOne.mockResolvedValue(null);
      Users.create.mockResolvedValue(true);
    };

    it("should drop, sync, then seed roles, menus, the tenant and users", async () => {
      happyPath();

      const result = await migrationService.resetAndSeed();

      expect(result.drop.errors).toEqual([]);
      expect(result.sync.synced).toBe(true);
      expect(result.roles.rolesCreated).toBe(
        migrationService.DEFAULT_ROLES.length + migrationService.APPLICATION_ROLES.length,
      );
      expect(result.menuGroups.menuGroupsCreated).toBe(7);
      expect(result.users.usersCreated).toBeGreaterThan(0);
      expect(Tenant.create).toHaveBeenCalled();
    });

    it("should abort before seeding when the sync fails", async () => {
      happyPath();
      db.sync.mockRejectedValue(new Error("no database"));

      const result = await migrationService.resetAndSeed();

      expect(result.sync.synced).toBe(false);
      expect(result).not.toHaveProperty("roles");
      expect(result).not.toHaveProperty("users");
      expect(Roles.bulkCreate).not.toHaveBeenCalled();
      expect(Users.create).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // COVERAGE — default tenant seeding
  // ==========================================

  describe("seedDefaultTenant (via seedAll)", () => {
    const seedAllHappyPath = () => {
      Roles.findAll.mockResolvedValue([]);
      Roles.bulkCreate.mockResolvedValue(true);
      seedMenuGroups.mockResolvedValue(true);
      Roles.findOne.mockResolvedValue({ id: "role-1" });
      MenuGroup.findOne.mockResolvedValue({ id: "menu-1" });
      RoleMenuPermission.findOne.mockResolvedValue(null);
      RoleMenuPermission.create.mockResolvedValue(true);
      Users.findOne.mockResolvedValue(null);
      Users.create.mockResolvedValue(true);
    };

    it("should create the default tenant when it does not exist", async () => {
      seedAllHappyPath();
      Tenant.findOne.mockResolvedValue(null);
      Tenant.create.mockResolvedValue(true);

      await migrationService.seedAll();

      expect(Tenant.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ paranoid: false }),
      );
      expect(Tenant.create).toHaveBeenCalledWith(
        expect.objectContaining({ subdomain: "default" }),
      );
    });

    it("should not recreate an existing default tenant (even a soft-deleted one)", async () => {
      seedAllHappyPath();
      Tenant.findOne.mockResolvedValue({ id: "existing" });

      await migrationService.seedAll();

      expect(Tenant.create).not.toHaveBeenCalled();
    });

    it("should propagate a tenant seeding failure out of seedAll", async () => {
      seedAllHappyPath();
      Tenant.findOne.mockRejectedValue(new Error("tenant table missing"));

      await expect(migrationService.seedAll()).rejects.toThrow("tenant table missing");
    });
  });

  // ==========================================
  // COVERAGE — seedUsers restore path
  // ==========================================

  describe("seedUsers — soft-deleted rows", () => {
    it("should restore a soft-deleted system user before updating it", async () => {
      const existing = {
        deletedAt: new Date("2024-01-01"),
        restore: jest.fn().mockResolvedValue(true),
        update: jest.fn().mockResolvedValue(true),
      };
      Users.findOne.mockResolvedValue(existing);

      const result = await migrationService.seedUsers();

      expect(existing.restore).toHaveBeenCalled();
      expect(existing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "sys@mail.com",
          password: "hashedPassword",
          isEmailVerified: true,
        }),
      );
      expect(Users.create).not.toHaveBeenCalled();
      expect(result.usersSkipped).toBe(1);
      expect(result.usersCreated).toBe(0);
    });

    it("should look the user up including soft-deleted rows", async () => {
      Users.findOne.mockResolvedValue(null);
      Users.create.mockResolvedValue(true);

      await migrationService.seedUsers();

      expect(Users.findOne).toHaveBeenCalledWith({
        where: { email: "sys@mail.com" },
        paranoid: false,
      });
    });
  });

  // ==========================================
  // COVERAGE — unseedAll wiring
  // ==========================================

  describe("unseedAll — arguments", () => {
    it("should unseed every default and application role plus the default tenant", async () => {
      RoleMenuPermission.destroy.mockResolvedValue(0);
      MenuGroup.destroy.mockResolvedValue(0);
      Users.destroy.mockResolvedValue(0);
      Roles.destroy.mockResolvedValue(0);
      Tenant.destroy.mockResolvedValue(0);

      await migrationService.unseedAll();

      const expectedRoleNames = [
        ...migrationService.DEFAULT_ROLES.map((r) => r.name),
        ...migrationService.APPLICATION_ROLES.map((r) => r.name),
      ];
      expect(Roles.destroy).toHaveBeenCalledWith({
        where: { name: { [Op.in]: expectedRoleNames } },
      });
      expect(Users.destroy).toHaveBeenCalledWith({
        where: { email: { [Op.in]: ["sys@mail.com"] } },
        force: true,
      });
      expect(Tenant.destroy).toHaveBeenCalledWith({
        where: { id: expect.any(String) },
        force: true,
      });
    });
  });

  // ==========================================
  // COVERAGE — seedMenuGroupsAndItems edge cases
  // ==========================================

  describe("seedMenuGroupsAndItems — assignments without menus", () => {
    it("should tolerate an assignment whose menus map is absent", async () => {
      seedMenuGroups.mockResolvedValue(true);
      Roles.findOne.mockResolvedValue({ id: "role-1" });

      // ROLE_MENU_ASSIGNMENTS is read from constants; assignments always carry a
      // `menus` object today, so `assignment.menus || {}` short-circuits to the
      // object. Verify the loop still completes when no menu group resolves.
      MenuGroup.findOne.mockResolvedValue(null);

      const result = await migrationService.seedMenuGroupsAndItems();

      expect(result.errors).toEqual([]);
      expect(result.permissionsAssigned).toBe(0);
      expect(RoleMenuPermission.create).not.toHaveBeenCalled();
    });
  });
});
