/**
 * createSeededAuthorization() — the REAL seed, run against in-memory model
 * doubles, so a test can drive `dynamicAccess` with the permission matrix a
 * seeded database actually holds (A-76, A-80).
 *
 * Why: a hand-written matrix ("the admin roles hold Management write") is the
 * test author's belief about the seed, not the seed. A-76 exists because the
 * belief and the seed disagreed about who holds `management`; A-80 because the
 * constant and the seed disagreed about a slug. Hand-writing the matrix again
 * would test the belief a third time.
 *
 * What is real, and what is doubled:
 *   REAL    migrationService.seedMenuGroupsAndItems() — which runs the real
 *           seedMenuGroups() (menuData, parent/child passes) and then the real
 *           ROLE_MENU_ASSIGNMENTS loop (a slug with no seeded menu group is
 *           skipped with a warning, exactly as in production);
 *   REAL    RolesService.getRolePermissionsMatrix() — keys by menu name AND
 *           slug, and gives a parent's grant to its direct children;
 *   DOUBLE  the four models those two touch: MenuGroup, RoleMenuPermission,
 *           Roles/Role — plain arrays with the lookups the code uses. The
 *           `include: [{ as: "menu", include: [{ as: "children" }] }]` of the
 *           matrix query is emulated from the rows' `parentId`.
 *
 * Wiring (see routes/tenant.platform.a76.test.js):
 *
 *   const mockSeed = { current: null };
 *   jest.mock("../../models", () => ({
 *     MenuGroup: { findAll: (...a) => mockSeed.current.MenuGroup.findAll(...a), ... },
 *     ...
 *   }));
 *   // featureFlag.service and password.util are pulled in by migration.service
 *   // and must be mocked; redis.service get() must resolve null.
 *   mockSeed.current = createSeededAuthorization();
 *   await mockSeed.current.seed();
 *   principal.role.id = mockSeed.current.roleId(principal.role.name);
 *
 * Roles are global in the schema, so one role id per role NAME — a principal's
 * role id must be pointed at it with `roleId(name)`.
 */

const { ROLE_NAMES, ROLE_IDS } = require("../../constants/roleConstants");

const createSeededAuthorization = () => {
  const menuGroups = [];
  const grants = [];

  // One row per seeded role, keyed by the real seeded id.
  const roles = Object.keys(ROLE_IDS).map((key) => ({
    id: ROLE_IDS[key],
    name: ROLE_NAMES[key],
    status: "active",
  }));

  const makeMenuRow = (payload) => {
    const row = {
      ...payload,
      async update(values) {
        Object.assign(row, values);
        return row;
      },
      async destroy() {
        menuGroups.splice(menuGroups.indexOf(row), 1);
      },
    };
    return row;
  };

  const MenuGroup = {
    // seedMenuGroups asks only for deprecated groups; there are none here.
    findAll: jest.fn(async () => []),
    findOne: jest.fn(
      async ({ where = {} } = {}) => menuGroups.find((g) => g.slug === where.slug) || null,
    ),
    create: jest.fn(async (payload) => {
      if (payload.id && menuGroups.some((g) => g.id === payload.id)) {
        throw new Error(`duplicate menu group id ${payload.id}`);
      }
      const row = makeMenuRow({ id: payload.id || `generated-${menuGroups.length}`, ...payload });
      menuGroups.push(row);
      return row;
    }),
  };

  const RoleMenuPermission = {
    findOne: jest.fn(
      async ({ where = {} } = {}) =>
        grants.find(
          (g) => g.roleId === where.roleId && g.menuGroupId === where.menuGroupId,
        ) || null,
    ),
    create: jest.fn(async (payload) => {
      const row = { ...payload };
      grants.push(row);
      return row;
    }),
    destroy: jest.fn(async () => 0),
    // The matrix query: every grant of a role, with its menu and the menu's
    // direct children (`include: menu -> children`).
    findAll: jest.fn(async ({ where = {} } = {}) =>
      grants
        .filter((g) => g.roleId === where.roleId)
        .map((g) => {
          const menu = menuGroups.find((m) => m.id === g.menuGroupId);
          return {
            permissionType: g.permissionType,
            menu: menu
              ? {
                  id: menu.id,
                  name: menu.name,
                  slug: menu.slug,
                  children: menuGroups
                    .filter((c) => c.parentId === menu.id)
                    .map((c) => ({ name: c.name, slug: c.slug })),
                }
              : null,
          };
        }),
    ),
  };

  const Roles = {
    findOne: jest.fn(
      async ({ where = {} } = {}) => roles.find((r) => r.name === where.name) || null,
    ),
    findByPk: jest.fn(async (id) => roles.find((r) => r.id === id) || null),
  };

  /**
   * Run the real seed into the doubles.
   *
   * @returns {Promise<object>} the seed's own result object
   */
  const seed = async () => {
    // Required here, not at the top: the caller's jest.mock of the models
    // barrel must be in place, and must already delegate to this instance.
    const migrationService = require("../../services/migration.service");
    const result = await migrationService.seedMenuGroupsAndItems();
    if (result.errors.length > 0) {
      throw new Error(`seed failed: ${result.errors.join("; ")}`);
    }
    return result;
  };

  /**
   * The seeded role id for a role name.
   *
   * @param {string} name - a ROLE_NAMES value
   * @returns {string}
   */
  const roleId = (name) => {
    const role = roles.find((r) => r.name === name);
    if (!role) {
      throw new Error(`createSeededAuthorization: no seeded role "${name}"`);
    }
    return role.id;
  };

  /**
   * The slugs a role was actually granted by the seed.
   *
   * @param {string} name - a ROLE_NAMES value
   * @returns {string[]}
   */
  const grantedSlugs = (name) =>
    grants
      .filter((g) => g.roleId === roleId(name))
      .map((g) => menuGroups.find((m) => m.id === g.menuGroupId).slug);

  return {
    MenuGroup,
    RoleMenuPermission,
    Roles,
    seed,
    roleId,
    grantedSlugs,
    menuGroups,
    grants,
  };
};

module.exports = { createSeededAuthorization };
