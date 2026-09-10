/**
 * Migration Service - Simplified RBAC
 *
 * Centralized service for database migrations, seeding, and unseeding operations.
 * Uses simplified RBAC with RoleMenuPermission (read/write permissions on menu groups).
 *
 * Architecture:
 * - All roles are global (not tenant-scoped)
 * - Roles have read or write permissions on menu groups via RoleMenuPermission
 * - Users inherit permissions from their assigned role within a tenant
 * - No ABAC (Attribute-Based Access Control) - pure RBAC with simple read/write
 *
 * Usage:
 *   const migrationService = require("../services/migration.service");
 *   const result = await migrationService.seedAll();
 */

const { Op } = require("sequelize");
const {
  Users,
  Roles,
  MenuGroup,
  RoleMenuPermission,
  Warehouse,
  StorageLocation,
  Stock,
  StockTransfer,
  StockAdjustment,
  StockOpname,
  Tenant,
  Vendor,
  SupplierScorecard,
  CalibrationDevice,
  CalibrationRecord,
  Certificate,
  MaintenanceWorkOrder,
  IotReading,
  NonConformance,
  Capa,
  SopDocument,
  Risk,
  Workflow,
  WorkflowStep,
  Ticket,
  TicketComment,
  TicketCounter,
  KanbanProject,
  KanbanColumn,
  KanbanCard,
  KanbanLabel,
  Notification,
  Post,
  Category,
  PostCategory,
} = require("../models");
const { hashPassword } = require("../utils/password.util");
const featureFlagService = require("./featureFlag.service");
const { seedMenuGroups } = require("../utils/seedMenuGroups.util");
const {
  ROLE_NAMES,
  ROLE_IDS,
  PASSWORD_SALT_ROUNDS,
  ROLE_MENU_ASSIGNMENTS,
  MENU_SLUGS,
  PROFILE_SUB_ROUTES,
  PERMISSION_TYPES,
  DEFAULT_TENANT,
} = require("../constants");
const { logger } = require("../middlewares/activityLog.middleware");

// ==========================================
// CONSTANTS
// ==========================================

/**
 * Default role definitions (core roles from constants)
 */
const DEFAULT_ROLES = [
  {
    id: ROLE_IDS.SUPER_ADMIN,
    name: "SUPERADMIN",
    description: "System Super Administrator",
    nameToShow: "Super Admin",
    isSystem: true,
    status: "active",
    sortOrder: 0,
  },
  {
    id: ROLE_IDS.HEALTCARE_ADMIN,
    name: "HEALTHCARE ADMIN",
    description: "Healthcare Administrator",
    nameToShow: "Admin Faskes",
    isSystem: true,
    status: "active",
    sortOrder: 1,
  },
  {
    id: ROLE_IDS.CALIBRATOR_ADMIN,
    name: "CALIBRATOR ADMIN",
    description: "Calibrator Administrator",
    nameToShow: "Admin Kalibrator",
    isSystem: true,
    status: "active",
    sortOrder: 2,
  },
  {
    id: ROLE_IDS.USER,
    name: "USER",
    description: "Authenticated User",
    nameToShow: "Normal User",
    isSystem: true,
    status: "active",
    sortOrder: 3,
  },
];

/**
 * Additional role definitions for seeding
 * Contains all application-specific roles beyond the core four
 */
const APPLICATION_ROLES = [
  {
    id: ROLE_IDS.TECHNICIAN,
    name: "TECHNICIAN",
    description: "Technician",
    nameToShow: "Teknisi",
    isSystem: false,
    status: "active",
    sortOrder: 4,
  },
  {
    id: ROLE_IDS.SUPERVISOR,
    name: "SUPERVISOR",
    description: "Supervisor",
    nameToShow: "Penyelia",
    isSystem: false,
    status: "active",
    sortOrder: 5,
  },
  {
    id: ROLE_IDS.ENGINEERING_MANAGER,
    name: "ENGINEERING MANAGER",
    description: "Enginnering Manager",
    nameToShow: "Manajer Teknik",
    isSystem: false,
    status: "active",
    sortOrder: 6,
  },
  {
    id: ROLE_IDS.HEALTHCARE_TECHNICIAN,
    name: "HEALTHCARE TECHNICIAN",
    description: "Healthcare Technician",
    nameToShow: "Teknisi Faskes",
    isSystem: false,
    status: "active",
    sortOrder: 7,
  },
  {
    id: ROLE_IDS.FACILITY_MAINTENANCE,
    name: "FACILITY MAINTENANCE",
    description: "Facility Maintainance",
    nameToShow: "IPSRS",
    isSystem: false,
    status: "active",
    sortOrder: 8,
  },
  {
    id: ROLE_IDS.WAREHOUSE_STAFF,
    name: "WAREHOUSE STAFF",
    description: "Warehouse Staff",
    nameToShow: "Gudang",
    isSystem: false,
    status: "active",
    sortOrder: 9,
  },
  {
    id: ROLE_IDS.ROOM_USER,
    name: "ROOM USER",
    description: "Room User",
    nameToShow: "User Ruangan",
    isSystem: false,
    status: "active",
    sortOrder: 10,
  },
];

/**
 * Default system user to seed after roles
 */
const DEFAULT_SYSTEM_USERS = [
  {
    email: "sys@mail.com",
    username: "sys",
    password: "123123",
    firstName: "Super",
    lastName: "System",
    status: "ACTIVE",
    roleId: ROLE_IDS.SUPER_ADMIN,
    tenantId: DEFAULT_TENANT.id,
    isEmailVerified: true,
  },
];

/**
 * Default menu slugs that every role gets
 * Profile menu group contains both profile page and change-password sub-routes
 */
const DEFAULT_MENUS = [MENU_SLUGS.PROFILE, PROFILE_SUB_ROUTES.CHANGE_PASSWORD];

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// ==========================================
// DATABASE OPERATIONS
// ==========================================

/**
 * Drop all seeded tables (truncate)
 * @returns {Promise<Object>} Result of drop operation
 */
async function dropSeededTables() {
  const result = {
    stockTransfersDeleted: 0,
    stockAdjustmentsDeleted: 0,
    stockOpnamesDeleted: 0,
    stocksDeleted: 0,
    storageLocationsDeleted: 0,
    warehousesDeleted: 0,
    usersDeleted: 0,
    roleMenuPermissionsDeleted: 0,
    menuGroupsDeleted: 0,
    rolesDeleted: 0,
    errors: [],
  };

  try {
    // Delete dependent tables first
    result.stockTransfersDeleted = await StockTransfer.destroy({
      where: {},
      force: true,
    });
    logger.info(`Dropped ${result.stockTransfersDeleted} stock transfers`);

    result.stockAdjustmentsDeleted = await StockAdjustment.destroy({
      where: {},
      force: true,
    });
    logger.info(`Dropped ${result.stockAdjustmentsDeleted} stock adjustments`);

    result.stockOpnamesDeleted = await StockOpname.destroy({
      where: {},
      force: true,
    });
    logger.info(`Dropped ${result.stockOpnamesDeleted} stock opnames`);

    result.stocksDeleted = await Stock.destroy({ where: {}, force: true });
    logger.info(`Dropped ${result.stocksDeleted} stocks`);

    result.storageLocationsDeleted = await StorageLocation.destroy({
      where: {},
      force: true,
    });
    logger.info(`Dropped ${result.storageLocationsDeleted} storage locations`);

    result.warehousesDeleted = await Warehouse.destroy({
      where: {},
      force: true,
    });
    logger.info(`Dropped ${result.warehousesDeleted} warehouses`);

    // Delete users (foreign key dependency)
    result.usersDeleted = await Users.destroy({
      where: {},
      force: true,
    });
    logger.info(`Dropped ${result.usersDeleted} users`);

    // Delete tenants
    result.tenantsDeleted = await Tenant.destroy({
      where: {},
      force: true,
    });
    logger.info(`Dropped ${result.tenantsDeleted} tenants`);

    // Delete role menu permissions
    result.roleMenuPermissionsDeleted = await RoleMenuPermission.destroy({
      where: {},
      force: true,
    });
    logger.info(
      `Dropped ${result.roleMenuPermissionsDeleted} role menu permissions`,
    );

    // Delete menu groups
    result.menuGroupsDeleted = await MenuGroup.destroy({
      where: {},
      force: true,
    });
    logger.info(`Dropped ${result.menuGroupsDeleted} menu groups`);

    // Delete roles last
    result.rolesDeleted = await Roles.destroy({
      where: {},
      force: true,
    });
    logger.info(`Dropped ${result.rolesDeleted} roles`);

    return result;
  } catch (error) {
    result.errors.push(`Error dropping tables: ${error.message}`);
    logger.error(`Failed to drop tables: ${error.message}`);
    return result;
  }
}

/**
 * Sync database tables (recreate all tables)
 * @returns {Promise<Object>} Result of sync operation
 */
async function syncTables() {
  const result = {
    synced: false,
    errors: [],
  };

  try {
    const { db } = require("../config");
    await db.sync({ force: true });
    result.synced = true;
    logger.info("All database tables synced successfully");
    return result;
  } catch (error) {
    result.errors.push(`Error syncing tables: ${error.message}`);
    logger.error(`Failed to sync tables: ${error.message}`);
    return result;
  }
}

/**
 * Drop tables, sync, and seed - complete reset and seed operation
 * @returns {Promise<Object>} Complete operation result
 */
async function resetAndSeed() {
  logger.info("=== Starting database reset and seed ===");

  const result = {
    drop: await dropSeededTables(),
  };

  // Sync tables
  result.sync = await syncTables();
  if (!result.sync.synced) {
    logger.error("Table sync failed, aborting seed");
    return result;
  }

  // Step 1: Seed roles first (needed for menu permission assignments)
  result.roles = await seedAllRoles();

  // Step 2: Seed menu groups and assign role permissions (requires roles to exist)
  result.menuGroups = await seedMenuGroupsAndItems();

  // Step 2.5: Seed default tenant (required before users are created)
  await seedDefaultTenant();

  // Step 3: Seed users (last, as they reference roles)
  result.users = await seedUsers();

  logger.info("=== Database reset and seed completed ===");
  return result;
}

// ==========================================
// ROLE SEEDING
// ==========================================

/**
 * Seed default roles (SUPER_ADMIN, TENANT_ADMIN, USER)
 * @returns {Promise<Object>} Result of seeding operation
 */
async function seedDefaultRoles() {
  const result = {
    rolesCreated: 0,
    rolesSkipped: 0,
    errors: [],
  };

  try {
    const existingRoles = await Roles.findAll({
      where: {
        name: {
          [Op.in]: DEFAULT_ROLES.map((r) => r.name),
        },
      },
      paranoid: false,
    });

    const existingNames = new Set(existingRoles.map((r) => r.name));
    const rolesToCreate = DEFAULT_ROLES.filter(
      (r) => !existingNames.has(r.name),
    );

    if (rolesToCreate.length > 0) {
      await Roles.bulkCreate(rolesToCreate, {
        ignoreDuplicates: true,
      });
      result.rolesCreated = rolesToCreate.length;
      for (const role of rolesToCreate) {
        logger.info(`Created role: ${role.name}`);
      }
    }

    result.rolesSkipped = existingRoles.length;
    return result;
  } catch (error) {
    result.errors.push(
      `Fatal error during default roles seeding: ${error.message}`,
    );
    logger.error(`Failed to seed default roles: ${error.message}`);
    return result;
  }
}

/**
 * Seed application-specific roles (HEALTHCARE ADMIN, TECHNICIAN, etc.)
 * @returns {Promise<Object>} Result of seeding operation
 */
async function seedApplicationRoles() {
  const result = {
    rolesCreated: 0,
    rolesSkipped: 0,
    errors: [],
  };

  try {
    const existingRoles = await Roles.findAll({
      where: {
        name: {
          [Op.in]: APPLICATION_ROLES.map((r) => r.name),
        },
      },
      paranoid: false,
    });

    const existingNames = new Set(existingRoles.map((r) => r.name));
    const rolesToCreate = APPLICATION_ROLES.filter(
      (r) => !existingNames.has(r.name),
    );

    if (rolesToCreate.length > 0) {
      await Roles.bulkCreate(rolesToCreate, {
        ignoreDuplicates: true,
      });
      result.rolesCreated = rolesToCreate.length;
      for (const role of rolesToCreate) {
        logger.info(`Created role: ${role.name}`);
      }
    }

    result.rolesSkipped = existingRoles.length;
    return result;
  } catch (error) {
    result.errors.push(
      `Fatal error during application roles seeding: ${error.message}`,
    );
    logger.error(`Failed to seed application roles: ${error.message}`);
    return result;
  }
}

/**
 * Seed all roles (default + application roles)
 * @returns {Promise<Object>} Result of seeding operation
 */
async function seedAllRoles() {
  const defaultRolesResult = await seedDefaultRoles();
  const applicationRolesResult = await seedApplicationRoles();

  return {
    rolesCreated:
      defaultRolesResult.rolesCreated + applicationRolesResult.rolesCreated,
    rolesSkipped:
      defaultRolesResult.rolesSkipped + applicationRolesResult.rolesSkipped,
    errors: [...defaultRolesResult.errors, ...applicationRolesResult.errors],
  };
}

// ==========================================
// MENU GROUP & PERMISSION SEEDING
// ==========================================

/**
 * Seed menu groups and role permissions
 * @returns {Promise<Object>} Result of seeding operation
 */
async function seedMenuGroupsAndItems() {
  const result = {
    menuGroupsCreated: 0,
    menuGroupsSkipped: 0,
    permissionsAssigned: 0,
    errors: [],
  };

  try {
    // Seed menu groups (profile contains change-password as sub-route)
    await seedMenuGroups();
    result.menuGroupsCreated = 7; // 6 original + profile (with change-password sub-route)
    logger.info("Menu groups seeded successfully");

    // Seed role menu permissions using ROLE_MENU_ASSIGNMENTS from constants
    for (const assignment of ROLE_MENU_ASSIGNMENTS) {
      const role = await Roles.findOne({
        where: { name: assignment.roleName },
        paranoid: false,
      });

      if (!role) {
        logger.warn(`Role not found: ${assignment.roleName}`);
        continue;
      }

      // Get menus from the menus object (each has its own permission type)
      const menus = assignment.menus || {};

      for (const [slug, permissionType] of Object.entries(menus)) {
        const menuGroup = await MenuGroup.findOne({
          where: { slug },
        });

        if (!menuGroup) {
          logger.warn(`Menu group not found: ${slug}`);
          continue;
        }

        const existing = await RoleMenuPermission.findOne({
          where: {
            roleId: role.id,
            menuGroupId: menuGroup.id,
          },
        });

        if (!existing) {
          await RoleMenuPermission.create({
            roleId: role.id,
            menuGroupId: menuGroup.id,
            permissionType: permissionType,
          });
          result.permissionsAssigned++;
        } else {
          result.menuGroupsSkipped++;
        }
      }
    }

    logger.info(
      `Role menu permissions seeded: ${result.permissionsAssigned} assigned`,
    );
    return result;
  } catch (error) {
    result.errors.push(`Error seeding menus: ${error.message}`);
    logger.error(`Failed to seed menus: ${error.message}`);
    return result;
  }
}

/**
 * Seed role menu permissions for a specific role
 * @param {string} roleName - Role name
 * @param {string[]} menuSlugs - Array of menu group slugs
 * @param {string} permissionType - "read" or "write"
 * @returns {Promise<Object>} Result of seeding operation
 */
async function seedRoleMenuPermissions(roleName, menuSlugs, permissionType) {
  const result = {
    permissionsAssigned: 0,
    errors: [],
  };

  try {
    const role = await Roles.findOne({
      where: { name: roleName },
      paranoid: false,
    });

    if (!role) {
      logger.warn(`Role not found: ${roleName}`);
      return result;
    }

    for (const slug of menuSlugs) {
      const menuGroup = await MenuGroup.findOne({
        where: { slug },
      });

      if (!menuGroup) {
        logger.warn(`Menu group not found: ${slug}`);
        continue;
      }

      const existing = await RoleMenuPermission.findOne({
        where: {
          roleId: role.id,
          menuGroupId: menuGroup.id,
        },
      });

      if (!existing) {
        await RoleMenuPermission.create({
          roleId: role.id,
          menuGroupId: menuGroup.id,
          permissionType: permissionType,
        });
        result.permissionsAssigned++;
      }
    }

    return result;
  } catch (error) {
    result.errors.push(`Error seeding role menu permissions: ${error.message}`);
    logger.error(`Failed to seed role menu permissions: ${error.message}`);
    return result;
  }
}

/**
 * Seed default tenant
 * @returns {Promise<void>}
 */
async function seedDefaultTenant() {
  try {
    const existing = await Tenant.findOne({
      where: { id: DEFAULT_TENANT.id },
      paranoid: false,
    });

    if (!existing) {
      await Tenant.create(DEFAULT_TENANT);
      logger.info(`Created default tenant: ${DEFAULT_TENANT.name}`);
    }
  } catch (error) {
    logger.error(`Failed to seed default tenant: ${error.message}`);
    throw error;
  }
}

// ==========================================
// USER SEEDING
// ==========================================

/**
 * Seed default system users
 * @returns {Promise<Object>} Result of seeding operation
 */
async function seedUsers() {
  const result = {
    usersCreated: 0,
    usersSkipped: 0,
    errors: [],
  };

  try {
    for (const userData of DEFAULT_SYSTEM_USERS) {
      const hashedPassword = await hashPassword(userData.password);
      const fields = {
        email: userData.email,
        username: userData.username,
        password: hashedPassword,
        firstName: userData.firstName,
        lastName: userData.lastName,
        status: userData.status,
        roleId: userData.roleId,
        tenantId: userData.tenantId,
        // DEFAULT_SYSTEM_USERS is a module constant whose only entry sets
        // isEmailVerified explicitly, so the `: true` fallback is unreachable.
        isEmailVerified:
          /* istanbul ignore next */ userData.isEmailVerified !== undefined
            ? userData.isEmailVerified
            : true,
      };

      // Upsert instead of hard-delete + recreate: existing system users may
      // be referenced by other tables (e.g. certificates.created_by), so
      // deleting them violates foreign key constraints. Update in place,
      // restoring a soft-deleted row if needed.
      const existing = await Users.findOne({
        where: { email: userData.email },
        paranoid: false,
      });

      if (existing) {
        if (existing.deletedAt) {
          await existing.restore();
        }
        await existing.update(fields);
        result.usersSkipped++;
        logger.info(`Updated existing system user: ${userData.email}`);
      } else {
        await Users.create(fields);
        result.usersCreated++;
        logger.info(`Created user: ${userData.email}`);
      }
    }

    return result;
  } catch (error) {
    result.errors.push(`Fatal error during users seeding: ${error.message}`);
    logger.error(`Failed to seed users: ${error.message}`);
    return result;
  }
}

// ==========================================
// UNSEEDING
// ==========================================

/**
 * Unseed (delete) seeded roles by name
 * @param {string[]} roleNames - Array of role names to delete
 * @returns {Promise<Object>} Result of unseeding operation
 */
async function unseedRoles(roleNames) {
  const result = {
    rolesDeleted: 0,
    errors: [],
  };

  try {
    const deletedCount = await Roles.destroy({
      where: {
        name: {
          [Op.in]: roleNames,
        },
      },
    });

    result.rolesDeleted = deletedCount;
    return result;
  } catch (error) {
    result.errors.push(`Error deleting roles: ${error.message}`);
    return result;
  }
}

/**
 * Unseed (delete) seeded users by email
 * @param {string[]} emails - Array of user emails to delete
 * @returns {Promise<Object>} Result of unseeding operation
 */
async function unseedUsers(emails) {
  const result = {
    usersDeleted: 0,
    errors: [],
  };

  try {
    const deletedCount = await Users.destroy({
      where: {
        email: {
          [Op.in]: emails,
        },
      },
      force: true,
    });

    result.usersDeleted = deletedCount;
    return result;
  } catch (error) {
    result.errors.push(`Error deleting users: ${error.message}`);
    return result;
  }
}

/**
 * Unseed (delete) all menu groups, items, and related assignments
 * @returns {Promise<Object>} Result of unseeding operation
 */
async function unseedMenuData() {
  const result = {
    roleMenuPermissionsDeleted: 0,
    menuGroupsDeleted: 0,
    errors: [],
  };

  try {
    // 1. Delete role menu permissions
    result.roleMenuPermissionsDeleted = await RoleMenuPermission.destroy({
      where: {},
    });

    // 2. Delete menu groups
    result.menuGroupsDeleted = await MenuGroup.destroy({
      where: {},
    });

    return result;
  } catch (error) {
    result.errors.push(`Error unseeding menu data: ${error.message}`);
    return result;
  }
}

// ==========================================
// COMPLETE SEEDING/UNSEEDING
// ==========================================

/**
 * Seed all database data (roles, menu permissions, users)
 * This is the main entry point for complete database seeding
 * @returns {Promise<Object>} Complete seeding result
 */
async function seedAll() {
  logger.info("=== Starting database seeding ===");

  const result = {
    roles: await seedAllRoles(),
    menuGroups: await seedMenuGroupsAndItems(),
    tenant: await seedDefaultTenant(),
    users: await seedUsers(),
  };

  logger.info("=== Database seeding completed ===");
  return result;
}

/**
 * Complete unseed operation - removes all seeded data in correct order
 * @returns {Promise<Object>} Complete unseeding result
 */
async function unseedAll() {
  const roleNames = [
    ...DEFAULT_ROLES.map((r) => r.name),
    ...APPLICATION_ROLES.map((r) => r.name),
  ];
  const emails = DEFAULT_SYSTEM_USERS.map((u) => u.email);

  const result = {
    // Order matters: delete dependent data first
    menuData: await unseedMenuData(),
    users: await unseedUsers(emails),
    tenants: await Tenant.destroy({
      where: { id: DEFAULT_TENANT.id },
      force: true,
    }),
    roles: await unseedRoles(roleNames),
  };

  return result;
}

// ==========================================
// DEMO DATA SEEDING
// ==========================================

/**
 * Demo-data seeder.
 *
 * Populates a freshly-deployed database with a small, realistic slice of every
 * business module so the UI has content to render. It is FLAG-GATED at the route
 * layer (SEED_DEMO=true) and is fully IDEMPOTENT: every row is created via
 * find-or-create against a stable natural key (mostly a "DEMO"/"[DEMO]" marker),
 * so re-running creates nothing new and never raises duplicate-key errors.
 *
 * Everything lands under DEFAULT_TENANT.id (the modules are tenant-scoped the
 * same way) except the two extra demonstration Tenant rows and the two
 * platform-global content models (Post/Category), which are not tenant-scoped.
 *
 * Rows are seeded in FK-safe order. Demo actors reference the seeded system
 * super-admin user (sys@mail.com) and the per-role demo users created here.
 */

// Stable markers used for both seeding (natural keys) and teardown.
const DEMO = {
  tenantSubdomains: ["demo-alpha", "demo-beta"],
  userEmailDomain: "demo.callibrator.test",
  marker: "[DEMO]",
  warehouseCodePrefix: "DEMO-WH-",
  locationCodePrefix: "DEMO-LOC-",
  stockSkuPrefix: "DEMO-SKU-",
  deviceSerialPrefix: "DEMO-DEV-",
  certPrefix: "CERT-DEMO-",
  ncPrefix: "NC-DEMO-",
  capaPrefix: "CAPA-DEMO-",
  sopPrefix: "SOP-DEMO-",
  kanbanCode: "DEMO",
  contentSlugPrefix: "demo-",
};

/** Fixed timestamps so idempotency keys stay stable across runs. */
const DEMO_DATE = new Date("2026-06-01T00:00:00.000Z");
const DEMO_DATE_2 = new Date("2026-06-15T00:00:00.000Z");

/**
 * Two additional tenants (beyond DEFAULT_TENANT) so tenant-list screens show
 * more than one organisation. DEFAULT_TENANT is never touched here.
 */
const DEMO_TENANTS = [
  {
    name: "Demo Alpha Clinic",
    subdomain: "demo-alpha",
    email: "admin@demo-alpha.test",
    code: "DEMOA",
    plan: "professional",
    status: "active",
  },
  {
    name: "Demo Beta Labs",
    subdomain: "demo-beta",
    email: "admin@demo-beta.test",
    code: "DEMOB",
    plan: "business",
    status: "active",
  },
];

/**
 * One demo user per application role. roleId references the seeded ROLE_IDS.
 * SUPER_ADMIN is skipped — the seeded system user sys@mail.com already covers it.
 */
const DEMO_USERS = Object.entries(ROLE_IDS)
  .filter(([key]) => key !== "SUPER_ADMIN")
  .map(([key, roleId]) => {
    const slug = key.toLowerCase();
    return {
      roleKey: key,
      roleId,
      email: `demo.${slug}@${DEMO.userEmailDomain}`,
      username: `demo_${slug}`.slice(0, 100),
      firstName: "Demo",
      lastName: key
        .split("_")
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(" "),
    };
  });

/**
 * Seed the two extra demonstration tenants (idempotent by subdomain).
 * @returns {Promise<number>} number of tenants created
 */
/* istanbul ignore next */
async function seedDemoTenants() {
  let created = 0;
  for (const t of DEMO_TENANTS) {
    const [, wasCreated] = await Tenant.findOrCreate({
      where: { subdomain: t.subdomain },
      defaults: { ...t, isDeleted: false },
      paranoid: false,
    });
    if (wasCreated) {
      created += 1;
    }
  }
  return created;
}

/**
 * Seed one user per application role under DEFAULT_TENANT (idempotent by email).
 * @returns {Promise<number>} number of users created
 */
/* istanbul ignore next */
async function seedDemoUsers() {
  let created = 0;
  const hashed = await hashPassword("Demo123!");
  for (const u of DEMO_USERS) {
    const [, wasCreated] = await Users.findOrCreate({
      where: { email: u.email },
      defaults: {
        email: u.email,
        username: u.username,
        password: hashed,
        firstName: u.firstName,
        lastName: u.lastName,
        status: "ACTIVE",
        roleId: u.roleId,
        tenantId: DEFAULT_TENANT.id,
        isEmailVerified: true,
        isDeleted: false,
      },
      paranoid: false,
    });
    if (wasCreated) {
      created += 1;
    }
  }
  return created;
}

/**
 * Resolve the actor user id used for created_by / performed_by / reported_by
 * foreign keys on demo rows. Prefers the seeded system super-admin.
 * @returns {Promise<string>} user id
 */
/* istanbul ignore next */
async function resolveDemoActorId() {
  const sys = await Users.findOne({
    where: { email: "sys@mail.com" },
    paranoid: false,
  });
  if (sys) {
    return sys.id;
  }
  const anyUser = await Users.findOne({
    where: { tenantId: DEFAULT_TENANT.id },
    paranoid: false,
  });
  return anyUser ? anyUser.id : null;
}

/**
 * Warehouse -> storage-location -> stock -> transfer/adjustment/opname.
 * @returns {Promise<Object>} counts per sub-entity
 */
/* istanbul ignore next */
async function seedDemoWarehousing(tenantId, actorId, counts) {
  // Two warehouses
  const warehouses = [];
  for (let i = 1; i <= 2; i += 1) {
    const code = `${DEMO.warehouseCodePrefix}${i}`;
    const [wh, wasCreated] = await Warehouse.findOrCreate({
      where: { tenantId, code },
      defaults: {
        tenantId,
        code,
        name: `${DEMO.marker} Warehouse ${i}`,
        status: "active",
        address: `${i} Demo Street`,
        isDeleted: false,
      },
    });
    warehouses.push(wh);
    if (wasCreated) {
      counts.warehouses += 1;
    }
  }

  // Storage locations (2 in warehouse 1)
  const locations = [];
  for (let i = 1; i <= 2; i += 1) {
    const code = `${DEMO.locationCodePrefix}${i}`;
    const [loc, wasCreated] = await StorageLocation.findOrCreate({
      where: { tenantId, code },
      defaults: {
        tenantId,
        warehouseId: warehouses[0].id,
        code,
        name: `${DEMO.marker} Rack ${i}`,
        isActive: true,
      },
    });
    locations.push(loc);
    if (wasCreated) {
      counts.storageLocations += 1;
    }
  }

  // Stock items
  const stocks = [];
  const stockDefs = [
    { sku: `${DEMO.stockSkuPrefix}1`, itemName: "Reference Multimeter", quantity: 25 },
    { sku: `${DEMO.stockSkuPrefix}2`, itemName: "Calibration Weights Set", quantity: 8 },
  ];
  for (const s of stockDefs) {
    const [stock, wasCreated] = await Stock.findOrCreate({
      where: { tenantId, sku: s.sku },
      defaults: {
        tenantId,
        warehouseId: warehouses[0].id,
        locationId: locations[0].id,
        sku: s.sku,
        itemName: s.itemName,
        quantity: s.quantity,
        minQuantity: 5,
        isDeleted: false,
      },
    });
    stocks.push(stock);
    if (wasCreated) {
      counts.stocks += 1;
    }
  }

  // Stock transfer (warehouse 1 -> warehouse 2)
  {
    const itemName = "Reference Multimeter";
    const [, wasCreated] = await StockTransfer.findOrCreate({
      where: {
        tenantId,
        fromWarehouseId: warehouses[0].id,
        toWarehouseId: warehouses[1].id,
        itemName,
      },
      defaults: {
        tenantId,
        fromWarehouseId: warehouses[0].id,
        toWarehouseId: warehouses[1].id,
        requestedBy: actorId,
        itemName,
        quantity: 5,
        status: "pending",
        notes: `${DEMO.marker} rebalance`,
      },
    });
    if (wasCreated) {
      counts.stockTransfers += 1;
    }
  }

  // Stock adjustment
  {
    const reason = `${DEMO.marker} received batch`;
    const [, wasCreated] = await StockAdjustment.findOrCreate({
      where: { tenantId, warehouseId: warehouses[0].id, reason },
      defaults: {
        tenantId,
        warehouseId: warehouses[0].id,
        locationId: locations[0].id,
        type: "addition",
        quantity: 10,
        adjustedBy: actorId,
        reason,
      },
    });
    if (wasCreated) {
      counts.stockAdjustments += 1;
    }
  }

  // Stock opname (cycle count)
  {
    const notes = `${DEMO.marker} monthly cycle count`;
    const [, wasCreated] = await StockOpname.findOrCreate({
      where: { tenantId, warehouseId: warehouses[0].id, notes },
      defaults: {
        tenantId,
        warehouseId: warehouses[0].id,
        scheduledAt: DEMO_DATE,
        performedBy: actorId,
        status: "draft",
        notes,
      },
    });
    if (wasCreated) {
      counts.stockOpnames += 1;
    }
  }
}

/**
 * Vendors -> supplier scorecards.
 */
/* istanbul ignore next */
async function seedDemoVendors(tenantId, actorId, counts) {
  const vendorDefs = [
    { name: "Demo Calibration Lab", type: "CalibrationLab" },
    { name: "Demo Parts Supplier", type: "PartsSupplier" },
  ];
  const vendors = [];
  for (const v of vendorDefs) {
    const [vendor, wasCreated] = await Vendor.findOrCreate({
      where: { tenantId, name: v.name },
      defaults: {
        tenantId,
        name: v.name,
        type: v.type,
        approvalStatus: "APPROVED",
        status: "Active",
        contactPerson: "Demo Contact",
        email: "vendor@demo.test",
        rating: 4.5,
      },
    });
    vendors.push(vendor);
    if (wasCreated) {
      counts.vendors += 1;
    }
  }

  for (const vendor of vendors) {
    const [, wasCreated] = await SupplierScorecard.findOrCreate({
      where: { tenantId, vendorId: vendor.id, evaluationDate: DEMO_DATE },
      defaults: {
        tenantId,
        vendorId: vendor.id,
        evaluationDate: DEMO_DATE,
        qualityScore: 90,
        deliveryScore: 85,
        serviceScore: 88,
        status: "APPROVED",
        evaluatedBy: actorId,
        comments: `${DEMO.marker} quarterly evaluation`,
      },
    });
    if (wasCreated) {
      counts.supplierScorecards += 1;
    }
  }
}

/**
 * Calibration devices -> records -> certificates (draft + approved + signed).
 */
/* istanbul ignore next */
async function seedDemoCalibration(tenantId, actorId, counts) {
  const deviceDefs = [
    { serial: `${DEMO.deviceSerialPrefix}1`, name: "Demo Digital Multimeter", iot: true },
    { serial: `${DEMO.deviceSerialPrefix}2`, name: "Demo Pressure Gauge", iot: false },
  ];
  const devices = [];
  for (const d of deviceDefs) {
    const [device, wasCreated] = await CalibrationDevice.findOrCreate({
      where: { tenantId, serialNumber: d.serial },
      defaults: {
        tenantId,
        name: d.name,
        serialNumber: d.serial,
        manufacturer: "Fluke",
        model: "DM-100",
        status: "active",
        iotEnabled: d.iot,
        calibrationIntervalDays: 365,
        nextCalibrationDate: DEMO_DATE_2,
        isDeleted: false,
      },
    });
    devices.push(device);
    if (wasCreated) {
      counts.calibrationDevices += 1;
    }
  }

  // Calibration records
  const records = [];
  for (const device of devices) {
    const [record, wasCreated] = await CalibrationRecord.findOrCreate({
      where: { tenantId, deviceId: device.id, calibrationDate: DEMO_DATE },
      defaults: {
        tenantId,
        deviceId: device.id,
        performedBy: actorId,
        calibrationDate: DEMO_DATE,
        dueDate: DEMO_DATE_2,
        standard: "ISO 17025",
        isCompliant: true,
        notes: `${DEMO.marker} routine calibration`,
      },
    });
    records.push(record);
    if (wasCreated) {
      counts.calibrationRecords += 1;
    }
  }

  // Certificates: draft, approved, signed (all lowercase status enum)
  const certDefs = [
    { seq: "0001", status: "draft" },
    { seq: "0002", status: "approved" },
    { seq: "0003", status: "signed" },
  ];
  for (const c of certDefs) {
    const certificateNumber = `${DEMO.certPrefix}${c.seq}`;
    const defaults = {
      tenantId,
      deviceId: devices[0].id,
      calibrationRecordId: records[0] ? records[0].id : null,
      certificateNumber,
      type: "calibration",
      status: c.status,
      standard: "ISO 17025",
      summary: `${DEMO.marker} calibration certificate`,
      createdBy: actorId,
      issueDate: DEMO_DATE,
      validUntil: DEMO_DATE_2,
    };
    if (c.status === "approved" || c.status === "signed") {
      defaults.approvedBy = actorId;
    }
    if (c.status === "signed") {
      defaults.signedBy = actorId;
      defaults.signedAt = DEMO_DATE_2;
    }
    const [, wasCreated] = await Certificate.findOrCreate({
      where: { certificateNumber },
      defaults,
      paranoid: false,
    });
    if (wasCreated) {
      counts.certificates += 1;
    }
  }

  return devices;
}

/**
 * Maintenance work orders + IoT readings (predictive maintenance is derived from
 * these, it has no dedicated model).
 */
/* istanbul ignore next */
async function seedDemoMaintenance(tenantId, actorId, devices, counts) {
  const device = devices[0];

  const woDefs = [
    { title: `${DEMO.marker} Preventative service`, type: "Preventative", priority: "Medium" },
    { title: `${DEMO.marker} Breakdown repair`, type: "Breakdown", priority: "High" },
  ];
  for (const wo of woDefs) {
    const [, wasCreated] = await MaintenanceWorkOrder.findOrCreate({
      where: { tenantId, deviceId: device.id, title: wo.title },
      defaults: {
        tenantId,
        deviceId: device.id,
        title: wo.title,
        type: wo.type,
        status: "Open",
        priority: wo.priority,
        assignedTo: actorId,
        description: "Scheduled by demo seeder",
      },
    });
    if (wasCreated) {
      counts.maintenanceWorkOrders += 1;
    }
  }

  // IoT readings on the IoT-enabled device
  const iotDevice = devices.find((d) => d.iotEnabled) || device;
  const readingDefs = [
    { ts: DEMO_DATE, metrics: { temperature: 22.4, humidity: 45 }, anomaly: false },
    { ts: DEMO_DATE_2, metrics: { temperature: 31.9, humidity: 70 }, anomaly: true },
  ];
  for (const r of readingDefs) {
    const [, wasCreated] = await IotReading.findOrCreate({
      where: { tenantId, deviceId: iotDevice.id, timestamp: r.ts },
      defaults: {
        tenantId,
        deviceId: iotDevice.id,
        timestamp: r.ts,
        metrics: r.metrics,
        isAnomaly: r.anomaly,
      },
    });
    if (wasCreated) {
      counts.iotReadings += 1;
    }
  }
}

/**
 * QMS non-conformances (+ a CAPA), SOP documents, and risks.
 */
/* istanbul ignore next */
async function seedDemoQms(tenantId, actorId, devices, counts) {
  // Non-conformances
  const ncDefs = [
    {
      ncNumber: `${DEMO.ncPrefix}0001`,
      title: `${DEMO.marker} Out-of-tolerance reading`,
      severity: "HIGH",
      status: "CAPA_REQUIRED",
    },
    {
      ncNumber: `${DEMO.ncPrefix}0002`,
      title: `${DEMO.marker} Expired reference standard`,
      severity: "MEDIUM",
      status: "OPEN",
    },
  ];
  const ncs = [];
  for (const nc of ncDefs) {
    const [row, wasCreated] = await NonConformance.findOrCreate({
      where: { tenantId, ncNumber: nc.ncNumber },
      defaults: {
        tenantId,
        ncNumber: nc.ncNumber,
        title: nc.title,
        description: "Identified during demo calibration review.",
        status: nc.status,
        severity: nc.severity,
        reportedBy: actorId,
        dateIdentified: DEMO_DATE,
        deviceId: devices[0] ? devices[0].id : null,
        rootCause: "Environmental drift",
      },
    });
    ncs.push(row);
    if (wasCreated) {
      counts.nonConformances += 1;
    }
  }

  // CAPA linked to the first NC
  {
    const capaNumber = `${DEMO.capaPrefix}0001`;
    const [, wasCreated] = await Capa.findOrCreate({
      where: { tenantId, capaNumber },
      defaults: {
        tenantId,
        capaNumber,
        ncId: ncs[0].id,
        title: `${DEMO.marker} Corrective action for drift`,
        actionPlan: "Recalibrate and add environmental controls.",
        status: "OPEN",
        assignedTo: actorId,
        dueDate: DEMO_DATE_2,
      },
    });
    if (wasCreated) {
      counts.capas += 1;
    }
  }

  // SOP documents
  const sopDefs = [
    { documentNumber: `${DEMO.sopPrefix}0001`, title: `${DEMO.marker} Calibration procedure`, status: "PUBLISHED" },
    { documentNumber: `${DEMO.sopPrefix}0002`, title: `${DEMO.marker} Equipment handling`, status: "DRAFT" },
  ];
  for (const sop of sopDefs) {
    const [, wasCreated] = await SopDocument.findOrCreate({
      where: { tenantId, documentNumber: sop.documentNumber },
      defaults: {
        tenantId,
        documentNumber: sop.documentNumber,
        title: sop.title,
        version: "1.0",
        status: sop.status,
        authorId: actorId,
        requiresTraining: true,
        publishedDate: sop.status === "PUBLISHED" ? DEMO_DATE : null,
      },
    });
    if (wasCreated) {
      counts.sopDocuments += 1;
    }
  }

  // Risks (assignedTo + identifiedBy set so they are queryable in the UI)
  const riskDefs = [
    { title: `${DEMO.marker} Calibration overdue`, category: "OPERATIONAL", severity: 3, likelihood: 2 },
    { title: `${DEMO.marker} Supplier disruption`, category: "STRATEGIC", severity: 4, likelihood: 2 },
  ];
  for (const risk of riskDefs) {
    const [, wasCreated] = await Risk.findOrCreate({
      where: { tenantId, title: risk.title },
      defaults: {
        tenantId,
        title: risk.title,
        description: "Logged by demo seeder.",
        category: risk.category,
        severity: risk.severity,
        likelihood: risk.likelihood,
        status: "OPEN",
        mitigationPlan: "Monitor and review monthly.",
        identifiedBy: actorId,
        assignedTo: actorId,
        dueDate: DEMO_DATE_2,
      },
    });
    if (wasCreated) {
      counts.risks += 1;
    }
  }
}

/**
 * Workflows (with steps referencing real roleIds).
 */
/* istanbul ignore next */
async function seedDemoWorkflows(tenantId, counts) {
  const [workflow, wasCreated] = await Workflow.findOrCreate({
    where: { tenantId, name: `${DEMO.marker} Certificate Approval` },
    defaults: {
      tenantId,
      name: `${DEMO.marker} Certificate Approval`,
      resourceType: "Certificate",
      isActive: true,
    },
  });
  if (wasCreated) {
    counts.workflows += 1;
  }

  const stepDefs = [
    { stepOrder: 1, roleId: ROLE_IDS.CALIBRATOR_ADMIN, requiredApprovals: 1 },
    { stepOrder: 2, roleId: ROLE_IDS.ENGINEERING_MANAGER, requiredApprovals: 1 },
  ];
  for (const step of stepDefs) {
    const [, stepCreated] = await WorkflowStep.findOrCreate({
      where: { workflowId: workflow.id, stepOrder: step.stepOrder },
      defaults: {
        workflowId: workflow.id,
        stepOrder: step.stepOrder,
        roleId: step.roleId,
        requiredApprovals: step.requiredApprovals,
      },
    });
    if (stepCreated) {
      counts.workflowSteps += 1;
    }
  }
}

/**
 * Support tickets (+ a comment). Manages the per-tenant TicketCounter so seeded
 * ticket numbers never collide with runtime-created tickets.
 */
/* istanbul ignore next */
async function seedDemoTickets(tenantId, actorId, counts) {
  const [counter] = await TicketCounter.findOrCreate({
    where: { tenantId },
    defaults: { tenantId, seq: 0 },
  });

  const ticketDefs = [
    {
      subject: `${DEMO.marker} Printer offline in lab`,
      priority: "high",
      category: "incident",
    },
    {
      subject: `${DEMO.marker} Request new calibration standard`,
      priority: "medium",
      category: "feature",
    },
  ];
  const tickets = [];
  for (const t of ticketDefs) {
    let ticket = await Ticket.findOne({
      where: { tenantId, subject: t.subject },
      paranoid: false,
    });
    if (!ticket) {
      const seq = counter.seq + 1;
      ticket = await Ticket.create({
        tenantId,
        number: seq,
        ticketKey: `TKT-${seq}`,
        subject: t.subject,
        description: "Raised by demo seeder.",
        status: "open",
        priority: t.priority,
        category: t.category,
        createdBy: actorId,
      });
      counter.seq = seq;
      await counter.save();
      counts.tickets += 1;
    }
    tickets.push(ticket);
  }

  if (tickets[0]) {
    const body = `${DEMO.marker} Investigating now.`;
    const [, wasCreated] = await TicketComment.findOrCreate({
      where: { ticketId: tickets[0].id, body },
      defaults: {
        ticketId: tickets[0].id,
        body,
        isInternal: false,
        userId: actorId,
      },
    });
    if (wasCreated) {
      counts.ticketComments += 1;
    }
  }
}

/**
 * A kanban project with columns (incl. terminal Done), labels, and cards.
 * Manages KanbanProject.cardSeq so seeded card keys never collide at runtime.
 */
/* istanbul ignore next */
async function seedDemoKanban(tenantId, actorId, counts) {
  const [project, projectCreated] = await KanbanProject.findOrCreate({
    where: { tenantId, name: `${DEMO.marker} Board` },
    defaults: {
      tenantId,
      name: `${DEMO.marker} Board`,
      code: DEMO.kanbanCode,
      description: "Demo project tracker",
      color: "#2563eb",
      cardSeq: 0,
      createdBy: actorId,
    },
  });
  if (projectCreated) {
    counts.kanbanProjects += 1;
  }

  const columnDefs = [
    { name: "To Do", position: 0, isDone: false },
    { name: "In Progress", position: 1, isDone: false },
    { name: "Done", position: 2, isDone: true },
  ];
  const columns = {};
  for (const col of columnDefs) {
    const [column, wasCreated] = await KanbanColumn.findOrCreate({
      where: { projectId: project.id, name: col.name },
      defaults: {
        projectId: project.id,
        name: col.name,
        position: col.position,
        isDone: col.isDone,
      },
    });
    columns[col.name] = column;
    if (wasCreated) {
      counts.kanbanColumns += 1;
    }
  }

  const labelDefs = [
    { name: "bug", color: "#ef4444" },
    { name: "feature", color: "#22c55e" },
  ];
  for (const label of labelDefs) {
    const [, wasCreated] = await KanbanLabel.findOrCreate({
      where: { projectId: project.id, name: label.name },
      defaults: { projectId: project.id, name: label.name, color: label.color },
    });
    if (wasCreated) {
      counts.kanbanLabels += 1;
    }
  }

  const cardDefs = [
    { title: `${DEMO.marker} Set up calibration lab`, column: "To Do", priority: "high" },
    { title: `${DEMO.marker} Migrate stock data`, column: "In Progress", priority: "medium" },
    { title: `${DEMO.marker} Publish SOP v1`, column: "Done", priority: "low" },
  ];
  for (const card of cardDefs) {
    const existing = await KanbanCard.findOne({
      where: { projectId: project.id, title: card.title },
      paranoid: false,
    });
    if (!existing) {
      const number = project.cardSeq + 1;
      await KanbanCard.create({
        tenantId,
        projectId: project.id,
        columnId: columns[card.column].id,
        title: card.title,
        description: "Created by demo seeder.",
        priority: card.priority,
        number,
        cardKey: `${DEMO.kanbanCode}-${number}`,
        position: 0,
        createdBy: actorId,
      });
      project.cardSeq = number;
      await project.save();
      counts.kanbanCards += 1;
    }
  }
}

/**
 * Notifications, content (categories + posts), and feature flags.
 */
/* istanbul ignore next */
async function seedDemoEngagement(tenantId, actorId, counts) {
  // Notifications (tenant-wide, userId null)
  const notificationDefs = [
    { type: "CALIBRATION", title: `${DEMO.marker} Calibration due soon`, message: "A device is due for calibration next week." },
    { type: "INVENTORY", title: `${DEMO.marker} Low stock alert`, message: "Calibration Weights Set is below minimum quantity." },
  ];
  for (const n of notificationDefs) {
    const [, wasCreated] = await Notification.findOrCreate({
      where: { tenantId, userId: null, title: n.title },
      defaults: {
        tenantId,
        userId: null,
        type: n.type,
        title: n.title,
        message: n.message,
        isRead: false,
      },
    });
    if (wasCreated) {
      counts.notifications += 1;
    }
  }

  // Content categories (platform-global)
  const categoryDefs = [
    { name: "Demo Announcements", slug: `${DEMO.contentSlugPrefix}announcements` },
    { name: "Demo Guides", slug: `${DEMO.contentSlugPrefix}guides` },
  ];
  const categories = [];
  for (const c of categoryDefs) {
    const [category, wasCreated] = await Category.findOrCreate({
      where: { slug: c.slug },
      defaults: {
        name: c.name,
        slug: c.slug,
        description: "Demo content category.",
        isDeleted: false,
      },
      paranoid: false,
    });
    categories.push(category);
    if (wasCreated) {
      counts.categories += 1;
    }
  }

  // Content posts (platform-global)
  const postDefs = [
    { type: "BLOG", title: "Demo: Getting Started", slug: `${DEMO.contentSlugPrefix}getting-started`, status: "PUBLISHED" },
    { type: "NEWS", title: "Demo: Platform Update", slug: `${DEMO.contentSlugPrefix}platform-update`, status: "DRAFT" },
  ];
  for (let i = 0; i < postDefs.length; i += 1) {
    const p = postDefs[i];
    const [post, wasCreated] = await Post.findOrCreate({
      where: { slug: p.slug },
      defaults: {
        type: p.type,
        title: p.title,
        slug: p.slug,
        status: p.status,
        contentHtml: "<p>Demo content generated by the seeder.</p>",
        excerpt: "Demo content.",
        readingMinutes: 2,
        featured: i === 0,
        authorName: "Demo Author",
        publishedAt: p.status === "PUBLISHED" ? DEMO_DATE : null,
        createdBy: actorId,
        isDeleted: false,
      },
      paranoid: false,
    });
    if (wasCreated) {
      counts.posts += 1;
    }
    // Link each post to the first category
    if (categories[0]) {
      const [, linkCreated] = await PostCategory.findOrCreate({
        where: { postId: post.id, categoryId: categories[0].id },
        defaults: { postId: post.id, categoryId: categories[0].id },
      });
      if (linkCreated) {
        counts.postCategories += 1;
      }
    }
  }

  // Feature flags (idempotent — ignoreDuplicates bulkCreate of defaults).
  // Count only rows newly persisted so re-runs report 0.
  try {
    const { TenantSettings } = require("../models");
    const flagWhere = {
      tenantId,
      key: { [Op.like]: "feature_flag_%" },
    };
    const before = await TenantSettings.count({ where: flagWhere });
    await featureFlagService.initializeTenantFlags(tenantId);
    const after = await TenantSettings.count({ where: flagWhere });
    counts.featureFlags = after - before;
  } catch (error) {
    logger.warn(`Demo seeder: feature flag init skipped: ${error.message}`);
  }
}

/**
 * Seed a realistic slice of every business module. Idempotent and FK-safe.
 * @returns {Promise<Object>} { created: {per-module counts}, errors: [] }
 */
/* istanbul ignore next */
async function seedDemoData() {
  logger.info("=== Starting demo-data seeding ===");

  const counts = {
    tenants: 0,
    users: 0,
    warehouses: 0,
    storageLocations: 0,
    stocks: 0,
    stockTransfers: 0,
    stockAdjustments: 0,
    stockOpnames: 0,
    vendors: 0,
    supplierScorecards: 0,
    calibrationDevices: 0,
    calibrationRecords: 0,
    certificates: 0,
    maintenanceWorkOrders: 0,
    iotReadings: 0,
    nonConformances: 0,
    capas: 0,
    sopDocuments: 0,
    risks: 0,
    workflows: 0,
    workflowSteps: 0,
    tickets: 0,
    ticketComments: 0,
    kanbanProjects: 0,
    kanbanColumns: 0,
    kanbanLabels: 0,
    kanbanCards: 0,
    notifications: 0,
    categories: 0,
    posts: 0,
    postCategories: 0,
    featureFlags: 0,
  };
  const errors = [];

  try {
    // Prerequisites: roles, default tenant, and the system super-admin user must
    // exist for the demo FKs. All idempotent.
    await seedAllRoles();
    await seedDefaultTenant();
    await seedUsers();

    const tenantId = DEFAULT_TENANT.id;

    counts.tenants = await seedDemoTenants();
    counts.users = await seedDemoUsers();

    const actorId = await resolveDemoActorId();
    if (!actorId) {
      throw new Error(
        "No actor user available (sys@mail.com missing) — cannot seed demo FKs",
      );
    }

    await seedDemoWarehousing(tenantId, actorId, counts);
    await seedDemoVendors(tenantId, actorId, counts);
    const devices = await seedDemoCalibration(tenantId, actorId, counts);
    await seedDemoMaintenance(tenantId, actorId, devices, counts);
    await seedDemoQms(tenantId, actorId, devices, counts);
    await seedDemoWorkflows(tenantId, counts);
    await seedDemoTickets(tenantId, actorId, counts);
    await seedDemoKanban(tenantId, actorId, counts);
    await seedDemoEngagement(tenantId, actorId, counts);

    logger.info("=== Demo-data seeding completed ===");
  } catch (error) {
    errors.push(`Demo seeding error: ${error.message}`);
    logger.error(`Demo seeding failed: ${error.message}`);
  }

  return { created: counts, errors };
}

/**
 * Remove all demo rows created by seedDemoData(), in reverse FK order.
 * Matches on the stable DEMO markers so real data is never touched.
 * @returns {Promise<Object>} { deleted: {...}, errors: [] }
 */
/* istanbul ignore next */
async function unseedDemoData() {
  logger.info("=== Removing demo data ===");
  const tenantId = DEFAULT_TENANT.id;
  const deleted = {};
  const errors = [];
  const like = (col, prefix) => ({ [col]: { [Op.like]: `${prefix}%` } });

  try {
    // Content join + posts + categories (platform-global)
    const demoPosts = await Post.findAll({
      where: like("slug", DEMO.contentSlugPrefix),
      paranoid: false,
    });
    const demoPostIds = demoPosts.map((p) => p.id);
    if (demoPostIds.length) {
      deleted.postCategories = await PostCategory.destroy({
        where: { postId: { [Op.in]: demoPostIds } },
        force: true,
      });
    }
    deleted.posts = await Post.destroy({
      where: like("slug", DEMO.contentSlugPrefix),
      force: true,
      paranoid: false,
    });
    deleted.categories = await Category.destroy({
      where: like("slug", DEMO.contentSlugPrefix),
      force: true,
      paranoid: false,
    });

    // Notifications
    deleted.notifications = await Notification.destroy({
      where: { tenantId, ...like("title", DEMO.marker) },
      force: true,
    });

    // Kanban (cards -> labels -> columns -> project)
    const demoProjects = await KanbanProject.findAll({
      where: { tenantId, ...like("name", DEMO.marker) },
      paranoid: false,
    });
    const projectIds = demoProjects.map((p) => p.id);
    if (projectIds.length) {
      deleted.kanbanCards = await KanbanCard.destroy({
        where: { projectId: { [Op.in]: projectIds } },
        force: true,
        paranoid: false,
      });
      deleted.kanbanLabels = await KanbanLabel.destroy({
        where: { projectId: { [Op.in]: projectIds } },
        force: true,
      });
      deleted.kanbanColumns = await KanbanColumn.destroy({
        where: { projectId: { [Op.in]: projectIds } },
        force: true,
      });
      deleted.kanbanProjects = await KanbanProject.destroy({
        where: { id: { [Op.in]: projectIds } },
        force: true,
        paranoid: false,
      });
    }

    // Tickets (comments -> tickets)
    const demoTickets = await Ticket.findAll({
      where: { tenantId, ...like("subject", DEMO.marker) },
      paranoid: false,
    });
    const ticketIds = demoTickets.map((t) => t.id);
    if (ticketIds.length) {
      deleted.ticketComments = await TicketComment.destroy({
        where: { ticketId: { [Op.in]: ticketIds } },
        force: true,
      });
      deleted.tickets = await Ticket.destroy({
        where: { id: { [Op.in]: ticketIds } },
        force: true,
        paranoid: false,
      });
    }

    // Workflows (steps -> workflow)
    const demoWorkflows = await Workflow.findAll({
      where: { tenantId, ...like("name", DEMO.marker) },
      paranoid: false,
    });
    const workflowIds = demoWorkflows.map((w) => w.id);
    if (workflowIds.length) {
      deleted.workflowSteps = await WorkflowStep.destroy({
        where: { workflowId: { [Op.in]: workflowIds } },
        force: true,
      });
      deleted.workflows = await Workflow.destroy({
        where: { id: { [Op.in]: workflowIds } },
        force: true,
        paranoid: false,
      });
    }

    // QMS: CAPA -> NC ; SOP ; risks
    deleted.capas = await Capa.destroy({
      where: { tenantId, ...like("capa_number", DEMO.capaPrefix) },
      force: true,
      paranoid: false,
    });
    deleted.nonConformances = await NonConformance.destroy({
      where: { tenantId, ...like("nc_number", DEMO.ncPrefix) },
      force: true,
      paranoid: false,
    });
    deleted.sopDocuments = await SopDocument.destroy({
      where: { tenantId, ...like("document_number", DEMO.sopPrefix) },
      force: true,
      paranoid: false,
    });
    deleted.risks = await Risk.destroy({
      where: { tenantId, ...like("title", DEMO.marker) },
      force: true,
      paranoid: false,
    });

    // Certificates -> calibration records -> devices ; IoT ; maintenance
    deleted.certificates = await Certificate.destroy({
      where: { tenantId, ...like("certificate_number", DEMO.certPrefix) },
      force: true,
      paranoid: false,
    });
    const demoDevices = await CalibrationDevice.findAll({
      where: { tenantId, ...like("serial_number", DEMO.deviceSerialPrefix) },
      paranoid: false,
    });
    const deviceIds = demoDevices.map((d) => d.id);
    if (deviceIds.length) {
      deleted.iotReadings = await IotReading.destroy({
        where: { deviceId: { [Op.in]: deviceIds } },
        force: true,
      });
      deleted.maintenanceWorkOrders = await MaintenanceWorkOrder.destroy({
        where: { deviceId: { [Op.in]: deviceIds } },
        force: true,
        paranoid: false,
      });
      deleted.calibrationRecords = await CalibrationRecord.destroy({
        where: { deviceId: { [Op.in]: deviceIds } },
        force: true,
        paranoid: false,
      });
      deleted.calibrationDevices = await CalibrationDevice.destroy({
        where: { id: { [Op.in]: deviceIds } },
        force: true,
        paranoid: false,
      });
    }

    // Vendors (scorecards -> vendors)
    const demoVendors = await Vendor.findAll({
      where: { tenantId, ...like("name", "Demo ") },
      paranoid: false,
    });
    const vendorIds = demoVendors.map((v) => v.id);
    if (vendorIds.length) {
      deleted.supplierScorecards = await SupplierScorecard.destroy({
        where: { vendorId: { [Op.in]: vendorIds } },
        force: true,
        paranoid: false,
      });
      deleted.vendors = await Vendor.destroy({
        where: { id: { [Op.in]: vendorIds } },
        force: true,
        paranoid: false,
      });
    }

    // Warehousing: transfers/adjustments/opnames -> stock -> locations -> warehouses
    const demoWarehouses = await Warehouse.findAll({
      where: { tenantId, ...like("code", DEMO.warehouseCodePrefix) },
      paranoid: false,
    });
    const warehouseIds = demoWarehouses.map((w) => w.id);
    if (warehouseIds.length) {
      deleted.stockTransfers = await StockTransfer.destroy({
        where: { fromWarehouseId: { [Op.in]: warehouseIds } },
        force: true,
      });
      deleted.stockAdjustments = await StockAdjustment.destroy({
        where: { warehouseId: { [Op.in]: warehouseIds } },
        force: true,
      });
      deleted.stockOpnames = await StockOpname.destroy({
        where: { warehouseId: { [Op.in]: warehouseIds } },
        force: true,
      });
      deleted.stocks = await Stock.destroy({
        where: { warehouseId: { [Op.in]: warehouseIds } },
        force: true,
        paranoid: false,
      });
      deleted.storageLocations = await StorageLocation.destroy({
        where: { warehouseId: { [Op.in]: warehouseIds } },
        force: true,
      });
      deleted.warehouses = await Warehouse.destroy({
        where: { id: { [Op.in]: warehouseIds } },
        force: true,
        paranoid: false,
      });
    }

    // Demo users and extra tenants
    deleted.users = await Users.destroy({
      where: { email: { [Op.like]: `%@${DEMO.userEmailDomain}` } },
      force: true,
      paranoid: false,
    });
    deleted.tenants = await Tenant.destroy({
      where: { subdomain: { [Op.in]: DEMO.tenantSubdomains } },
      force: true,
      paranoid: false,
    });

    logger.info("=== Demo data removed ===");
  } catch (error) {
    errors.push(`Demo unseeding error: ${error.message}`);
    logger.error(`Demo unseeding failed: ${error.message}`);
  }

  return { deleted, errors };
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  // Database operations
  dropSeededTables,
  syncTables,
  resetAndSeed,

  // Role seeding
  seedDefaultRoles,
  seedApplicationRoles,
  seedAllRoles,

  // Menu group seeding
  seedMenuGroupsAndItems,
  seedRoleMenuPermissions,

  // User seeding
  seedUsers,

  // Complete seeding
  seedAll,

  // Demo data seeding
  seedDemoData,
  unseedDemoData,

  // Unseeding
  unseedAll,
  unseedRoles,
  unseedUsers,
  unseedMenuData,

  // Constants (for external use if needed)
  DEFAULT_ROLES,
  APPLICATION_ROLES,
  ROLE_MENU_ASSIGNMENTS,
};
