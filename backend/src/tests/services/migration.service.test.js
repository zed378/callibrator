// P20-07: tenant creation also makes the tenant's self client facility (services/clientFacility,
// proven on memoryDb by clientFacility.service.p2007 and on PostgreSQL by clientFacilities.p2007.live).
// A fixture here: this suite is about the tenant, so the facility is a stand-in.
jest.mock("../../services/clientFacility.service", () => ({
  SELF_FACILITY_CODE: "SELF",
  selfFacilityName: (name) => name,
  createSelfFacility: jest.fn(async () => ({ id: "5e1f0000-0000-4000-8000-0000000000f0" })),
}));
const { Op } = require("sequelize");

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

// P10-16 (ADR-099): the system super admin's creation and its one-time
// password belong to bootstrapCredential.service (tested over the real models
// in services/bootstrapCredential.p1016.test.ts); here, only the delegation.
jest.mock("../../services/bootstrapCredential.service", () => ({
  ensureSystemSuperAdmin: jest.fn(),
}));

const {
  Users,
  Roles,
  MenuGroup,
  RoleMenuPermission,
  Tenant,
} = require("../../models");
const { db } = require("../../config");
const { seedMenuGroups } = require("../../utils/seedMenuGroups.util");
const migrationService = require("../../services/migration.service");
const bootstrapCredential = require("../../services/bootstrapCredential.service");

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
    it("creates the system super admin through the bootstrap service and reports the file path", async () => {
      bootstrapCredential.ensureSystemSuperAdmin.mockResolvedValue({
        created: true,
        updated: false,
        bootstrapPasswordFile: "/app/.bootstrap/superadmin-password",
      });

      const result = await migrationService.seedUsers();

      expect(bootstrapCredential.ensureSystemSuperAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ email: "sys@mail.com", username: "sys", isEmailVerified: true }),
      );
      // P10-16: the seed carries no password of its own.
      expect(bootstrapCredential.ensureSystemSuperAdmin.mock.calls[0][0]).not.toHaveProperty("password");
      expect(Users.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        usersCreated: 1,
        usersSkipped: 0,
        bootstrapPasswordFile: "/app/.bootstrap/superadmin-password",
        errors: [],
      });
    });

    it("counts an existing system user as skipped, with no file", async () => {
      bootstrapCredential.ensureSystemSuperAdmin.mockResolvedValue({
        created: false,
        updated: true,
        bootstrapPasswordFile: null,
      });

      const result = await migrationService.seedUsers();

      expect(result.usersCreated).toBe(0);
      expect(result.usersSkipped).toBe(1);
      expect(result.bootstrapPasswordFile).toBeNull();
    });

    it("should handle errors", async () => {
      bootstrapCredential.ensureSystemSuperAdmin.mockRejectedValue(new Error("DB Error"));

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
  // A-261 — dropSeededTables is gone
  // ==========================================

  // It force-deleted every stock row, user, tenant, role-menu permission,
  // menu group and role, one statement at a time and outside any transaction,
  // so a failure part-way left the platform half-erased. Nothing called it: no
  // route, controller, script or boot path (ADR-072).
  describe("A-261: no helper deletes every user and tenant", () => {
    it("is not exported", () => {
      expect(migrationService).not.toHaveProperty("dropSeededTables");
    });

    it("no application source defines or calls it", () => {
      const fs = require("fs");
      const path = require("path");
      const root = path.join(__dirname, "..", "..");
      const offenders = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== "tests") {
              walk(full);
            }
          } else if (/\.(js|ts)$/.test(entry.name) && /dropSeededTables\s*\(/.test(fs.readFileSync(full, "utf8"))) {
            offenders.push(path.relative(root, full));
          }
        }
      };
      walk(root);
      expect(offenders).toEqual([]);
    });
  });

  // ==========================================
  // A-259 — syncTables / resetAndSeed are gone
  // ==========================================

  // Since P6-03 the backend runs as the application role, which cannot drop
  // or create tables, so `db.sync({ force: true })` failed on every
  // deployment; nothing called either helper. Dropping the schema is an owner
  // operation outside the application (ADR-068).
  describe("A-259: no runtime schema reset", () => {
    it("exports neither syncTables nor resetAndSeed", () => {
      expect(migrationService).not.toHaveProperty("syncTables");
      expect(migrationService).not.toHaveProperty("resetAndSeed");
    });

    it("no application source forces a sync (only the opt-in live test harnesses do)", () => {
      const fs = require("fs");
      const path = require("path");
      const root = path.join(__dirname, "..", "..");
      const offenders = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== "tests") {
              walk(full);
            }
          } else if (/\.(js|ts)$/.test(entry.name) && /sync\(\s*\{\s*force:\s*true/.test(fs.readFileSync(full, "utf8"))) {
            offenders.push(path.relative(root, full));
          }
        }
      };
      walk(root);
      expect(offenders).toEqual([]);
      expect(db.sync).not.toHaveBeenCalled();
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
