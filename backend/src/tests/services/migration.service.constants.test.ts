/**
 * migration.service.js reads ROLE_MENU_ASSIGNMENTS from ../../constants at module
 * load, so the shape of that constant cannot be varied inside the main test file.
 * This companion file mocks the constants module (spreading the real one, so every
 * other export keeps its true value) to exercise the defensive `assignment.menus
 * || {}` guard against an assignment that carries no menus map.
 */
import type * as ConstantsModule from "../../constants";

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

jest.mock("../../constants", () => ({
  ...(jest.requireActual("../../constants") as unknown as typeof ConstantsModule),
  ROLE_MENU_ASSIGNMENTS: [
    // An assignment with no `menus` key at all.
    { roleName: "SUPERADMIN" },
    // A normal assignment, to prove the loop keeps going.
    { roleName: "USER", menus: { profile: "read" } },
  ],
}));

jest.mock("../../models", () => ({
  Users: { findOne: jest.fn(), create: jest.fn(), destroy: jest.fn() },
  Roles: {
    findAll: jest.fn(),
    bulkCreate: jest.fn(),
    findOne: jest.fn(),
    destroy: jest.fn(),
  },
  MenuGroup: { findOne: jest.fn(), destroy: jest.fn() },
  RoleMenuPermission: {
    findOne: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
  },
  Tenant: { findOne: jest.fn(), create: jest.fn(), destroy: jest.fn() },
  Warehouse: { destroy: jest.fn() },
  StorageLocation: { destroy: jest.fn() },
  Stock: { destroy: jest.fn() },
  StockTransfer: { destroy: jest.fn() },
  StockAdjustment: { destroy: jest.fn() },
  StockOpname: { destroy: jest.fn() },
}));

jest.mock("../../config", () => ({ db: { sync: jest.fn() } }));

interface ModelsDouble {
  Roles: { findOne: jest.Mock };
  MenuGroup: { findOne: jest.Mock };
  RoleMenuPermission: { findOne: jest.Mock; create: jest.Mock };
}

interface ActivityLog {
  logger: { warn: jest.Mock };
}

interface MigrationService {
  seedMenuGroupsAndItems: () => Promise<{ permissionsAssigned: number; errors: unknown[] }>;
}

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const { Roles, MenuGroup, RoleMenuPermission } = require("../../models") as ModelsDouble;
const { logger } = require("../../middlewares/activityLog.middleware") as ActivityLog;
const migrationService = require("../../services/migration.service") as MigrationService;
/* eslint-enable @typescript-eslint/no-require-imports */

describe("migration.service -- assignments without a menus map", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should skip an assignment that has no menus and still process the rest", async () => {
    Roles.findOne.mockResolvedValue({ id: "role-1" });
    MenuGroup.findOne.mockResolvedValue({ id: "menu-1" });
    RoleMenuPermission.findOne.mockResolvedValue(null);
    RoleMenuPermission.create.mockResolvedValue(true);

    const result = await migrationService.seedMenuGroupsAndItems();

    // Only the second assignment (one menu) yields a permission.
    expect(result.permissionsAssigned).toBe(1);
    expect(result.errors).toEqual([]);
    expect(RoleMenuPermission.create).toHaveBeenCalledTimes(1);
    expect(RoleMenuPermission.create).toHaveBeenCalledWith({
      roleId: "role-1",
      menuGroupId: "menu-1",
      permissionType: "read",
    });
  });

  it("should warn and continue when the assignment's role is missing", async () => {
    Roles.findOne.mockResolvedValue(null);

    const result = await migrationService.seedMenuGroupsAndItems();

    expect(result.permissionsAssigned).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith("Role not found: SUPERADMIN");
    expect(logger.warn).toHaveBeenCalledWith("Role not found: USER");
  });
});
