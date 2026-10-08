/**
 * G-P2 (P18-03 § 15, § 13; P21-09c) — the sidebar and `GET /menu-groups/my-permissions` of a
 * facility-BOUND user, on the REAL seed (fixtures/seededMatrix) and the REAL menu service
 * (menuGroup.service#getRoleMenuAssignments, #getMyPermissions — the ceiling is applied in
 * effectivePermission, the one function the API gate reads too).
 *
 * 1. Each bound role's sidebar, written out by hand from Matrix B and the seed (the claim): nothing
 *    under Management or Security, no provider page.
 * 2. Every leaf a bound user sees has its page's LOAD route marked facility-accessible — or is on
 *    the reviewed PENDING_LOAD list naming the card that marks it (P21-09e marks the domain reads
 *    A-1 … A-8 with their two-facility suites). An entry whose route becomes marked fails (the list
 *    only shrinks). Bound users cannot exist while FACILITY_BINDING_ENABLED is off.
 * 3. `my-permissions` answers `facilityBound` and the capped permissions; an unbound caller's menu
 *    is unchanged (the ADR-102 suites stay green).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as MenuGroupService from "../../services/menuGroup.service";
import { seedRealMatrix } from "../fixtures/seededMatrix";
import { ROLE_IDS, ROLE_NAMES } from "../../constants/roleConstants";
import { FACILITY_ACCESSIBLE_ROUTES } from "../../constants/facilityAccess";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(undefined)),
  del: jest.fn(() => Promise.resolve(undefined)),
  delPattern: jest.fn(() => Promise.resolve(undefined)),
  cacheKeys: new Proxy({}, { get: (_t, name) => (...args: unknown[]) => `${String(name)}:${args.map(String).join(":")}` }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const menuService = jest.requireActual<typeof MenuGroupService>("../../services/menuGroup.service");

const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const USER = "cccccccc-0000-4000-8000-0000000000d1";

type Key = "HEALTCARE_ADMIN" | "HEALTHCARE_TECHNICIAN" | "FACILITY_MAINTENANCE" | "ROOM_USER";
const requester = (key: Key, bound = true): Record<string, unknown> => ({
  id: USER,
  roleId: ROLE_IDS[key],
  role: { id: ROLE_IDS[key], name: ROLE_NAMES[key] },
  clientFacilityId: bound ? F1 : null,
});

interface Item {
  path: string;
  items?: Item[];
}
const leaves = (items: Item[]): string[] => items.flatMap((i) => (i.items && i.items.length > 0 ? leaves(i.items) : [i.path]));
const sidebar = async (key: Key, bound = true): Promise<string[]> =>
  leaves(await menuService.getRoleMenuAssignments(ROLE_IDS[key], requester(key, bound))).sort();

/** The sidebar every bound role sees today (Matrix B ∩ the seed; the IPM entries are inactive until P22). */
const BASE = ["/dashboard", "/dashboard/calibration", "/dashboard/devices", "/dashboard/maintenance", "/dashboard/profile", "/dashboard/warehouses"];
/** Per role: the base, plus what that role's seed grants inside its ceiling (HA: `account` → Change Password; HT, FM: `esignature`). */
const BOUND_SIDEBARS: Readonly<Record<Key, readonly string[]>> = {
  HEALTCARE_ADMIN: [...BASE, "/dashboard/change-password"].sort(),
  HEALTHCARE_TECHNICIAN: [...BASE, "/dashboard/esignature"].sort(),
  FACILITY_MAINTENANCE: [...BASE, "/dashboard/esignature"].sort(),
  ROOM_USER: [...BASE].sort(),
};
const ALL_BOUND_LEAVES = [...new Set(Object.values(BOUND_SIDEBARS).flat())].sort();

/** A leaf → its page's LOAD route (file under src/routes, key) — read from the pages' services. */
const LOAD_ROUTE: Readonly<Record<string, readonly [string, string]>> = {
  "/dashboard": ["api/dashboard.route.ts", "GET /metrics"],
  "/dashboard/devices": ["api/calibrationDevices.route.ts", "GET /"],
  "/dashboard/calibration": ["api/certificates.route.ts", "GET /"],
  "/dashboard/maintenance": ["api/maintenance.route.ts", "GET /work-orders"],
  "/dashboard/warehouses": ["api/warehouse.route.ts", "GET /"],
  "/dashboard/profile": ["api/menuGroups.route.ts", "GET /my-permissions"],
  "/dashboard/change-password": ["api/auth.route.ts", "POST /just-update-password"],
  "/dashboard/esignature": ["api/esignature.route.ts", "GET /my-workflows"],
};

/** Leaves whose load route is not marked yet, with the card that marks it (ADR-124 Am. 5 § 4). */
const PENDING_LOAD: Readonly<Record<string, string>> = {
  "/dashboard": "P21-09e — A-11 (OQ-8), or the facility home A-10",
  "/dashboard/devices": "P21-09e — A-1 device list",
  "/dashboard/calibration": "P21-09e — A-7 certificates",
  "/dashboard/maintenance": "P21-09e — A-8 work orders (read)",
  "/dashboard/warehouses": "P21-09e — rooms (ADR-132 § 5)",
  "/dashboard/change-password": "P21-09e — the MFA / password self routes (with the reviewed settings skip, P18-03 § 10.2)",
  "/dashboard/esignature": "P21-03 / P21-04 — N-5, the IPM session signature (ADR-126 Am. 2 § 6)",
};

const isMarked = (file: string, key: string): boolean =>
  Boolean((FACILITY_ACCESSIBLE_ROUTES as Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>)[file]?.[key]);

beforeEach(async () => {
  mdb.reset();
  await seedRealMatrix(mdb);
});

describe("G-P2 — a bound user's sidebar on the real seed", () => {
  it.each(["HEALTCARE_ADMIN", "HEALTHCARE_TECHNICIAN", "FACILITY_MAINTENANCE", "ROOM_USER"] as const)("bound %s: exactly its bound sidebar", async (key) => {
    expect(await sidebar(key)).toEqual(BOUND_SIDEBARS[key]);
  });

  it("every bound leaf's load route is marked, or pending with its card; a pending route that became marked fails", () => {
    for (const leaf of ALL_BOUND_LEAVES) {
      const load = LOAD_ROUTE[leaf];
      expect({ leaf, mapped: load !== undefined }).toEqual({ leaf, mapped: true });
      const [file, key] = load as readonly [string, string];
      expect({ leaf, ok: isMarked(file, key) !== Object.hasOwn(PENDING_LOAD, leaf) }).toEqual({ leaf, ok: true });
    }
  });

  it("an unbound HEALTHCARE ADMIN's sidebar is unchanged (Management and the provider pages are there)", async () => {
    const unbound = await sidebar("HEALTCARE_ADMIN", false);
    expect(unbound).toEqual(expect.arrayContaining(["/dashboard/users", "/dashboard/devices", "/dashboard/audit"]));
    expect(unbound.length).toBeGreaterThan(BASE.length + 10);
  });
});

describe("P18-03 § 13 — GET /menu-groups/my-permissions", () => {
  it("a bound caller: facilityBound true and the capped permissions", async () => {
    const res = await menuService.getMyPermissions(requester("HEALTCARE_ADMIN"));
    expect(res.facilityBound).toBe(true);
    expect(res.superAdmin).toBe(false);
    expect(res.permissions["calibration"]).toBe("read");
    expect(res.permissions["users"]).toBeUndefined();
    expect(res.permissions["management"]).toBeUndefined();
  });

  it("a bound HEALTHCARE TECHNICIAN keeps calibration write (UD-4 (b) within the ceiling)", async () => {
    const res = await menuService.getMyPermissions(requester("HEALTHCARE_TECHNICIAN"));
    expect(res.permissions["calibration"]).toBe("write");
  });

  it("an unbound caller: facilityBound false and the role's permissions", async () => {
    const res = await menuService.getMyPermissions(requester("HEALTCARE_ADMIN", false));
    expect(res.facilityBound).toBe(false);
    expect(res.permissions["users"]).toBe("write");
  });
});
