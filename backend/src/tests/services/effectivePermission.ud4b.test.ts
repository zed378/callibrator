/**
 * P20-06 — the grant table of spec MEMORY/specs/P18-01-02 § 3.1 as a seeded database holds it,
 * explicit AND inherited cells: the REAL seed (seedMenuGroups + ROLE_MENU_ASSIGNMENTS) into
 * memoryDb, read back by the REAL roles.service#getRolePermissionsMatrix and decided by the REAL
 * effectivePermission#accessOf (fixtures/seededMatrix). The expected table is written out by hand
 * from the spec — it is the claim, not something derived from the code under test.
 *
 * Also the union and override semantics UD-4 (b) relies on: an explicit `calibration: write` row
 * beside an `equipment: read` row yields write (grants union), and a per-user `calibration: read`
 * override still yields read (an override REPLACES the role grant, ADR-102 — the migration never
 * touches `user_menu_permissions`).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import { seedRealMatrix } from "../fixtures/seededMatrix";
import type * as EffectivePermission from "../../services/effectivePermission.service";
import { ROLE_IDS, ROLE_NAMES } from "../../constants/roleConstants";
import { toUserId } from "../../types/ids";

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
const { accessOf, loadPermissionSources } = jest.requireActual<typeof EffectivePermission>("../../services/effectivePermission.service");

const OVERRIDDEN = "cccccccc-0000-4000-8000-0000000000bb";
const PLAIN = "cccccccc-0000-4000-8000-0000000000aa";

type Key = keyof typeof ROLE_IDS;
const access = async (key: Key, slug: string, userId: string = PLAIN): Promise<string | null> => {
  const sources = await loadPermissionSources({ id: toUserId(userId), role: { id: ROLE_IDS[key], name: ROLE_NAMES[key] } });
  return accessOf(sources, slug);
};

beforeEach(async () => {
  mdb.reset();
  await seedRealMatrix(mdb, { [OVERRIDDEN]: { calibration: "read" } });
});

/** Spec P18-01-02 § 3.1, written out: role → [calibration, ipm, ipm-templates, client-facilities]. */
const TABLE: readonly [Key, string | null, string | null, string | null, string | null][] = [
  ["HEALTCARE_ADMIN", "write", "write", "write", "write"],
  ["CALIBRATOR_ADMIN", "write", "write", "write", "write"],
  ["ENGINEERING_MANAGER", "read", "read", "read", "read"],
  ["SUPERVISOR", "read", "read", "read", null],
  ["TECHNICIAN", "write", "write", "read", null],
  ["HEALTHCARE_TECHNICIAN", "write", "write", "read", null],
  ["FACILITY_MAINTENANCE", "read", "write", "read", null],
  ["WAREHOUSE_STAFF", "read", "read", "read", null],
  ["ROOM_USER", "read", "read", "read", null],
  ["USER", "read", "read", "read", null],
];

describe("spec P18-01-02 § 3.1 on the seeded matrix", () => {
  it.each(TABLE)("%s: calibration %s, ipm %s, ipm-templates %s, client-facilities %s", async (key, calibration, ipm, templates, facilities) => {
    expect(await access(key, "calibration")).toBe(calibration);
    expect(await access(key, "ipm")).toBe(ipm);
    expect(await access(key, "ipm-templates")).toBe(templates);
    expect(await access(key, "client-facilities")).toBe(facilities);
  });

  it("the technician keeps equipment READ: the write is on `calibration` only (union, not a widened parent)", async () => {
    expect(await access("TECHNICIAN", "equipment")).toBe("read");
    expect(await access("TECHNICIAN", "certificate")).toBe("read");
    expect(await access("TECHNICIAN", "maintenance")).toBe("read");
  });

  it("a per-user `calibration: read` override still yields read for a technician", async () => {
    expect(await access("TECHNICIAN", "calibration", OVERRIDDEN)).toBe("read");
  });

  it("the three new menu groups are seeded inactive, under their parents", () => {
    const groups = mdb.rows("MenuGroup");
    const bySlug = (slug: string): Record<string, unknown> | undefined => groups.find((g) => g["slug"] === slug);
    const parentSlug = (slug: string): unknown => bySlug(String(groups.find((g) => g["id"] === bySlug(slug)?.["parentId"])?.["slug"]))?.["slug"];
    expect(["ipm", "ipm-templates", "client-facilities"].map((s) => [s, bySlug(s)?.["isActive"], parentSlug(s)])).toEqual([
      ["ipm", false, "equipment"],
      ["ipm-templates", false, "equipment"],
      ["client-facilities", false, "mgmt-organization"],
    ]);
  });
});
