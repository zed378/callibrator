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
 * (fixtures/seededAuthorization.js), not through the constant's own data.
 */

const mockSeed = { current: null };

jest.mock("../../models", () => {
  const roles = {
    findOne: (...args) => mockSeed.current.Roles.findOne(...args),
    findByPk: (...args) => mockSeed.current.Roles.findByPk(...args),
  };
  return {
    Role: roles,
    Roles: roles,
    MenuGroup: {
      findAll: (...args) => mockSeed.current.MenuGroup.findAll(...args),
      findOne: (...args) => mockSeed.current.MenuGroup.findOne(...args),
      create: (...args) => mockSeed.current.MenuGroup.create(...args),
    },
    RoleMenuPermission: {
      findAll: (...args) => mockSeed.current.RoleMenuPermission.findAll(...args),
      findOne: (...args) => mockSeed.current.RoleMenuPermission.findOne(...args),
      create: (...args) => mockSeed.current.RoleMenuPermission.create(...args),
      destroy: (...args) => mockSeed.current.RoleMenuPermission.destroy(...args),
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
  cacheKeys: { permissions: (id) => `permissions:${id}` },
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { createSeededAuthorization } = require("../fixtures/seededAuthorization");
const { ROLE_MENU_ASSIGNMENTS, ROLE_NAMES } = require("../../constants");
const { logger } = require("../../middlewares/activityLog.middleware");
const RolesService = require("../../services/roles.service");

beforeEach(async () => {
  jest.clearAllMocks();
  mockSeed.current = createSeededAuthorization();
  await mockSeed.current.seed();
});

describe("A-80 — every role is granted the Profile page the seed actually creates", () => {
  it.each(ROLE_MENU_ASSIGNMENTS.map((a) => a.roleName))(
    "%s is granted `profile-page` by the real seed",
    (role) => {
      expect(mockSeed.current.grantedSlugs(role)).toContain("profile-page");
    },
  );

  it("the seed skips NO assigned slug (no 'Menu group not found' warning)", () => {
    const skipped = logger.warn.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.startsWith("Menu group not found"));
    expect(skipped).toEqual([]);
  });

  it("a TECHNICIAN — who holds no `account` grant — now has the Profile page in its matrix", async () => {
    expect(mockSeed.current.grantedSlugs(ROLE_NAMES.TECHNICIAN)).not.toContain("account");

    const matrix = await RolesService.getRolePermissionsMatrix(
      mockSeed.current.roleId(ROLE_NAMES.TECHNICIAN),
    );

    expect(matrix["profile-page"]).toEqual(["write"]);
    expect(matrix.Profile).toEqual(["write"]);
  });
});
