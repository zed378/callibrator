/**
 * P21-09 — G-09 of docs/SECURITY/15 § 11 (ADR-124 Am. 1 § 4; P18-03 spec § 9; AM-11 refined):
 * FACILITY_ACCESSIBLE_ROUTES never opens an administrative route to a facility-bound principal.
 *
 * Over the REAL chains of the marked routes (every route module loaded, the gate factories
 * tagged — fixtures/routeChains), an entry is refused when:
 *  1. its chain carries `superAdminOnly`, an `rbac` naming the super admin, TENANT_ADMIN or any
 *     role of level ≥ 8, a `checkRoleLevel(n ≥ 8)`, or any `abac`;
 *  2. a `dynamicAccess` slug is on the administrative deny-list below — unless the entry is a
 *     `self` route with a `selfParam` whose gate is `checkSelf` (S-7) — or names an action outside
 *     the union of the bound menu ceilings (P18-03 § 5.2, Matrix B);
 *  3. it acts on `certificate` with anything but `read` (issuing is the laboratory's);
 *  4. the route is `public` in routeGateExemptions (a marker means nothing without a principal);
 *  5. it has no reason; or it is `self` while the route is neither a self/inline exemption nor a
 *     `checkSelf` gate with a `selfParam`;
 * and every entry must name a route that exists (a stale entry would mark whatever later takes
 * the key). `denyPlatformAuthoring` is NOT a criterion (it marks Part 11 authorship, ADR-052).
 *
 * The deny-list lives HERE and changes only with an ADR; the marked list changes by review.
 * Fail-before: the `bites` cases plant markers on POST /api-keys, PATCH /users/edit, a tenant
 * backup route, POST /certificates/:certificateId/approve and PUT /users/:userId/client-facility —
 * each is refused.
 */
import { loadRouteChains, gateOf, type RouteChain } from "../fixtures/routeChains";
import { FACILITY_ACCESSIBLE_ROUTES, type FacilityAccessibleRoute } from "../../constants/facilityAccess";
import { ROUTE_GATE_EXEMPTIONS } from "../../constants/routeGateExemptions";
import { ROLE_LEVELS } from "../../constants/roleConstants";

const routes: RouteChain[] = loadRouteChains();

/** The administrative slugs no marked route may be gated on (P18-03 § 9 rule 2). */
const DENY_SLUGS = new Set([
  "users", "roles", "permissions", "user-permissions", "menu-groups", "sessions", "tenants", "tenant-hierarchy",
  "tenant-lifecycle", "client-facilities", "access-requests", "management", "security", "oidc", "webauthn",
  "network-security", "scim", "gdpr", "custom-domains", "api-keys", "webhooks", "storage", "feature-flags", "billing",
  "finance", "metered-billing", "audit", "data-retention", "batch-jobs", "content",
]);

/** The union of the bound menu ceilings (P18-03 § 5.2): what a bound role may hold at most. */
const CEILING_UNION: Readonly<Record<string, readonly string[]>> = {
  home: ["read"],
  dashboard: ["read"],
  equipment: ["read"],
  calibration: ["read", "write", "create", "update"],
  certificate: ["read"],
  maintenance: ["read"],
  ipm: ["read", "write", "create", "update"],
  "ipm-templates": ["read"],
  warehouse: ["read"],
  esignature: ["write", "create"],
  "profile-page": ["read", "write", "update"],
  "change-password": ["read", "write", "update"],
  notifications: ["read"],
};

const ADMIN_ROLE_LEVEL = 8;
const ADMIN_ROLES = new Set(["SUPERADMIN", "SUPER_ADMIN", "TENANT_ADMIN"]);
const levelOf = (role: string): number => (ROLE_LEVELS as Readonly<Record<string, number | undefined>>)[role.replace(/ /g, "_")] ?? 0;

type Exemptions = Readonly<Record<string, Readonly<Record<string, { kind: string } | undefined>> | undefined>>;
const exemptions = ROUTE_GATE_EXEMPTIONS as unknown as Exemptions;

/** Why `entry` may not mark `route`, or [] (rules 1 – 5). */
const refusals = (route: RouteChain, entry: FacilityAccessibleRoute): string[] => {
  const out: string[] = [];
  const gates = route.chain.map(gateOf).filter((g): g is NonNullable<typeof g> => g !== null);
  const exemption = exemptions[route.file]?.[route.key];
  for (const g of gates) {
    if (g.gate === "superAdminOnly" || g.gate === "abac") {
      out.push(`rule 1: ${g.gate}`);
    }
    if (g.gate === "rbac") {
      const roles = (g.args[0] ?? []) as string[];
      if (roles.some((r) => ADMIN_ROLES.has(r) || levelOf(r) >= ADMIN_ROLE_LEVEL)) {
        out.push(`rule 1: rbac(${roles.join(",")})`);
      }
    }
    if (g.gate === "checkRoleLevel" && Number(g.args[0] ?? 1) >= ADMIN_ROLE_LEVEL) {
      out.push(`rule 1: checkRoleLevel(${String(g.args[0])})`);
    }
    if (g.gate === "dynamicAccess") {
      const slugs = (Array.isArray(g.args[0]) ? g.args[0] : [g.args[0]]) as string[];
      const actions = (Array.isArray(g.args[1]) ? g.args[1] : [g.args[1]]) as string[];
      const checkSelf = (g.args[2] as { checkSelf?: boolean } | undefined)?.checkSelf === true;
      for (const slug of slugs) {
        if (DENY_SLUGS.has(slug) && !(entry.kind === "self" && entry.selfParam && checkSelf)) {
          out.push(`rule 2: dynamicAccess("${slug}") is administrative`);
        }
        if (slug === "certificate" && actions.some((a) => a !== "read")) {
          out.push("rule 3: a certificate action other than read");
        }
        if (!DENY_SLUGS.has(slug) && actions.some((a) => !(CEILING_UNION[slug] ?? []).includes(a))) {
          out.push(`rule 2: dynamicAccess("${slug}", ${actions.join("/")}) is outside the bound ceilings`);
        }
      }
    }
  }
  if (exemption?.kind === "public") {
    out.push("rule 4: a public route");
  }
  if (!entry.reason.trim()) {
    out.push("rule 5: no reason");
  }
  if (entry.kind === "self") {
    const selfExempt = exemption?.kind === "self" || exemption?.kind === "inline";
    const selfGate = Boolean(entry.selfParam) && gates.some((g) => g.gate === "dynamicAccess" && (g.args[2] as { checkSelf?: boolean } | undefined)?.checkSelf === true);
    if (!selfExempt && !selfGate) {
      out.push("rule 5: a self entry on a route that is neither a self exemption nor a checkSelf gate with selfParam");
    }
  }
  return out;
};

const routeOf = (file: string, key: string): RouteChain | undefined => routes.find((r) => r.file === file && r.key === key);
const entries = Object.entries(FACILITY_ACCESSIBLE_ROUTES).flatMap(([file, keys]) =>
  Object.entries(keys).map(([key, entry]) => ({ file, key, entry })),
);

describe("G-09 — FACILITY_ACCESSIBLE_ROUTES", () => {
  it("every entry names a route that exists", () => {
    expect(entries.filter((e) => !routeOf(e.file, e.key)).map((e) => `${e.file} ${e.key}`)).toEqual([]);
  });

  it("no entry opens an administrative route (rules 1 – 5)", () => {
    const refused = entries.flatMap((e) => refusals(routeOf(e.file, e.key) as RouteChain, e.entry).map((r) => `${e.file} ${e.key}: ${r}`));
    expect(refused).toEqual([]);
  });

  it.each([
    ["api/apiKeys.route.ts", "POST /"],
    ["api/user.route.ts", "PATCH /edit"],
    ["api/certificates.route.ts", "POST /:certificateId/approve"],
    ["api/user.route.ts", "PUT /:userId/client-facility"],
  ])("bites: a marker planted on %s %s is refused", (file, key) => {
    const route = routeOf(file, key);
    expect(route).toBeDefined();
    expect(refusals(route as RouteChain, { kind: "read", reason: "planted" }).length).toBeGreaterThan(0);
  });

  it("bites: a marker planted on a tenant backup route (abac) is refused", () => {
    const backup = routes.find((r) => r.file === "api/tenantBackup.route.ts") as RouteChain;
    expect(refusals(backup, { kind: "read", reason: "planted" }).join()).toMatch(/rule 1|rule 2/);
  });

  it("bites: a self entry on a route that is not self, a public route, and a missing reason are refused", () => {
    const vendors = routes.find((r) => r.file === "api/vendor.route.ts" && r.method === "GET") as RouteChain;
    expect(refusals(vendors, { kind: "self", reason: "planted" }).join()).toMatch(/rule 5/);
    const login = routeOf("api/auth.route.ts", "POST /login") as RouteChain;
    expect(refusals(login, { kind: "self", reason: "" }).join()).toMatch(/rule 4.*rule 5/);
    // A provider-internal slug outside every bound ceiling (vendors).
    const stock = routes.find((r) => r.file === "api/vendor.route.ts" && r.method === "GET") as RouteChain;
    expect(refusals(stock, { kind: "read", reason: "planted" }).join()).toMatch(/rule 2: .*outside the bound ceilings/);
  });
});
