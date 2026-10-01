/**
 * A-311 — every resource a `dynamicAccess` gate checks is a scope an API key
 * can be given, and every scope names a seeded menu.
 *
 * WHY
 *
 * `dynamicAccess(resource, action)` authorizes an API key by its scopes
 * (apiKey.service#scopeAllows), and `POST /api-keys` accepts only the scopes in
 * `API_KEY_SCOPE_RESOURCES` (packages/contracts, the list the create dialog
 * offers). A gate whose resource is not on that list can never be opened by any
 * key. Until A-311 the list was `MENU_SLUGS`, a subset of the seed, and
 * calibration, certificates, maintenance, notifications and reports were
 * unreachable to every integration.
 *
 * HOW
 *
 * As A-07 does: `dynamicAccess` is replaced by a recorder and every route module
 * is required, so every gate actually constructed is seen with its evaluated
 * argument. Each recorded resource must be on the scope list; each scope must
 * be a seeded menu slug (the vocabulary the gates themselves are held to).
 */
import fs from "node:fs";
import path from "node:path";
import type * as Contracts from "@callibrator/contracts";
import type * as Wiring from "../../utils/authorizationWiring.util";

const recorded: { resource: string; frame: string }[] = [];

jest.mock("../../middlewares/dynamicAccess.middleware", () => {
  const passthrough = (_req: unknown, _res: unknown, next: () => void): void => {
    next();
  };
  return {
    dynamicAccess: jest.fn((menuGroup: string | string[]) => {
      const frame = (new Error().stack ?? "").split("\n").find((line) => /[/\\]src[/\\]routes[/\\]/.test(line)) ?? "?";
      for (const resource of Array.isArray(menuGroup) ? menuGroup : [menuGroup]) {
        recorded.push({ resource, frame: frame.trim() });
      }
      return passthrough;
    }),
    principalHasMenuPermission: jest.fn(),
    hasDynamicPermission: jest.fn(passthrough),
    selfOwnerIdFromPath: jest.fn(),
    tenantIdsNamedBy: jest.fn(),
    ownerIdsNamedBy: jest.fn(),
  };
});

const { API_KEY_SCOPE_RESOURCES } = jest.requireActual<typeof Contracts>("@callibrator/contracts");
const { seededMenuSlugs } = jest.requireActual<typeof Wiring>("../../utils/authorizationWiring.util");

const ROUTES_DIR = path.join(__dirname, "..", "..", "routes");
const routeFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return routeFiles(full);
    }
    return /\.(js|ts)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });

beforeAll(() => {
  for (const file of routeFiles(ROUTES_DIR)) {
    // Requiring a router constructs its gates.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- each route module, for its side effect of building its gates
    require(file);
  }
});

describe("A-311 — API-key scopes cover every dynamicAccess resource", () => {
  const scopes = new Set<string>(API_KEY_SCOPE_RESOURCES);

  it("the enumeration saw the gates (a scan that finds nothing is not a pass)", () => {
    expect(recorded.length).toBeGreaterThan(100);
  });

  it("every resource a gate checks is a scope a key can be given", () => {
    const missing = [...new Set(recorded.filter((r) => !scopes.has(r.resource)).map((r) => r.resource))].sort();
    expect(missing).toEqual([]);
  });

  it("every scope names a seeded menu slug", () => {
    const seeded = seededMenuSlugs();
    expect([...scopes].filter((s) => !seeded.has(s)).sort()).toEqual([]);
  });

  it("the list holds no duplicates", () => {
    expect(scopes.size).toBe(API_KEY_SCOPE_RESOURCES.length);
  });
});
