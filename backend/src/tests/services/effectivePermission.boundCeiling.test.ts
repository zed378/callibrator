/**
 * G-P1 (P18-03 § 5, § 15; P21-09c) — the bound menu ceiling in the effective permission, on the
 * REAL seeded matrix (fixtures/seededMatrix: seedMenuGroups + ROLE_MENU_ASSIGNMENTS into memoryDb,
 * read back by roles.service#getRolePermissionsMatrix).
 *
 * For each bound role × EVERY seeded slug (SEEDED_MENU_SLUGS — the seed's list, not the ceiling's):
 * the bound effective access is never above the ceiling, and equals min(unbound, ceiling); a
 * per-user override above the ceiling yields the ceiling; an unbound principal of the same role is
 * unchanged. The spot table below is written by hand from Matrix B and the seed — the claim, not a
 * derivation of the code under test.
 *
 * Fail-before: with the ceiling step removed from loadPermissionSources a bound HEALTHCARE ADMIN
 * holds `users`, `management` and `calibration` write (its role's grants).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as EffectivePermission from "../../services/effectivePermission.service";
import { seedRealMatrix } from "../fixtures/seededMatrix";
import { ROLE_IDS, ROLE_NAMES } from "../../constants/roleConstants";
import { SEEDED_MENU_SLUGS } from "../../constants/seededMenuSlugs";
import { BOUND_MENU_CEILING, FACILITY_BOUND_ROLES } from "../../constants/facilityAccess";
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
const { accessOf, loadPermissionSources, isBound } = jest.requireActual<typeof EffectivePermission>("../../services/effectivePermission.service");

const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const PLAIN = "cccccccc-0000-4000-8000-0000000000c1";
const LIFTED = "cccccccc-0000-4000-8000-0000000000c2";

type Access = "read" | "write" | null;
const RANK: Record<string, number> = { none: 0, read: 1, write: 2 };
const rank = (a: Access): number => RANK[a ?? "none"] ?? 0;

const roleIdOf = (name: string): string => {
  const key = (Object.keys(ROLE_NAMES) as (keyof typeof ROLE_NAMES)[]).find((k) => ROLE_NAMES[k] === name && k in ROLE_IDS) as keyof typeof ROLE_IDS;
  return ROLE_IDS[key];
};

const accessFor = async (role: string, slug: string, opts: { bound?: boolean; user?: string; apiKey?: boolean } = {}): Promise<Access> => {
  const sources = await loadPermissionSources({
    id: toUserId(opts.user ?? PLAIN),
    role: { id: roleIdOf(role), name: role },
    clientFacilityId: opts.bound === false ? null : F1,
    isApiKey: opts.apiKey ?? false,
  });
  return accessOf(sources, slug);
};

/** Every seeded slug lifted to write for this user (an override above any ceiling). */
const LIFT_ALL = Object.fromEntries(SEEDED_MENU_SLUGS.map((s) => [s, "write"]));

beforeEach(async () => {
  mdb.reset();
  await seedRealMatrix(mdb, { [LIFTED]: LIFT_ALL });
});

describe("G-P1 — bound effective access = min(unbound, ceiling) for every seeded slug", () => {
  it.each(FACILITY_BOUND_ROLES.map((r) => [r]))("%s", async (role) => {
    const ceiling = BOUND_MENU_CEILING[role] as Readonly<Record<string, string>>;
    for (const slug of SEEDED_MENU_SLUGS) {
      const unbound = await accessFor(role, slug, { bound: false });
      const bound = await accessFor(role, slug);
      const cap = (Object.hasOwn(ceiling, slug) ? ceiling[slug] : null) as Access;
      expect({ slug, bound }).toEqual({ slug, bound: rank(unbound) <= rank(cap) ? unbound : cap });
      expect(rank(bound)).toBeLessThanOrEqual(rank(cap));
    }
  });

  it.each(FACILITY_BOUND_ROLES.map((r) => [r]))("%s: a per-user override above the ceiling yields the ceiling", async (role) => {
    const ceiling = BOUND_MENU_CEILING[role] as Readonly<Record<string, string>>;
    for (const slug of SEEDED_MENU_SLUGS) {
      const cap = (Object.hasOwn(ceiling, slug) ? ceiling[slug] : null) as Access;
      expect({ slug, access: await accessFor(role, slug, { user: LIFTED }) }).toEqual({ slug, access: cap });
    }
  });
});

describe("G-P1 — the spot table (Matrix B on the seed, by hand)", () => {
  it.each([
    ["HEALTHCARE ADMIN", "calibration", "read"],
    ["HEALTHCARE ADMIN", "users", null],
    ["HEALTHCARE ADMIN", "management", null],
    ["HEALTHCARE ADMIN", "client-facilities", null],
    ["HEALTHCARE ADMIN", "ipm", "read"],
    ["HEALTHCARE TECHNICIAN", "calibration", "write"],
    ["HEALTHCARE TECHNICIAN", "ipm", "write"],
    ["HEALTHCARE TECHNICIAN", "esignature", "write"],
    ["HEALTHCARE TECHNICIAN", "tickets-raise", null],
    ["HEALTHCARE TECHNICIAN", "stock", null],
    ["FACILITY MAINTENANCE", "ipm", "read"],
    ["FACILITY MAINTENANCE", "esignature", "write"],
    ["ROOM USER", "warehouse", "read"],
    ["ROOM USER", "profile-page", "write"],
    ["ROOM USER", "esignature", null],
  ] as const)("bound %s on %s: %s", async (role, slug, expected) => {
    expect(await accessFor(role, slug)).toBe(expected);
  });

  it("a role outside the bound set on a bound row gets the empty ceiling (fail closed)", async () => {
    expect(await accessFor("TECHNICIAN", "calibration")).toBeNull();
    expect(await accessFor("TECHNICIAN", "home")).toBeNull();
  });

  it("a bound principal with no role name gets the empty ceiling", async () => {
    const sources = await loadPermissionSources({ id: toUserId(PLAIN), role: null, clientFacilityId: F1 });
    expect(sources.ceiling).toEqual({});
    expect(accessOf(sources, "home")).toBeNull();
  });

  it("unbound principals are untouched: the same role unbound keeps its grants", async () => {
    expect(await accessFor("HEALTHCARE ADMIN", "users", { bound: false })).toBe("write");
    expect(await accessFor("HEALTHCARE ADMIN", "calibration", { bound: false })).toBe("write");
  });

  it("an API-key principal is never bound, whatever its row says", () => {
    expect(isBound({ clientFacilityId: F1, isApiKey: true })).toBe(false);
    expect(isBound({ clientFacilityId: F1 })).toBe(true);
    expect(isBound({ clientFacilityId: "" })).toBe(false);
    expect(isBound(null)).toBe(false);
  });

  it("the super admin is never capped", async () => {
    const sources = await loadPermissionSources({ id: toUserId(PLAIN), role: { id: ROLE_IDS.SUPER_ADMIN, name: ROLE_NAMES.SUPER_ADMIN }, clientFacilityId: F1 });
    expect(sources.superAdmin).toBe(true);
    expect(accessOf(sources, "users")).toBe("write");
  });
});
