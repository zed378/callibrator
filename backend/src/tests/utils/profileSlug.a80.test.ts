/**
 * A-80 — the profile slug was `profile` in ROLE_MENU_ASSIGNMENTS and
 * `profile-page` in the seed.
 *
 * The seed (`seedMenuGroups()`) creates the Profile page as `profile-page`
 * under Account; the sidebar maps `profile-page` to /dashboard/profile
 * (menuGroup.service.js). ROLE_MENU_ASSIGNMENTS granted `profile` — a slug no
 * menu group has — so `seedMenuGroupsAndItems` logged "Menu group not found:
 * profile" and skipped it for EVERY role. Roles that hold `account` still saw
 * the page through the parent's cascade; TECHNICIAN, HEALTHCARE TECHNICIAN,
 * FACILITY MAINTENANCE, WAREHOUSE STAFF and ROOM USER had no Profile entry.
 *
 * Driven through the REAL seed and the REAL matrix builder
 * (fixtures/seededAuthorization), not through the constant's own data.
 */
import type * as ConstantsModule from "../../constants";
import type * as RoleConstants from "../../constants/roleConstants";

interface Seed {
    seed(): Promise<unknown>;
    roleId(name: string): string;
    grantedSlugs(name: string): string[];
    Roles: { findOne(...a: unknown[]): unknown; findByPk(...a: unknown[]): unknown };
    MenuGroup: {
        findAll(...a: unknown[]): unknown;
        findOne(...a: unknown[]): unknown;
        create(...a: unknown[]): unknown;
    };
    RoleMenuPermission: {
        findAll(...a: unknown[]): unknown;
        findOne(...a: unknown[]): unknown;
        create(...a: unknown[]): unknown;
        destroy(...a: unknown[]): unknown;
    };
}

const mockSeed: { current: Seed | null } = { current: null };
const seed = (): Seed => {
  if (!mockSeed.current) {
    throw new Error("seed not created");
  }
  return mockSeed.current;
};

jest.mock("../../models", () => {
  const roles = {
    findOne: (...args: unknown[]) => seed().Roles.findOne(...args),
    findByPk: (...args: unknown[]) => seed().Roles.findByPk(...args),
  };
  return {
    Role: roles,
    Roles: roles,
    MenuGroup: {
      findAll: (...args: unknown[]) => seed().MenuGroup.findAll(...args),
      findOne: (...args: unknown[]) => seed().MenuGroup.findOne(...args),
      create: (...args: unknown[]) => seed().MenuGroup.create(...args),
    },
    RoleMenuPermission: {
      findAll: (...args: unknown[]) => seed().RoleMenuPermission.findAll(...args),
      findOne: (...args: unknown[]) => seed().RoleMenuPermission.findOne(...args),
      create: (...args: unknown[]) => seed().RoleMenuPermission.create(...args),
      destroy: (...args: unknown[]) => seed().RoleMenuPermission.destroy(...args),
    },
  };
});
jest.mock("../../config", () => ({ db: {} }));
jest.mock("../../services/featureFlag.service", () => ({}));
jest.mock("../../utils/password.util", () => ({ hashPassword: jest.fn() }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn(),
  delPattern: jest.fn(),
  cacheKeys: { permissions: (id: string) => `permissions:${id}` },
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const { createSeededAuthorization } = require("../fixtures/seededAuthorization") as {
    createSeededAuthorization: () => Seed;
};
const { ROLE_MENU_ASSIGNMENTS } = require("../../constants") as typeof ConstantsModule;
const { ROLE_NAMES } = require("../../constants/roleConstants") as typeof RoleConstants;
const { logger } = require("../../middlewares/activityLog.middleware") as {
    logger: { warn: jest.Mock };
};
const RolesService = require("../../services/roles.service") as {
    getRolePermissionsMatrix: (roleId: string) => Promise<Record<string, string[]>>;
};
/* eslint-enable @typescript-eslint/no-require-imports */

beforeEach(async () => {
  jest.clearAllMocks();
  mockSeed.current = createSeededAuthorization();
  await mockSeed.current.seed();
});

describe("A-80 — every role is granted the Profile page the seed actually creates", () => {
  it.each(ROLE_MENU_ASSIGNMENTS.map((a: { roleName: string }) => a.roleName))(
    "%s is granted `profile-page` by the real seed",
    (role: string) => {
      expect(seed().grantedSlugs(role)).toContain("profile-page");
    },
  );

  it("the seed skips NO assigned slug (no 'Menu group not found' warning)", () => {
    const skipped = logger.warn.mock.calls
      .map(([message]: [unknown]) => String(message))
      .filter((message: string) => message.startsWith("Menu group not found"));
    expect(skipped).toEqual([]);
  });

  it("a TECHNICIAN — who holds no `account` grant — now has the Profile page in its matrix", async () => {
    expect(seed().grantedSlugs(ROLE_NAMES.TECHNICIAN)).not.toContain("account");

    const matrix = await RolesService.getRolePermissionsMatrix(seed().roleId(ROLE_NAMES.TECHNICIAN));

    expect(matrix["profile-page"]).toEqual(["write"]);
    expect(matrix["Profile"]).toEqual(["write"]);
  });
});
