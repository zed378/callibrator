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

// P9-18 (ADR-087): converted from migration.service.js, behaviour unchanged
// (its interim `.d.ts` is deleted with it). The export is the same object, its
// keys in the JavaScript's order. What the JavaScript destructured at load is
// captured at load; bootstrapCredential and featureFlag stay module objects,
// read at call time; `../config` and the models barrel (for TenantSettings) are
// still required lazily where the JavaScript required them.
//
// The seed and demo functions write ~35 models from literal fixtures. They are
// typed at that boundary — `SeedModel`, the six calls these functions make —
// rather than against each model's creation attributes: the fixtures are
// checked by the database and by the seed's own tests, and a per-model
// creation type would only restate each model's optional/required split.
import { Op as loadedOp } from "sequelize";
import type { Transaction } from "sequelize";
import models from "../models";
import type * as ModelsModule from "../models";
import type * as ConfigModule from "../config";
import { hashPassword as loadedHashPassword } from "../utils/password.util";
import * as bootstrapCredential from "./bootstrapCredential.service";
import { isProduction as loadedIsProduction } from "../config/env";
import { AppError as LoadedAppError } from "../utils/appError.util";
import featureFlagService from "./featureFlag.service";
import seedMenuGroupsUtil from "../utils/seedMenuGroups.util";
// The JavaScript also destructured ROLE_NAMES, PASSWORD_SALT_ROUNDS,
// PERMISSION_TYPES, MENU_SLUGS and PROFILE_SUB_ROUTES and never read them (the
// last two only for DEFAULT_MENUS, which nothing read). Reading a property of
// the constants barrel has no effect, so they are simply not imported.
import {
  ROLE_IDS as loadedRoleIds,
  ROLE_LEVELS as loadedRoleLevels,
  ROLE_MENU_ASSIGNMENTS as loadedRoleMenuAssignments,
  DEFAULT_TENANT as loadedDefaultTenant,
} from "../constants";
import { toTenantId } from "../types/ids";
import { PLATFORM_TENANT as loadedPlatformTenant } from "../constants/platformTenant";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";

/** A row these functions read back: its id and the few fields they use. */
interface SeedRow {
  id: string;
  name?: string;
  seq?: number;
  cardSeq?: number;
  iotEnabled?: boolean;
  save(): Promise<unknown>;
}

/** The model calls the seed and demo functions make, typed at the fixture boundary. */
interface SeedModel {
  findAll(options: object): Promise<SeedRow[]>;
  findOne(options: object): Promise<SeedRow | null>;
  findOrCreate(options: object): Promise<[SeedRow, boolean]>;
  create(values: object, options?: object): Promise<SeedRow>;
  bulkCreate(values: readonly object[], options?: object): Promise<unknown>;
  destroy(options: object): Promise<number>;
  count(options: object): Promise<number>;
}

type SeedModels = Record<
  "Users" | "Roles" | "MenuGroup" | "RoleMenuPermission" | "Warehouse" | "StorageLocation" | "Stock" | "StockTransfer" | "StockAdjustment" | "StockOpname" | "Tenant" | "Vendor" | "SupplierScorecard" | "CalibrationDevice" | "CalibrationRecord" | "Certificate" | "MaintenanceWorkOrder" | "IotReading" | "NonConformance" | "Capa" | "SopDocument" | "Risk" | "Workflow" | "WorkflowStep" | "Ticket" | "TicketComment" | "TicketCounter" | "KanbanProject" | "KanbanColumn" | "KanbanCard" | "KanbanLabel" | "Notification" | "Post" | "Category" | "PostCategory",
  SeedModel
>;

const Op = loadedOp;
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
} = models as unknown as SeedModels;
const hashPassword = loadedHashPassword;
const isProduction = loadedIsProduction;
const AppError = LoadedAppError;
const { seedMenuGroups } = seedMenuGroupsUtil;
const ROLE_IDS = loadedRoleIds;
const ROLE_LEVELS = loadedRoleLevels;
const ROLE_MENU_ASSIGNMENTS = loadedRoleMenuAssignments;
const DEFAULT_TENANT = loadedDefaultTenant;
const PLATFORM_TENANT = loadedPlatformTenant;
const logger = loadedLogger;

/** `error.message` as the JavaScript read it (a null error throws, as it did). */
const errMsg = (error: unknown): string => String((error as { message?: unknown }).message);

/** One role definition. */
interface RoleDef {
  id: string;
  roleLevel: number;
  name: string;
  description: string;
  nameToShow: string;
  isSystem: boolean;
  status: string;
  sortOrder: number;
}

/** What a role seed reports. */
interface RoleSeedResult {
  rolesCreated: number;
  rolesSkipped: number;
  errors: string[];
}

// ==========================================
// CONSTANTS
// ==========================================

/**
 * Default role definitions (core roles from constants)
 */
const DEFAULT_ROLES: RoleDef[] = [
  {
    id: ROLE_IDS.SUPER_ADMIN,
    roleLevel: ROLE_LEVELS.SUPER_ADMIN,
    name: "SUPERADMIN",
    description: "System Super Administrator",
    nameToShow: "Super Admin",
    isSystem: true,
    status: "active",
    sortOrder: 0,
  },
  {
    id: ROLE_IDS.HEALTCARE_ADMIN,
    roleLevel: ROLE_LEVELS.HEALTCARE_ADMIN,
    name: "HEALTHCARE ADMIN",
    description: "Healthcare Administrator",
    nameToShow: "Admin Faskes",
    isSystem: true,
    status: "active",
    sortOrder: 1,
  },
  {
    id: ROLE_IDS.CALIBRATOR_ADMIN,
    roleLevel: ROLE_LEVELS.CALIBRATOR_ADMIN,
    name: "CALIBRATOR ADMIN",
    description: "Calibrator Administrator",
    nameToShow: "Admin Kalibrator",
    isSystem: true,
    status: "active",
    sortOrder: 2,
  },
  {
    id: ROLE_IDS.USER,
    roleLevel: ROLE_LEVELS.USER,
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
const APPLICATION_ROLES: RoleDef[] = [
  {
    id: ROLE_IDS.TECHNICIAN,
    roleLevel: ROLE_LEVELS.TECHNICIAN,
    name: "TECHNICIAN",
    description: "Technician",
    nameToShow: "Teknisi",
    isSystem: false,
    status: "active",
    sortOrder: 4,
  },
  {
    id: ROLE_IDS.SUPERVISOR,
    roleLevel: ROLE_LEVELS.SUPERVISOR,
    name: "SUPERVISOR",
    description: "Supervisor",
    nameToShow: "Penyelia",
    isSystem: false,
    status: "active",
    sortOrder: 5,
  },
  {
    id: ROLE_IDS.ENGINEERING_MANAGER,
    roleLevel: ROLE_LEVELS.ENGINEERING_MANAGER,
    name: "ENGINEERING MANAGER",
    description: "Enginnering Manager",
    nameToShow: "Manajer Teknik",
    isSystem: false,
    status: "active",
    sortOrder: 6,
  },
  {
    id: ROLE_IDS.HEALTHCARE_TECHNICIAN,
    roleLevel: ROLE_LEVELS.HEALTHCARE_TECHNICIAN,
    name: "HEALTHCARE TECHNICIAN",
    description: "Healthcare Technician",
    nameToShow: "Teknisi Faskes",
    isSystem: false,
    status: "active",
    sortOrder: 7,
  },
  {
    id: ROLE_IDS.FACILITY_MAINTENANCE,
    roleLevel: ROLE_LEVELS.FACILITY_MAINTENANCE,
    name: "FACILITY MAINTENANCE",
    description: "Facility Maintainance",
    nameToShow: "IPSRS",
    isSystem: false,
    status: "active",
    sortOrder: 8,
  },
  {
    id: ROLE_IDS.WAREHOUSE_STAFF,
    roleLevel: ROLE_LEVELS.WAREHOUSE_STAFF,
    name: "WAREHOUSE STAFF",
    description: "Warehouse Staff",
    nameToShow: "Gudang",
    isSystem: false,
    status: "active",
    sortOrder: 9,
  },
  {
    id: ROLE_IDS.ROOM_USER,
    roleLevel: ROLE_LEVELS.ROOM_USER,
    name: "ROOM USER",
    description: "Room User",
    nameToShow: "User Ruangan",
    isSystem: false,
    status: "active",
    sortOrder: 10,
  },
];

/**
 * Default system user to seed after roles.
 *
 * P10-16 (ADR-099): no password here. The system super admin is created ONLY
 * when no super admin exists, with a one-time password drawn at that moment
 * (services/bootstrapCredential.service.ts); its plaintext is written to a
 * 0600 file inside the container and nowhere else. An existing account's
 * credential is never touched by the seed.
 */
const DEFAULT_SYSTEM_USERS = [
  {
    email: "sys@mail.com",
    username: "sys",
    firstName: "Super",
    lastName: "System",
    status: "ACTIVE",
    roleId: ROLE_IDS.SUPER_ADMIN,
    tenantId: DEFAULT_TENANT.id,
    isEmailVerified: true,
  },
];

// The JavaScript defined DEFAULT_MENUS ([MENU_SLUGS.PROFILE,
// PROFILE_SUB_ROUTES.CHANGE_PASSWORD], "the menus every role gets") and never
// read it; ROLE_MENU_ASSIGNMENTS is what the seed assigns.

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// ==========================================
// DATABASE OPERATIONS
// ==========================================

/*
 * A-261: `dropSeededTables`, which force-deleted every user, tenant, role and
 * stock row one statement at a time with no transaction, is REMOVED as well
 * (ADR-072): nothing called it — no route, controller, script or boot path.
 *
 * A-259 (ADR-068): `syncTables` (a forced `db.sync`, dropping every table) and
 * `resetAndSeed`, which called it, are REMOVED. Since P6-03 (migration 0057)
 * the backend runs its queries as the application role, which may not drop or
 * create tables, so both failed on every deployment — and nothing called
 * either (no route, script or boot path). Dropping and recreating the schema
 * is an owner operation: it is done with the owner's credentials, outside the
 * application (`make migrate` on an empty database), never by a runtime
 * helper that also erases the audit trail and the append-only calibration
 * records.
 */

// ==========================================
// ROLE SEEDING
// ==========================================

/**
 * Seed default roles (SUPER_ADMIN, TENANT_ADMIN, USER)
 * @returns {Promise<Object>} Result of seeding operation
 */
async function seedDefaultRoles(): Promise<RoleSeedResult> {
  const result: RoleSeedResult = {
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
      `Fatal error during default roles seeding: ${errMsg(error)}`,
    );
    logger.error(`Failed to seed default roles: ${errMsg(error)}`);
    return result;
  }
}

/**
 * Seed application-specific roles (HEALTHCARE ADMIN, TECHNICIAN, etc.)
 * @returns {Promise<Object>} Result of seeding operation
 */
async function seedApplicationRoles(): Promise<RoleSeedResult> {
  const result: RoleSeedResult = {
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
      `Fatal error during application roles seeding: ${errMsg(error)}`,
    );
    logger.error(`Failed to seed application roles: ${errMsg(error)}`);
    return result;
  }
}

/**
 * Seed all roles (default + application roles)
 * @returns {Promise<Object>} Result of seeding operation
 */
async function seedAllRoles(): Promise<RoleSeedResult> {
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
async function seedMenuGroupsAndItems(): Promise<{
  menuGroupsCreated: number;
  menuGroupsSkipped: number;
  permissionsAssigned: number;
  errors: string[];
}> {
  const result = {
    menuGroupsCreated: 0,
    menuGroupsSkipped: 0,
    permissionsAssigned: 0,
    errors: [] as string[],
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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `assignment.menus || {}`
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
      `Role menu permissions seeded: ${String(result.permissionsAssigned)} assigned`,
    );
    return result;
  } catch (error) {
    result.errors.push(`Error seeding menus: ${errMsg(error)}`);
    logger.error(`Failed to seed menus: ${errMsg(error)}`);
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
async function seedRoleMenuPermissions(
  roleName: string,
  menuSlugs: readonly string[],
  permissionType: string,
): Promise<{ permissionsAssigned: number; errors: string[] }> {
  const result = {
    permissionsAssigned: 0,
    errors: [] as string[],
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
    result.errors.push(`Error seeding role menu permissions: ${errMsg(error)}`);
    logger.error(`Failed to seed role menu permissions: ${errMsg(error)}`);
    return result;
  }
}

/**
 * A-125 (ADR-051 Q-14) — create the reserved PLATFORM tenant if absent. Its
 * audit trail records platform operations (tenant create and delete, global
 * roles). Migration 0034 creates it too; this covers a database seeded before
 * the migrator runs.
 *
 * `includePlatformTenant`: the Tenant model's hooks hide the row from every
 * other query. A soft-deleted PLATFORM row (paranoid: false finds it) is not
 * resurrected here — that is not a state the application can produce, and
 * deciding what it means is not a seed's job.
 *
 * @returns {Promise<void>}
 */
async function seedPlatformTenant(): Promise<void> {
  const existing = await Tenant.findOne({
    where: { id: PLATFORM_TENANT.id },
    paranoid: false,
    includePlatformTenant: true,
  });
  if (!existing) {
    await Tenant.create({ ...PLATFORM_TENANT });
    logger.info(`Created platform tenant: ${PLATFORM_TENANT.name}`);
  }
}

/**
 * Seed default tenant — and, first, the PLATFORM tenant (A-125), so every path
 * that seeds a tenant (seedAll, seedDemoData) creates both.
 * @returns {Promise<void>}
 */
async function seedDefaultTenant(): Promise<undefined> {
  try {
    await seedPlatformTenant();
    const existing = await Tenant.findOne({
      where: { id: DEFAULT_TENANT.id },
      paranoid: false,
    });

    if (!existing) {
      await Tenant.create(DEFAULT_TENANT);
      logger.info(`Created default tenant: ${DEFAULT_TENANT.name}`);
    }
  } catch (error) {
    logger.error(`Failed to seed default tenant: ${errMsg(error)}`);
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
async function seedUsers(): Promise<{
  usersCreated: number;
  usersSkipped: number;
  bootstrapPasswordFile: string | null;
  errors: string[];
}> {
  const result = {
    usersCreated: 0,
    usersSkipped: 0,
    // P10-16 (ADR-099): where the one-time password was written — a path
    // inside the container, never the value. Null when none was issued.
    bootstrapPasswordFile: null as string | null,
    errors: [] as string[],
  };

  try {
    for (const userData of DEFAULT_SYSTEM_USERS) {
      // Upsert, not hard-delete + recreate: the system user may be referenced
      // by other tables (e.g. certificates.created_by). A soft-deleted row is
      // restored. P10-16: the credential is NEVER re-seeded — this used to
      // reset the operator's password to a public default on every call.
      const outcome = await bootstrapCredential.ensureSystemSuperAdmin(userData);
      if (outcome.created) {
        result.usersCreated++;
        result.bootstrapPasswordFile = outcome.bootstrapPasswordFile;
      } else {
        result.usersSkipped++;
      }
    }

    return result;
  } catch (error) {
    result.errors.push(`Fatal error during users seeding: ${errMsg(error)}`);
    logger.error(`Failed to seed users: ${errMsg(error)}`);
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
async function unseedRoles(roleNames: readonly string[]): Promise<{ rolesDeleted: number; errors: string[] }> {
  const result = {
    rolesDeleted: 0,
    errors: [] as string[],
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
    result.errors.push(`Error deleting roles: ${errMsg(error)}`);
    return result;
  }
}

/**
 * Unseed (delete) seeded users by email
 * @param {string[]} emails - Array of user emails to delete
 * @returns {Promise<Object>} Result of unseeding operation
 */
async function unseedUsers(emails: readonly string[]): Promise<{ usersDeleted: number; errors: string[] }> {
  const result = {
    usersDeleted: 0,
    errors: [] as string[],
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
    result.errors.push(`Error deleting users: ${errMsg(error)}`);
    return result;
  }
}

/**
 * Unseed (delete) all menu groups, items, and related assignments
 * @returns {Promise<Object>} Result of unseeding operation
 */
async function unseedMenuData(): Promise<{ roleMenuPermissionsDeleted: number; menuGroupsDeleted: number; errors: string[] }> {
  const result = {
    roleMenuPermissionsDeleted: 0,
    menuGroupsDeleted: 0,
    errors: [] as string[],
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
    result.errors.push(`Error unseeding menu data: ${errMsg(error)}`);
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
async function seedAll(): Promise<{
  roles: RoleSeedResult;
  menuGroups: Awaited<ReturnType<typeof seedMenuGroupsAndItems>>;
  tenant: undefined;
  users: Awaited<ReturnType<typeof seedUsers>>;
}> {
  logger.info("=== Starting database seeding ===");

  const result = {
    roles: await seedAllRoles(),
    menuGroups: await seedMenuGroupsAndItems(),
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- as built: the result names the step, which resolves undefined
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
async function unseedAll(): Promise<{
  menuData: Awaited<ReturnType<typeof unseedMenuData>>;
  users: Awaited<ReturnType<typeof unseedUsers>>;
  tenants: number;
  roles: Awaited<ReturnType<typeof unseedRoles>>;
}> {
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
const DEMO_USERS = (Object.entries(ROLE_IDS) as [string, string][])
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

/** The per-module counts of a demo seed (indexable, so `Object.values` reads them as numbers). */
interface DemoCounts {
  [module: string]: number;
  tenants: number;
  users: number;
  warehouses: number;
  storageLocations: number;
  stocks: number;
  stockTransfers: number;
  stockAdjustments: number;
  stockOpnames: number;
  vendors: number;
  supplierScorecards: number;
  calibrationDevices: number;
  calibrationRecords: number;
  certificates: number;
  maintenanceWorkOrders: number;
  iotReadings: number;
  nonConformances: number;
  capas: number;
  sopDocuments: number;
  risks: number;
  workflows: number;
  workflowSteps: number;
  tickets: number;
  ticketComments: number;
  kanbanProjects: number;
  kanbanColumns: number;
  kanbanLabels: number;
  kanbanCards: number;
  notifications: number;
  categories: number;
  posts: number;
  postCategories: number;
  featureFlags: number;
}

/**
 * Seed the two extra demonstration tenants (idempotent by subdomain).
 * @returns {Promise<number>} number of tenants created
 */
/* istanbul ignore next -- demo fixtures only (SEED_DEMO=true, GET /migration/seed-demo, scripts/seedDemo.js): never runs in production; see A-32 */
async function seedDemoTenants(): Promise<number> {
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
/* istanbul ignore next -- demo fixtures only (SEED_DEMO=true, GET /migration/seed-demo, scripts/seedDemo.js): never runs in production; see A-32 */
async function seedDemoUsers(): Promise<number> {
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
/* istanbul ignore next -- demo fixtures only (SEED_DEMO=true, GET /migration/seed-demo, scripts/seedDemo.js): never runs in production; see A-32 */
async function resolveDemoActorId(): Promise<string | null> {
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
/* istanbul ignore next -- demo fixtures only (SEED_DEMO=true, GET /migration/seed-demo, scripts/seedDemo.js): never runs in production; see A-32 */
async function seedDemoWarehousing(tenantId: string, actorId: string, counts: DemoCounts): Promise<void> {
  // Two warehouses
  const warehouses: SeedRow[] = [];
  for (let i = 1; i <= 2; i += 1) {
    const code = `${DEMO.warehouseCodePrefix}${String(i)}`;
    const [wh, wasCreated] = await Warehouse.findOrCreate({
      where: { tenantId, code },
      defaults: {
        tenantId,
        code,
        name: `${DEMO.marker} Warehouse ${String(i)}`,
        status: "active",
        address: `${String(i)} Demo Street`,
        isDeleted: false,
      },
    });
    warehouses.push(wh);
    if (wasCreated) {
      counts.warehouses += 1;
    }
  }

  // Storage locations (2 in warehouse 1)
  const locations: SeedRow[] = [];
  for (let i = 1; i <= 2; i += 1) {
    const code = `${DEMO.locationCodePrefix}${String(i)}`;
    const [loc, wasCreated] = await StorageLocation.findOrCreate({
      where: { tenantId, code },
      defaults: {
        tenantId,
        warehouseId: (warehouses[0] as SeedRow).id,
        code,
        name: `${DEMO.marker} Rack ${String(i)}`,
        isActive: true,
      },
    });
    locations.push(loc);
    if (wasCreated) {
      counts.storageLocations += 1;
    }
  }

  // Stock items
  const stocks: SeedRow[] = [];
  const stockDefs = [
    { sku: `${DEMO.stockSkuPrefix}1`, itemName: "Reference Multimeter", quantity: 25 },
    { sku: `${DEMO.stockSkuPrefix}2`, itemName: "Calibration Weights Set", quantity: 8 },
  ];
  for (const s of stockDefs) {
    const [stock, wasCreated] = await Stock.findOrCreate({
      where: { tenantId, sku: s.sku },
      defaults: {
        tenantId,
        warehouseId: (warehouses[0] as SeedRow).id,
        locationId: (locations[0] as SeedRow).id,
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
        fromWarehouseId: (warehouses[0] as SeedRow).id,
        toWarehouseId: (warehouses[1] as SeedRow).id,
        itemName,
      },
      defaults: {
        tenantId,
        fromWarehouseId: (warehouses[0] as SeedRow).id,
        toWarehouseId: (warehouses[1] as SeedRow).id,
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
      where: { tenantId, warehouseId: (warehouses[0] as SeedRow).id, reason },
      defaults: {
        tenantId,
        warehouseId: (warehouses[0] as SeedRow).id,
        locationId: (locations[0] as SeedRow).id,
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
      where: { tenantId, warehouseId: (warehouses[0] as SeedRow).id, notes },
      defaults: {
        tenantId,
        warehouseId: (warehouses[0] as SeedRow).id,
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
/* istanbul ignore next -- demo fixtures only (SEED_DEMO=true, GET /migration/seed-demo, scripts/seedDemo.js): never runs in production; see A-32 */
async function seedDemoVendors(tenantId: string, actorId: string, counts: DemoCounts): Promise<void> {
  const vendorDefs = [
    { name: "Demo Calibration Lab", type: "CalibrationLab" },
    { name: "Demo Parts Supplier", type: "PartsSupplier" },
  ];
  const vendors: SeedRow[] = [];
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
/* istanbul ignore next -- demo fixtures only (SEED_DEMO=true, GET /migration/seed-demo, scripts/seedDemo.js): never runs in production; see A-32 */
async function seedDemoCalibration(tenantId: string, actorId: string, counts: DemoCounts): Promise<SeedRow[]> {
  const deviceDefs = [
    { serial: `${DEMO.deviceSerialPrefix}1`, name: "Demo Digital Multimeter", iot: true },
    { serial: `${DEMO.deviceSerialPrefix}2`, name: "Demo Pressure Gauge", iot: false },
  ];
  const devices: SeedRow[] = [];
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
  const records: SeedRow[] = [];
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
    const defaults: Record<string, unknown> = {
      tenantId,
      deviceId: (devices[0] as SeedRow).id,
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
      defaults["approvedBy"] = actorId;
    }
    if (c.status === "signed") {
      defaults["signedBy"] = actorId;
      defaults["signedAt"] = DEMO_DATE_2;
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
/* istanbul ignore next -- demo fixtures only (SEED_DEMO=true, GET /migration/seed-demo, scripts/seedDemo.js): never runs in production; see A-32 */
async function seedDemoMaintenance(tenantId: string, actorId: string, devices: SeedRow[], counts: DemoCounts): Promise<void> {
  const device = devices[0] as SeedRow;

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
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `find(…) || device`
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
/* istanbul ignore next -- demo fixtures only (SEED_DEMO=true, GET /migration/seed-demo, scripts/seedDemo.js): never runs in production; see A-32 */
async function seedDemoQms(tenantId: string, actorId: string, devices: SeedRow[], counts: DemoCounts): Promise<void> {
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
  const ncs: SeedRow[] = [];
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
        ncId: (ncs[0] as SeedRow).id,
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
/* istanbul ignore next -- demo fixtures only (SEED_DEMO=true, GET /migration/seed-demo, scripts/seedDemo.js): never runs in production; see A-32 */
async function seedDemoWorkflows(tenantId: string, counts: DemoCounts): Promise<void> {
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
/* istanbul ignore next -- demo fixtures only (SEED_DEMO=true, GET /migration/seed-demo, scripts/seedDemo.js): never runs in production; see A-32 */
async function seedDemoTickets(tenantId: string, actorId: string, counts: DemoCounts): Promise<void> {
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
  const tickets: SeedRow[] = [];
  for (const t of ticketDefs) {
    let ticket = await Ticket.findOne({
      where: { tenantId, subject: t.subject },
      paranoid: false,
    });
    if (!ticket) {
      const seq = (counter.seq as number) + 1;
      ticket = await Ticket.create({
        tenantId,
        number: seq,
        ticketKey: `TKT-${String(seq)}`,
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
/* istanbul ignore next -- demo fixtures only (SEED_DEMO=true, GET /migration/seed-demo, scripts/seedDemo.js): never runs in production; see A-32 */
async function seedDemoKanban(tenantId: string, actorId: string, counts: DemoCounts): Promise<void> {
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
  const columns: Record<string, SeedRow> = {};
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
      const number = (project.cardSeq as number) + 1;
      await KanbanCard.create({
        tenantId,
        projectId: project.id,
        columnId: (columns[card.column] as SeedRow).id,
        title: card.title,
        description: "Created by demo seeder.",
        priority: card.priority,
        number,
        cardKey: `${DEMO.kanbanCode}-${String(number)}`,
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
/* istanbul ignore next -- demo fixtures only (SEED_DEMO=true, GET /migration/seed-demo, scripts/seedDemo.js): never runs in production; see A-32 */
async function seedDemoEngagement(tenantId: string, actorId: string, counts: DemoCounts): Promise<void> {
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
  const categories: SeedRow[] = [];
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
    const p = postDefs[i] as (typeof postDefs)[number];
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required here, per call
    const { TenantSettings } = require("../models") as typeof ModelsModule;
    const flagWhere = {
      tenantId,
      key: { [Op.like]: "feature_flag_%" },
    };
    const before = await TenantSettings.count({ where: flagWhere });
    await featureFlagService.initializeTenantFlags(toTenantId(tenantId));
    const after = await TenantSettings.count({ where: flagWhere });
    counts.featureFlags = after - before;
  } catch (error) {
    logger.warn(`Demo seeder: feature flag init skipped: ${errMsg(error)}`);
  }
}

/**
 * P10-16 (ADR-099 Amendment 1) — the demo users share one KNOWN password
 * (Demo123!), so the demo seeder is development-only: it refuses to run when
 * NODE_ENV=production, whatever SEED_DEMO says. Before this, "SEED_DEMO must
 * never be true in production" was a rule only `make preflight` checked; the
 * route, the controller and scripts/seedDemo.js all reach seedDemoData.
 *
 * @throws {AppError} 403 in production
 */
function assertDemoSeedingPermitted(): void {
  if (isProduction()) {
    throw new AppError(
      403,
      "Demo data seeding is refused in production: the demo users share a known password (P10-16)",
    );
  }
}

/**
 * Seed a realistic slice of every business module. Idempotent and FK-safe.
 * @returns {Promise<Object>} { created: {per-module counts}, errors: [] }
 */
/* istanbul ignore next -- demo fixtures only (SEED_DEMO=true, GET /migration/seed-demo, scripts/seedDemo.js): never runs in production; see A-32 */
async function seedDemoData(): Promise<{ created: DemoCounts; errors: string[] }> {
  // P10-16: refused in production — before anything is written.
  assertDemoSeedingPermitted();
  logger.info("=== Starting demo-data seeding ===");

  const counts: DemoCounts = {
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
  const errors: string[] = [];

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
    errors.push(`Demo seeding error: ${errMsg(error)}`);
    logger.error(`Demo seeding failed: ${errMsg(error)}`);
  }

  return { created: counts, errors };
}

/**
 * Remove all demo rows created by seedDemoData(), in reverse FK order.
 * Matches on the stable DEMO markers so real data is never touched.
 *
 * A-259 (ADR-068): all or nothing, and never a calibration record.
 *  - It runs in ONE transaction. It used to delete table by table with no
 *    transaction, so the first refusal left the demo half-removed: since P6-03
 *    (migration 0057) the append-only trigger refuses every DELETE on
 *    `calibration_records`, for every role, and the certificates, IoT
 *    readings and work orders deleted before it stayed deleted.
 *  - Demo calibration records are Part 11 records like any other: they are
 *    never deleted, and a device with records cannot be deleted either. So
 *    once a demo record exists the whole unseed is REFUSED before anything is
 *    touched, and the result says why. (Seeding demo data is the decision that
 *    cannot be undone; its route is behind SEED_DEMO=true.)
 *
 * @returns {Promise<Object>} { deleted: {...}, errors: [], refused?: true }
 */
/* istanbul ignore next -- demo fixtures only (SEED_DEMO=true, GET /migration/seed-demo, scripts/seedDemo.js): never runs in production; see A-32 */
async function unseedDemoData(): Promise<{ deleted: Record<string, number>; errors: string[]; refused?: true }> {
  logger.info("=== Removing demo data ===");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required here, per call
  const { db } = require("../config") as typeof ConfigModule;
  const tenantId = DEFAULT_TENANT.id;
  const deleted: Record<string, number> = {};
  const errors: string[] = [];
  const like = (col: string, prefix: string): Record<string, unknown> => ({ [col]: { [Op.like]: `${prefix}%` } });

  try {
    await db.transaction(async (transaction: Transaction) => {
      // A-259: first, before any delete — the calibration records that make
      // this impossible.
      const demoDevices = await CalibrationDevice.findAll({
        where: { tenantId, ...like("serial_number", DEMO.deviceSerialPrefix) },
        paranoid: false,
        transaction,
      });
      const deviceIds = demoDevices.map((d) => d.id);
      const records = deviceIds.length
        ? await CalibrationRecord.count({
          where: { deviceId: { [Op.in]: deviceIds } },
          paranoid: false,
          transaction,
        })
        : 0;
      if (records > 0) {
        throw Object.assign(
          new Error(
            `Demo data cannot be removed: its devices hold ${String(records)} calibration record(s), which are append-only (ADR-062) and are never deleted. Nothing was removed.`,
          ),
          { unseedRefused: true },
        );
      }

      // Content join + posts + categories (platform-global)
      const demoPosts = await Post.findAll({
        where: like("slug", DEMO.contentSlugPrefix),
        paranoid: false,
        transaction,
      });
      const demoPostIds = demoPosts.map((p) => p.id);
      if (demoPostIds.length) {
        deleted["postCategories"] = await PostCategory.destroy({
          where: { postId: { [Op.in]: demoPostIds } },
          force: true,
          transaction,
        });
      }
      deleted["posts"] = await Post.destroy({
        where: like("slug", DEMO.contentSlugPrefix),
        force: true,
        paranoid: false,
        transaction,
      });
      deleted["categories"] = await Category.destroy({
        where: like("slug", DEMO.contentSlugPrefix),
        force: true,
        paranoid: false,
        transaction,
      });

      // Notifications
      deleted["notifications"] = await Notification.destroy({
        where: { tenantId, ...like("title", DEMO.marker) },
        force: true,
        transaction,
      });

      // Kanban (cards -> labels -> columns -> project)
      const demoProjects = await KanbanProject.findAll({
        where: { tenantId, ...like("name", DEMO.marker) },
        paranoid: false,
        transaction,
      });
      const projectIds = demoProjects.map((p) => p.id);
      if (projectIds.length) {
        deleted["kanbanCards"] = await KanbanCard.destroy({
          where: { projectId: { [Op.in]: projectIds } },
          force: true,
          paranoid: false,
          transaction,
        });
        deleted["kanbanLabels"] = await KanbanLabel.destroy({
          where: { projectId: { [Op.in]: projectIds } },
          force: true,
          transaction,
        });
        deleted["kanbanColumns"] = await KanbanColumn.destroy({
          where: { projectId: { [Op.in]: projectIds } },
          force: true,
          transaction,
        });
        deleted["kanbanProjects"] = await KanbanProject.destroy({
          where: { id: { [Op.in]: projectIds } },
          force: true,
          paranoid: false,
          transaction,
        });
      }

      // Tickets (comments -> tickets)
      const demoTickets = await Ticket.findAll({
        where: { tenantId, ...like("subject", DEMO.marker) },
        paranoid: false,
        transaction,
      });
      const ticketIds = demoTickets.map((t) => t.id);
      if (ticketIds.length) {
        deleted["ticketComments"] = await TicketComment.destroy({
          where: { ticketId: { [Op.in]: ticketIds } },
          force: true,
          transaction,
        });
        deleted["tickets"] = await Ticket.destroy({
          where: { id: { [Op.in]: ticketIds } },
          force: true,
          paranoid: false,
          transaction,
        });
      }

      // Workflows (steps -> workflow)
      const demoWorkflows = await Workflow.findAll({
        where: { tenantId, ...like("name", DEMO.marker) },
        paranoid: false,
        transaction,
      });
      const workflowIds = demoWorkflows.map((w) => w.id);
      if (workflowIds.length) {
        deleted["workflowSteps"] = await WorkflowStep.destroy({
          where: { workflowId: { [Op.in]: workflowIds } },
          force: true,
          transaction,
        });
        deleted["workflows"] = await Workflow.destroy({
          where: { id: { [Op.in]: workflowIds } },
          force: true,
          paranoid: false,
          transaction,
        });
      }

      // QMS: CAPA -> NC ; SOP ; risks
      deleted["capas"] = await Capa.destroy({
        where: { tenantId, ...like("capa_number", DEMO.capaPrefix) },
        force: true,
        paranoid: false,
        transaction,
      });
      deleted["nonConformances"] = await NonConformance.destroy({
        where: { tenantId, ...like("nc_number", DEMO.ncPrefix) },
        force: true,
        paranoid: false,
        transaction,
      });
      deleted["sopDocuments"] = await SopDocument.destroy({
        where: { tenantId, ...like("document_number", DEMO.sopPrefix) },
        force: true,
        paranoid: false,
        transaction,
      });
      deleted["risks"] = await Risk.destroy({
        where: { tenantId, ...like("title", DEMO.marker) },
        force: true,
        paranoid: false,
        transaction,
      });

      // Certificates ; IoT ; maintenance ; devices (they hold no calibration
      // record — that was refused above)
      deleted["certificates"] = await Certificate.destroy({
        where: { tenantId, ...like("certificate_number", DEMO.certPrefix) },
        force: true,
        paranoid: false,
        transaction,
      });
      if (deviceIds.length) {
        deleted["iotReadings"] = await IotReading.destroy({
          where: { deviceId: { [Op.in]: deviceIds } },
          force: true,
          transaction,
        });
        deleted["maintenanceWorkOrders"] = await MaintenanceWorkOrder.destroy({
          where: { deviceId: { [Op.in]: deviceIds } },
          force: true,
          paranoid: false,
          transaction,
        });
        deleted["calibrationDevices"] = await CalibrationDevice.destroy({
          where: { id: { [Op.in]: deviceIds } },
          force: true,
          paranoid: false,
          transaction,
        });
      }

      // Vendors (scorecards -> vendors)
      const demoVendors = await Vendor.findAll({
        where: { tenantId, ...like("name", "Demo ") },
        paranoid: false,
        transaction,
      });
      const vendorIds = demoVendors.map((v) => v.id);
      if (vendorIds.length) {
        deleted["supplierScorecards"] = await SupplierScorecard.destroy({
          where: { vendorId: { [Op.in]: vendorIds } },
          force: true,
          paranoid: false,
          transaction,
        });
        deleted["vendors"] = await Vendor.destroy({
          where: { id: { [Op.in]: vendorIds } },
          force: true,
          paranoid: false,
          transaction,
        });
      }

      // Warehousing: transfers/adjustments/opnames -> stock -> locations -> warehouses
      const demoWarehouses = await Warehouse.findAll({
        where: { tenantId, ...like("code", DEMO.warehouseCodePrefix) },
        paranoid: false,
        transaction,
      });
      const warehouseIds = demoWarehouses.map((w) => w.id);
      if (warehouseIds.length) {
        deleted["stockTransfers"] = await StockTransfer.destroy({
          where: { fromWarehouseId: { [Op.in]: warehouseIds } },
          force: true,
          transaction,
        });
        deleted["stockAdjustments"] = await StockAdjustment.destroy({
          where: { warehouseId: { [Op.in]: warehouseIds } },
          force: true,
          transaction,
        });
        deleted["stockOpnames"] = await StockOpname.destroy({
          where: { warehouseId: { [Op.in]: warehouseIds } },
          force: true,
          transaction,
        });
        deleted["stocks"] = await Stock.destroy({
          where: { warehouseId: { [Op.in]: warehouseIds } },
          force: true,
          paranoid: false,
          transaction,
        });
        deleted["storageLocations"] = await StorageLocation.destroy({
          where: { warehouseId: { [Op.in]: warehouseIds } },
          force: true,
          transaction,
        });
        deleted["warehouses"] = await Warehouse.destroy({
          where: { id: { [Op.in]: warehouseIds } },
          force: true,
          paranoid: false,
          transaction,
        });
      }

      // Demo users and extra tenants
      deleted["users"] = await Users.destroy({
        where: { email: { [Op.like]: `%@${DEMO.userEmailDomain}` } },
        force: true,
        paranoid: false,
        transaction,
      });
      deleted["tenants"] = await Tenant.destroy({
        where: { subdomain: { [Op.in]: DEMO.tenantSubdomains } },
        force: true,
        paranoid: false,
        transaction,
      });
    });

    logger.info("=== Demo data removed ===");
  } catch (error) {
    // Rolled back: nothing the counts named was removed.
    for (const key of Object.keys(deleted)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- as built: every key the rolled-back counts named
      delete deleted[key];
    }
    errors.push(`Demo unseeding error: ${errMsg(error)}`);
    logger.error(`Demo unseeding failed: ${errMsg(error)}`);
    if ((error as { unseedRefused?: unknown }).unseedRefused) {
      return { deleted, errors, refused: true };
    }
  }

  return { deleted, errors };
}

// ==========================================
// EXPORTS
// ==========================================

export = {
  // Role seeding
  seedDefaultRoles,
  seedApplicationRoles,
  seedAllRoles,

  // Menu group seeding
  seedMenuGroupsAndItems,
  seedRoleMenuPermissions,

  // User seeding
  seedUsers,

  // Tenant seeding (A-125)
  seedPlatformTenant,

  // Complete seeding
  seedAll,

  // Demo data seeding
  seedDemoData,
  assertDemoSeedingPermitted,
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
