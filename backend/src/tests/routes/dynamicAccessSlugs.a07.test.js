/**
 * A-07 — every `dynamicAccess` resource must be a menu SLUG the real seed creates.
 *
 * WHY
 *
 * `dynamicAccess(menu, action)` looks `menu` up, verbatim and case-sensitively,
 * in a permission matrix keyed by each granted menu's NAME and SLUG
 * (`roles.service.js#getRolePermissionsMatrix`). API keys take a different path:
 * `apiKey.service.js#scopeAllows` LOWER-CASES the resource and compares it with
 * the key's scopes, which are slugs. So a gate that names a menu by anything but
 * its slug is decided by two different vocabularies:
 *
 *   - a menu NAME ("Vendors", "Management") works for users only because the
 *     matrix happens to be keyed by name too, and for API keys only when the
 *     lower-cased name happens to equal the slug;
 *   - a name that matches NO menu ("Finance" — the menu is "Asset Finance",
 *     slug `finance`; "AuditLogs") is in nobody's matrix. `finance.route.js`
 *     gated on ["Finance", "Billing"], so a user holding the `finance` grant
 *     (HEALTHCARE ADMIN, CALIBRATOR ADMIN, ENGINEERING MANAGER all do) was
 *     refused on all six routes, while an API key scoped `finance:read` passed:
 *     the same grant, two answers.
 *
 * The boot check (`authorizationWiring.util.js`, A-58) refuses a name that
 * matches NOTHING, but accepts a menu name and only warns on a dead alias inside
 * an OR gate. This test is stricter on purpose: a slug and nothing else.
 *
 * HOW — two independent enumerations, so neither can hide the other's blind spot:
 *
 *   1. RUNTIME. `dynamicAccess` is replaced by a recorder and EVERY module under
 *      `src/routes` is required, so every gate that is actually constructed is
 *      seen with its real, evaluated argument — including computed ones
 *      (`search.route.js` passes `SEARCH_MENUS`), which the static scanner can
 *      only report as unverified. A gate spelled in a shape no parser expects is
 *      still recorded, because recording does not parse anything.
 *   2. STATIC. The boot check's own source scanner (`collectRouteGates`), which
 *      carries file and line, and which must agree with (1) on the gate count.
 *
 * The vocabulary is the slugs in the real seed (`seedMenuGroups.util.js`,
 * `menuData`), read by the boot check's `seededMenuSlugs` — not `MENU_SLUGS`,
 * which is known to be a subset of the seed (A-04 addendum; see the card).
 *
 * Verified fail-before: against HEAD before this change, 31 gates (37 names)
 * in 7 route files named something other than a seeded slug, and the runtime
 * enumeration reports the same set.
 */

const path = require("path");
const fs = require("fs");

// ---- 1. the runtime recorder -------------------------------------------------
// Every export of the real module is replaced; nothing the route files call at
// load time touches the database. The recorder notes which route file built the
// gate from the call stack, so a failure names its file.
const recorded = [];
const ROUTES_DIR = path.join(__dirname, "..", "..", "routes");

jest.mock("../../middlewares/dynamicAccess.middleware", () => {
  const passthrough = (req, res, next) => next();
  return {
    dynamicAccess: jest.fn((menuGroup, permissionType, options) => {
      const frame = (new Error().stack || "")
        .split("\n")
        .find((line) => /[\\/]src[\\/]routes[\\/]/.test(line));
      recorded.push({ menuGroup, permissionType, options, frame: frame ? frame.trim() : "?" });
      return passthrough;
    }),
    principalHasMenuPermission: jest.fn(),
    hasDynamicPermission: jest.fn(passthrough),
    selfOwnerIdFromPath: jest.fn(),
    tenantIdsNamedBy: jest.fn(),
    ownerIdsNamedBy: jest.fn(),
  };
});

const {
  collectRouteGates,
  seededMenuSlugs,
} = require("../../utils/authorizationWiring.util");

const listRouteFiles = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listRouteFiles(full));
    } else if (entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
};

const ROUTE_FILES = listRouteFiles(ROUTES_DIR);
const SLUGS = seededMenuSlugs();

const namesOf = (menuGroup) => (Array.isArray(menuGroup) ? menuGroup : [menuGroup]);

beforeAll(() => {
  // Requiring a router runs its top level, which is where every
  // `dynamicAccess(...)` gate is constructed.
  for (const file of ROUTE_FILES) {
    require(file);
  }
});

describe("A-07 — dynamicAccess resources are seeded menu slugs", () => {
  it("the seed vocabulary is lowercase slugs, so users and API keys see the same names", () => {
    // `scopeAllows` lower-cases the resource; the matrix does not. They agree
    // exactly when every resource is already lowercase — which a seeded slug is.
    expect(SLUGS.size).toBeGreaterThan(40);
    for (const slug of SLUGS) {
      expect(slug).toBe(slug.toLowerCase());
    }
  });

  it("the enumeration saw the route tree (a scan that finds nothing is not a pass)", () => {
    expect(ROUTE_FILES.length).toBeGreaterThan(40);
    expect(recorded.length).toBeGreaterThan(100);
  });

  it("RUNTIME: every gate a route module constructs names only seeded menu slugs", () => {
    const offenders = [];
    for (const gate of recorded) {
      for (const name of namesOf(gate.menuGroup)) {
        if (typeof name !== "string" || !SLUGS.has(name)) {
          offenders.push(`${JSON.stringify(name)} at ${gate.frame}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("STATIC: every statically-resolvable gate names only seeded menu slugs (file:line)", () => {
    const offenders = [];
    for (const gate of collectRouteGates()) {
      if (gate.names === null) {
        continue; // computed — covered by the RUNTIME test above
      }
      for (const name of gate.names) {
        if (!SLUGS.has(name)) {
          offenders.push(`${gate.file}:${gate.line} ${JSON.stringify(name)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the two enumerations agree on how many gates there are", () => {
    // If the static scanner missed a gate (a shape it cannot parse), the
    // runtime count is higher and this names the gap rather than hiding it.
    // Gates built inside a function body at request time are not constructed
    // by `require`; none exist in src/routes today, and one appearing would
    // make the static count higher — also named here.
    expect(recorded.length).toBe(collectRouteGates().length);
  });

  it("the computed gate (search) resolves at runtime to seeded slugs", () => {
    const computed = collectRouteGates().filter((gate) => gate.names === null);
    expect(computed.map((gate) => path.basename(gate.file))).toEqual(["search.route.js"]);

    const { SEARCH_MENUS } = require("../../services/search.service");
    expect(SEARCH_MENUS.length).toBeGreaterThan(0);
    for (const menu of SEARCH_MENUS) {
      expect(SLUGS.has(menu)).toBe(true);
    }
  });
});
