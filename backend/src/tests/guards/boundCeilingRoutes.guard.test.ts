/**
 * G-P3 (P18-03 § 15; P21-09c) — the bound menu ceiling (constants/facilityAccess
 * BOUND_MENU_CEILING) and the facility-accessible route marker (FACILITY_ACCESSIBLE_ROUTES) cannot
 * drift, over the REAL chains of every mounted route (fixtures/routeChains):
 *
 *  1. every slug the ceiling names is seeded (SEEDED_MENU_SLUGS), and the ceiling's roles are
 *     exactly the bound role set;
 *  2. every marked route's `dynamicAccess` (slug, action) is within the union of the ceilings —
 *     unless the gate is a `checkSelf` gate on a `self` entry with a `selfParam` (S-7, the caller's
 *     own row); otherwise a bound principal would be marked onto a route its menu refuses;
 *  3. every ceiling (slug, write) that gates SOME write route has at least one marked write route
 *     gated on it — or is on the reviewed PENDING list below, which names the card that marks it.
 *     A PENDING slug that becomes marked fails (the list only shrinks), and so does a stale one.
 *
 * Fail-before: the `bites` cases plant a ceiling write on a slug with unmarked write routes and a
 * marked route outside the ceilings — each is caught.
 */
import { loadRouteChains, gateOf, type RouteChain } from "../fixtures/routeChains";
import { BOUND_MENU_CEILING, FACILITY_ACCESSIBLE_ROUTES, FACILITY_BOUND_ROLES, type FacilityAccessibleRoute } from "../../constants/facilityAccess";
import { SEEDED_MENU_SLUGS } from "../../constants/seededMenuSlugs";

const routes: RouteChain[] = loadRouteChains();

/**
 * Ceiling writes whose write routes are not marked yet — each with the card that marks them
 * (ADR-124 Am. 5 § 4). Bound users cannot exist while FACILITY_BINDING_ENABLED is off.
 */
const PENDING: Readonly<Record<string, string>> = Object.freeze({
  calibration: "P21-09e — A-2 device create, A-3 edit, N-6 photos (P18-03 § 8.2), with their two-facility suites",
  esignature: "P21-03 / P21-04 — N-5, the IPM session signature (ADR-126 Am. 2 § 6)",
});

type Access = "read" | "write";
const normalize = (action: string): Access => (action.toLowerCase() === "read" ? "read" : "write");

/** The union of the ceilings: slug → the strongest access any bound role may hold. */
const union = (ceilings: Readonly<Record<string, Readonly<Record<string, Access>>>>): Map<string, Access> => {
  const out = new Map<string, Access>();
  for (const ceiling of Object.values(ceilings)) {
    for (const [slug, access] of Object.entries(ceiling)) {
      if (out.get(slug) !== "write") {
        out.set(slug, access);
      }
    }
  }
  return out;
};

interface Gate {
  readonly slugs: readonly string[];
  readonly actions: readonly Access[];
  readonly checkSelf: boolean;
}
const gatesOf = (route: RouteChain): Gate[] =>
  route.chain
    .map(gateOf)
    .filter((g): g is NonNullable<typeof g> => g !== null && g.gate === "dynamicAccess")
    .map((g) => ({
      slugs: (Array.isArray(g.args[0]) ? g.args[0] : [g.args[0]]) as string[],
      actions: ((Array.isArray(g.args[1]) ? g.args[1] : [g.args[1]]) as string[]).map(normalize),
      checkSelf: (g.args[2] as { checkSelf?: boolean } | undefined)?.checkSelf === true,
    }));

const marked = (): { route: RouteChain; entry: FacilityAccessibleRoute }[] =>
  Object.entries(FACILITY_ACCESSIBLE_ROUTES).flatMap(([file, keys]) =>
    Object.entries(keys).flatMap(([key, entry]) => {
      const route = routes.find((r) => r.file === file && r.key === key);
      return route ? [{ route, entry }] : [];
    }),
  );

/** Rule 2: the marked routes' gates outside the ceiling union. */
const outsideCeiling = (ceilingUnion: Map<string, Access>, entries: { route: RouteChain; entry: FacilityAccessibleRoute }[]): string[] =>
  entries.flatMap(({ route, entry }) =>
    gatesOf(route)
      .filter((g) => !(g.checkSelf && entry.kind === "self" && entry.selfParam))
      .flatMap((g) =>
        g.slugs.flatMap((slug) =>
          g.actions
            .filter((a) => {
              const cap = ceilingUnion.get(slug);
              return cap === undefined || (a === "write" && cap === "read");
            })
            .map((a) => `${route.file} ${route.key}: ${slug} ${a}`),
        ),
      ),
  );

/** Rule 3: ceiling write slugs with write routes, none of them marked, not PENDING; and stale PENDING entries. */
const unmarkedWrites = (
  ceilingUnion: Map<string, Access>,
  entries: { route: RouteChain; entry: FacilityAccessibleRoute }[],
  pending: Readonly<Record<string, string>>,
): string[] => {
  const writeRoutesOn = (slug: string, from: readonly RouteChain[]): RouteChain[] =>
    from.filter((r) => gatesOf(r).some((g) => g.slugs.includes(slug) && g.actions.includes("write")));
  const out: string[] = [];
  for (const [slug, access] of ceilingUnion) {
    if (access !== "write" || writeRoutesOn(slug, routes).length === 0) {
      continue;
    }
    const markedWrite = writeRoutesOn(slug, entries.filter((e) => e.entry.kind !== "read").map((e) => e.route)).length > 0;
    if (!markedWrite && !Object.hasOwn(pending, slug)) {
      out.push(`${slug}: write in the ceiling, no marked write route, not pending`);
    }
    if (markedWrite && Object.hasOwn(pending, slug)) {
      out.push(`${slug}: marked now — remove it from PENDING`);
    }
  }
  for (const slug of Object.keys(pending)) {
    if (ceilingUnion.get(slug) !== "write") {
      out.push(`${slug}: PENDING but not a ceiling write (stale)`);
    }
  }
  return out;
};

const CEILINGS = BOUND_MENU_CEILING as unknown as Readonly<Record<string, Readonly<Record<string, Access>>>>;

describe("G-P3 — the bound ceiling and the facility-accessible routes", () => {
  it("rule 1: the ceiling's roles are the bound role set, and every slug it names is seeded", () => {
    expect(Object.keys(CEILINGS).sort()).toEqual([...FACILITY_BOUND_ROLES].sort());
    const seeded = new Set<string>(SEEDED_MENU_SLUGS);
    expect([...union(CEILINGS).keys()].filter((s) => !seeded.has(s))).toEqual([]);
  });

  it("rule 2: every marked route's gate is within the union of the ceilings", () => {
    expect(marked().length).toBeGreaterThan(5);
    expect(outsideCeiling(union(CEILINGS), marked())).toEqual([]);
  });

  it("rule 3: every ceiling write with write routes has a marked write route, or is PENDING with its card", () => {
    expect(unmarkedWrites(union(CEILINGS), marked(), PENDING)).toEqual([]);
  });

  it("bites: a ceiling write on a slug whose write routes are unmarked (maintenance) is caught", () => {
    const planted = { ...CEILINGS, ROGUE: { maintenance: "write" as const } };
    expect(unmarkedWrites(union(planted), marked(), PENDING)).toEqual([expect.stringMatching(/^maintenance: write in the ceiling/)]);
  });

  it("bites: a marked route gated outside the ceilings (POST /calibration-records) is caught", () => {
    const route = routes.find((r) => r.file === "api/calibrationRecords.route.ts" && r.key === "POST /");
    expect(route).toBeDefined();
    const shrunk = new Map(union(CEILINGS));
    shrunk.set("calibration", "read");
    expect(outsideCeiling(shrunk, [{ route: route as RouteChain, entry: { kind: "write", reason: "planted" } }])).toEqual([
      "api/calibrationRecords.route.ts POST /: calibration write",
    ]);
  });

  it("bites: a PENDING entry for a slug that is not a ceiling write is stale", () => {
    expect(unmarkedWrites(union(CEILINGS), marked(), { ...PENDING, users: "planted" })).toEqual(["users: PENDING but not a ceiling write (stale)"]);
  });
});
