/**
 * seededMatrix — the REAL seed run into memoryDb, so a route test's `dynamicAccess` decides on the
 * permission matrix a seeded database holds (P20-06; the memoryDb sibling of
 * fixtures/seededAuthorization.js, which doubles the models instead).
 *
 * REAL: `migration.service#seedMenuGroupsAndItems` (the real `seedMenuGroups` menuData and the
 * real `ROLE_MENU_ASSIGNMENTS` loop) writing through the real MenuGroup / RoleMenuPermission
 * models, and `roles.service#getRolePermissionsMatrix` reading them back with its include of the
 * children. DOUBLED: the redis cache the matrix reads first (the test file mocks
 * `services/redis.service` so `get` answers null), and the per-user overrides (none, unless the
 * test passes some).
 *
 * Roles are global: one row per seeded role name, keyed by `ROLE_IDS`; a principal's `role.id`
 * must be pointed at it (`withSeededRole`).
 */
import type { MemoryDb } from "./memoryDb";
import type { Principal } from "./routeClient";
import { ROLE_IDS, ROLE_LEVELS, ROLE_NAMES } from "../../constants/roleConstants";

interface SeedService {
  seedMenuGroupsAndItems(): Promise<{ errors: string[] }>;
}
interface OverrideSource {
  getUserOverrideMatrix(userId: string): Promise<Record<string, string>>;
}

type RoleKey = keyof typeof ROLE_IDS;

/** Seed every built-in role, then the real menus and grants. Throws on a seed error. */
export const seedRealMatrix = async (mdb: MemoryDb, overrides: Record<string, Record<string, string>> = {}): Promise<void> => {
  jest.requireActual<object>("../../models"); // the barrel registers the models on memoryDb
  mdb.seed(
    "Role",
    (Object.keys(ROLE_IDS) as RoleKey[]).map((key) => ({
      id: ROLE_IDS[key],
      name: ROLE_NAMES[key],
      status: "active",
      roleLevel: ROLE_LEVELS[key],
    })),
  );
  const service = jest.requireActual<SeedService>("../../services/migration.service");
  const result = await service.seedMenuGroupsAndItems();
  if (result.errors.length > 0) {
    throw new Error(`seed failed: ${result.errors.join("; ")}`);
  }
  const userOverrides = jest.requireActual<OverrideSource>("../../services/userPermission.service");
  jest.spyOn(userOverrides, "getUserOverrideMatrix").mockImplementation((userId: string) => Promise.resolve(overrides[userId] ?? {}));
};

/** The principal with its role id pointed at the seeded row of its role name. */
export const withSeededRole = (principal: Principal): Principal => {
  const key = (Object.keys(ROLE_NAMES) as (keyof typeof ROLE_NAMES)[]).find((k) => ROLE_NAMES[k] === principal.role.name && k in ROLE_IDS) as RoleKey | undefined;
  if (key === undefined) {
    throw new Error(`no seeded role named ${principal.role.name}`);
  }
  return { ...principal, role: { ...principal.role, id: ROLE_IDS[key] } };
};
