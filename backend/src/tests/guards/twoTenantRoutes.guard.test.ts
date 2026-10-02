/**
 * The two-tenant guard — every route that names a record by a path parameter
 * has a two-tenant test, or a reviewed reason not to.
 *
 * WHY
 *
 * CLAUDE.md: "Every new `:id` route needs a two-tenant test asserting 404".
 * Nothing enforced it, and for a month CLAUDE.md said most `:id` routes had
 * none. A route that answers another tenant's id with 403 (an existence
 * oracle), 200 (a leak) or a write is the defect this rule exists for, and a
 * missing test is how one goes unnoticed.
 *
 * HOW
 *
 * Every route module under `src/routes` — `.js` AND `.ts` (ADR-087) — is
 * required and its Express stack walked (as routePermissionGuard.p604 does).
 * Every route whose path has a `:param` must be exactly one of:
 *
 *  1. COVERED by a test file that carries a marker line for it —
 *     "@two-tenant" followed by the route file (either extension), the verb
 *     and the Express path, e.g. `api/vendor.route.js PATCH /:vendorId`.
 *     A marked file must assert a 404. The two-tenant tests written with
 *     fixtures/twoTenantSuite and fixtures/memoryDb carry these markers.
 *  2. COVERED by a test written before the markers existed, listed in
 *     EARLIER_TESTS below by file and test title; the file must exist and
 *     still contain that title, so deleting or renaming the test fails here.
 *  3. ALLOW-LISTED in NOT_TENANT_ADDRESSED below, with a kind the route's
 *     chain agrees with:
 *       platform         — the chain carries superAdminOnly, or an rbac gate
 *                          naming only the super admin: no tenant principal
 *                          reaches it, so there is no second tenant to probe;
 *       public           — no auth in the chain (the parameter is a public
 *                          lookup key, e.g. a certificate number);
 *       capability       — an unguessable token or id IS the authorisation
 *                          (a signed link, a staged request); no chain check;
 *       not-tenant-owned — the record's model has no tenant column (checked
 *                          against the real model).
 *
 * A marker or list entry that names no live route, a route both covered and
 * allow-listed, and an allow-list kind the chain contradicts all fail. The
 * guard is tested in both directions at the bottom — including on a route
 * PLANTED in a temporary `.ts` route file with no test, which it must refuse.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Handler = (...args: unknown[]) => unknown;

interface RouteEntry {
  /** Route file relative to src/routes, without its extension. */
  readonly file: string;
  /** "METHOD /express/path" */
  readonly key: string;
  readonly chain: readonly unknown[];
}

type AllowKind = "platform" | "public" | "capability" | "not-tenant-owned";

interface AllowEntry {
  readonly kind: AllowKind;
  readonly reason: string;
  /** not-tenant-owned: the model whose rows the parameter names. */
  readonly model?: string;
}

interface EarlierTest {
  /** Test file relative to src/tests. */
  readonly test: string;
  /** A test title (or a distinctive part of it) in that file. */
  readonly title: string;
}

interface Marker {
  readonly id: string;
  readonly testFile: string;
}

const SRC = path.join(__dirname, "..", "..");
const ROUTES_DIR = path.join(SRC, "routes");
const TESTS_DIR = path.join(SRC, "tests");
const SELF = path.basename(__filename);

// ---------------------------------------------------------------------------
// Tag the rbac factory before any router loads, so a chain says which roles
// its rbac gate names. Nothing is replaced: the real middleware is returned.
// ---------------------------------------------------------------------------

const RBAC_ROLES = Symbol.for("callibrator.twoTenant.rbacRoles");
interface RbacModule {
  rbac: (roles?: string[], options?: object) => Handler;
}
const rbacModule = jest.requireActual<RbacModule>("../../middlewares/rbac.middleware");
const realRbac = rbacModule.rbac;
rbacModule.rbac = (roles: string[] = [], options: object = {}): Handler => {
  const middleware = realRbac(roles, options);
  Object.defineProperty(middleware, RBAC_ROLES, { value: roles });
  return middleware;
};

interface AuthModule {
  auth: Handler;
  optionalAuth: Handler;
  superAdminOnly: Handler;
}
const authModule = jest.requireActual<AuthModule>("../../middlewares/auth.middleware");

const PLATFORM_ROLES = new Set(["SUPERADMIN", "SUPER_ADMIN"]);

/** Does the chain admit only the platform operator? */
const isPlatformChain = (chain: readonly unknown[]): boolean =>
  chain.some((fn) => {
    if (fn === authModule.superAdminOnly) {
      return true;
    }
    const roles = (fn as Record<symbol, unknown> | null)?.[RBAC_ROLES];
    return Array.isArray(roles) && roles.length > 0 && roles.every((r) => PLATFORM_ROLES.has(String(r)));
  });

const isAuthenticated = (chain: readonly unknown[]): boolean =>
  chain.some((fn) => fn === authModule.auth || fn === authModule.optionalAuth);

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

const listFiles = (dir: string, wanted: (name: string) => boolean): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(full, wanted);
    }
    return wanted(entry.name) ? [full] : [];
  });

/** Route modules: `.js` and `.ts`, never a declaration file. */
const isRouteSource = (name: string): boolean => /\.(js|ts)$/.test(name) && !name.endsWith(".d.ts");

const stripExtension = (file: string): string => file.replace(/\.(js|ts)$/, "");

const isRouter = (value: unknown): value is { stack: unknown[] } =>
  typeof value === "function" && Array.isArray((value as { stack?: unknown }).stack);

const routersOf = (exported: unknown): { stack: unknown[] }[] => {
  if (isRouter(exported)) {
    return [exported];
  }
  const values = exported !== null && typeof exported === "object" ? Object.values(exported) : [];
  return values.filter(isRouter);
};

interface LayerLike {
  readonly route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
  readonly handle: unknown;
}

/** Every route of every router module under `dir`, with its full chain. */
const enumerateRoutes = (dir: string): RouteEntry[] => {
  const out: RouteEntry[] = [];
  for (const full of listFiles(dir, isRouteSource)) {
    const file = stripExtension(path.relative(dir, full).split(path.sep).join("/"));
    for (const router of routersOf(jest.requireActual<object>(full))) {
      const before: unknown[] = [];
      for (const layer of router.stack as LayerLike[]) {
        if (!layer.route) {
          before.push(layer.handle);
          continue;
        }
        const chain = [...before, ...layer.route.stack.map((s) => s.handle)];
        for (const method of Object.keys(layer.route.methods)) {
          out.push({ file, key: `${method.toUpperCase()} ${layer.route.path}`, chain });
        }
      }
    }
  }
  return out;
};

const MARKER = /@two-tenant\s+(\S+)\s+(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/g;

/** Marker lines in test sources; `sources` maps a test file to its text. */
const markersIn = (sources: Record<string, string>): { markers: Marker[]; problems: string[] } => {
  const markers: Marker[] = [];
  const problems: string[] = [];
  for (const [testFile, source] of Object.entries(sources)) {
    const found = [...source.matchAll(MARKER)];
    if (found.length === 0) {
      continue;
    }
    if (!source.includes("404")) {
      problems.push(`${testFile}: carries @two-tenant markers but asserts no 404`);
    }
    for (const m of found) {
      markers.push({ id: `${stripExtension(m[1] ?? "")} ${m[2] ?? ""} ${m[3] ?? ""}`, testFile });
    }
  }
  return { markers, problems };
};

const isParamRoute = (route: RouteEntry): boolean => route.key.includes(":");
const routeId = (route: RouteEntry): string => `${route.file} ${route.key}`;

// ---------------------------------------------------------------------------
// The check — pure, so the bottom of this file can test it in both directions.
// ---------------------------------------------------------------------------

interface CheckInput {
  readonly routes: readonly RouteEntry[];
  readonly markers: readonly Marker[];
  readonly earlier: Readonly<Record<string, EarlierTest>>;
  readonly allowList: Readonly<Record<string, AllowEntry>>;
  /** The text of a test file (relative to src/tests), or null if it does not exist. */
  readonly readTest: (file: string) => string | null;
  /** Whether a model has a tenant column; null if there is no such model. */
  readonly modelHasTenant: (model: string) => boolean | null;
}

interface CheckResult {
  readonly violations: string[];
  readonly covered: string[];
  readonly allowListed: string[];
}

const checkCoverage = ({ routes, markers, earlier, allowList, readTest, modelHasTenant }: CheckInput): CheckResult => {
  const violations: string[] = [];
  const covered: string[] = [];
  const allowListed: string[] = [];
  const params = routes.filter(isParamRoute);
  const live = new Set(params.map(routeId));
  const marked = new Set(markers.map((m) => m.id));

  for (const m of markers) {
    if (!live.has(m.id)) {
      violations.push(`${m.testFile}: @two-tenant marker for a route that does not exist — ${m.id}`);
    }
  }
  for (const [id, entry] of Object.entries(earlier)) {
    if (!live.has(id)) {
      violations.push(`EARLIER_TESTS ${id}: no such route — remove the entry`);
    }
    const text = readTest(entry.test);
    if (text === null) {
      violations.push(`EARLIER_TESTS ${id}: test file ${entry.test} does not exist`);
    } else if (!text.includes(entry.title)) {
      violations.push(`EARLIER_TESTS ${id}: ${entry.test} no longer has a test titled "${entry.title}"`);
    }
  }
  for (const id of Object.keys(allowList)) {
    if (!live.has(id)) {
      violations.push(`NOT_TENANT_ADDRESSED ${id}: no such route — remove the entry`);
    }
  }

  for (const route of params) {
    const id = routeId(route);
    const isCovered = marked.has(id) || id in earlier;
    const entry = allowList[id];
    if (isCovered && entry) {
      violations.push(`${id}: has a two-tenant test AND an allow-list entry — remove the entry`);
      continue;
    }
    if (isCovered) {
      covered.push(id);
      continue;
    }
    if (!entry) {
      violations.push(
        `${id}: names a record by a path parameter and has no two-tenant test (an @two-tenant marker) ` +
          "and no reviewed entry in NOT_TENANT_ADDRESSED — write the test (fixtures/twoTenantSuite)",
      );
      continue;
    }
    allowListed.push(id);
    if (entry.reason.trim().length < 20) {
      violations.push(`${id}: an allow-list entry needs a reason a reviewer can check`);
    }
    switch (entry.kind) {
      case "platform":
        if (!isPlatformChain(route.chain)) {
          violations.push(`${id}: listed as platform, but its chain admits a tenant principal`);
        }
        break;
      case "public":
        if (isAuthenticated(route.chain)) {
          violations.push(`${id}: listed as public, but its chain authenticates a principal`);
        }
        break;
      case "capability":
        break;
      case "not-tenant-owned": {
        const hasTenant = entry.model ? modelHasTenant(entry.model) : null;
        if (hasTenant === null) {
          violations.push(`${id}: listed as not-tenant-owned without a model that exists`);
        } else if (hasTenant) {
          violations.push(`${id}: listed as not-tenant-owned, but ${entry.model ?? ""} has a tenant column`);
        }
        break;
      }
    }
  }
  return { violations, covered, allowListed };
};

// ---------------------------------------------------------------------------
// Tests written before the markers, by the route they cover.
// ---------------------------------------------------------------------------

const EARLIER_TESTS: Readonly<Record<string, EarlierTest>> = {
  "api/certificates.route PUT /:certificateId": {
    test: "routes/certificates.twoTenant.a145.test.js",
    title: "another tenant's certificate answers 404, the same as one that does not exist",
  },
  "api/certificates.route DELETE /:certificateId": {
    test: "routes/certificates.twoTenant.a145.test.js",
    title: "another tenant's certificate answers 404, the same as one that does not exist",
  },
  "api/calibrationDevices.route POST /:calibrationDeviceId/restore": {
    test: "services/calibrationDevices.restore.a133.test.js",
    title: "tenant A's administrator restoring tenant B's deleted device gets exactly the not-found answer",
  },
  "api/calibrationDevices.route POST /:calibrationDeviceId/reinstate": {
    test: "routes/calibrationDevices.reinstate.q02.test.js",
    title: "another tenant's device answers 404 — exactly as a device that does not exist",
  },
  "api/sop.route PATCH /:id/publish": {
    test: "routes/partElevenAuthoring.a145.test.js",
    title: "another tenant's SOP answers 404, the same as one that does not exist",
  },
  "api/sop.route POST /:id/acknowledge": {
    test: "routes/partElevenAuthoring.a145.test.js",
    title: "another tenant's SOP answers 404, the same as one that does not exist",
  },
  "api/workflows.route POST /instances/:instanceId/action": {
    test: "routes/workflows.decision.a182a183.test.js",
    title: "another tenant's instance answers 404, the same as one that does not exist",
  },
  "api/workflows.route PUT /:id": {
    test: "routes/workflows.decision.a182a183.test.js",
    title: "another tenant's workflow answers 404 to an update, the same as a missing one",
  },
  "api/workflows.route DELETE /:id": {
    test: "routes/workflows.decision.a182a183.test.js",
    title: "another tenant's workflow answers 404 to a delete, and nothing is written",
  },
  "api/predictiveMaintenance.route POST /recommendations/:deviceId/approve": {
    test: "routes/partElevenAuthoring.a145.test.js",
    title: "another tenant's device answers 404, the same as one that does not exist",
  },
  "api/eSignature.route GET /workflows/:workflowId": {
    test: "routes/eSignature.signer.a91.test.js",
    title: "management GET /workflows/:id answers 404 for another tenant's workflow",
  },
  "api/eSignature.route DELETE /workflows/:workflowId": {
    test: "routes/eSignature.a129a130.test.js",
    title: "two tenants: tenant A deleting tenant B's workflow is 404",
  },
  "api/eSignature.route POST /workflows/:workflowId/cancel": {
    test: "routes/eSignature.a129a130.test.js",
    title: "two tenants: cancelling tenant B's workflow from tenant A is 404, byte-identical to a missing id",
  },
  "api/eSignature.route GET /my-workflows/:workflowId": {
    test: "routes/eSignature.signer.a91.test.js",
    title: "not-yours, another tenant's and non-existent are byte-identical",
  },
  "api/iot.route GET /devices/:deviceId": {
    test: "routes/iot.provisioning.a29.test.js",
    title: "%s on another tenant's device answers 404, and the device is unchanged (two-tenant)",
  },
  "api/iot.route PATCH /devices/:deviceId": {
    test: "routes/iot.provisioning.a29.test.js",
    title: "%s on another tenant's device answers 404, and the device is unchanged (two-tenant)",
  },
  "api/iot.route POST /devices/:deviceId/token": {
    test: "routes/iot.provisioning.a29.test.js",
    title: "%s on another tenant's device answers 404, and the device is unchanged (two-tenant)",
  },
  "api/iot.route DELETE /devices/:deviceId/token": {
    test: "routes/iot.provisioning.a29.test.js",
    title: "%s on another tenant's device answers 404, and the device is unchanged (two-tenant)",
  },
  "api/scim.route GET /Groups/:id": {
    test: "routes/scim.groups.tenantOwned.a38.test.js",
    title: "every :id route answers 404 for another tenant's group, byte-identical to an id that does not exist",
  },
  "api/scim.route PUT /Groups/:id": {
    test: "routes/scim.groups.tenantOwned.a38.test.js",
    title: "every :id route answers 404 for another tenant's group, byte-identical to an id that does not exist",
  },
  "api/scim.route PATCH /Groups/:id": {
    test: "routes/scim.groups.tenantOwned.a38.test.js",
    title: "every :id route answers 404 for another tenant's group, byte-identical to an id that does not exist",
  },
  "api/scim.route DELETE /Groups/:id": {
    test: "routes/scim.groups.tenantOwned.a38.test.js",
    title: "every :id route answers 404 for another tenant's group, byte-identical to an id that does not exist",
  },
  "api/user.route POST /:userId/avatar": {
    test: "routes/user.avatar.a93.test.js",
    title: "POST /users/<tenant B user>/avatar with ?tenantId=<own> is 404 and nothing is uploaded or stored",
  },
  "api/user.route POST /:userId/mfa/reset": {
    test: "routes/user.mfaReset.a141.test.js",
    title: "another tenant's user is a 404 — the same answer as no such user — and is left untouched",
  },
  "api/user.route DELETE /:userId/webauthn": {
    test: "routes/user.passkeyReset.a262.test.js",
    title: "another tenant's user is a 404 — the same answer as no such user — and is left untouched",
  },
  "api/user.route POST /:userId/password/reset": {
    test: "routes/user.passwordReset.a162.test.js",
    title: "another tenant's user is a 404 — the same answer as no such user — and is left untouched",
  },
  "api/tenant.route POST /:tenantId/logo": {
    test: "routes/tenant.logo.a79.test.js",
    title: "another tenant in the PATH is refused at the gate (404) before any file is written",
  },
  "api/tenantHierarchy.route GET /:tenantId/children": {
    test: "routes/tenantHierarchy.visibility.q05.test.js",
    title: "the child's administrator reading the parent's /%s gets 404 too",
  },
  "api/tenantHierarchy.route GET /:tenantId/parent": {
    test: "routes/tenantHierarchy.visibility.q05.test.js",
    title: "the child's administrator reading the parent's /%s gets 404 too",
  },
  "api/tenantHierarchy.route GET /:tenantId/descendants": {
    test: "routes/tenantHierarchy.visibility.q05.test.js",
    title: "the child's administrator reading the parent's /%s gets 404 too",
  },
  "api/tenantHierarchy.route GET /:tenantId/ancestors": {
    test: "routes/tenantHierarchy.visibility.q05.test.js",
    title: "the child's administrator reading the parent's /%s gets 404 too",
  },
  "api/tenantHierarchy.route POST /:tenantId/children": {
    test: "routes/tenantHierarchy.children.a187.test.js",
    title: "a tenant admin of A gets the same answer for B's id, a missing id and its own — and nothing is created",
  },
  "api/dataRetention.route GET /:tenantId/policy": {
    test: "routes/dataRetention.gate.a136.test.js",
    title: "another tenant's id is 404, indistinguishable from an id that does not exist",
  },
  "api/dataRetention.route GET /:tenantId/legal-hold": {
    test: "routes/dataRetention.gate.a136.test.js",
    title: "another tenant's id is 404, indistinguishable from an id that does not exist",
  },
  "api/featureFlags.route GET /:tenantId/:flagKey": {
    test: "routes/readGates.a155.test.js",
    title: "another tenant's id is 404, indistinguishable from an id that does not exist",
  },
  "api/tenantLifecycle.route GET /:tenantId/status": {
    test: "routes/readGates.a155.test.js",
    title: "another tenant's id is 404, indistinguishable from an id that does not exist",
  },
  "api/session.route POST /mine/:id/revoke": {
    test: "routes/session.own.q08.test.js",
    title: "another tenant's user's session answers 404 — exactly as one that does not exist — and stays live",
  },
};

// ---------------------------------------------------------------------------
// Routes whose parameter is not a record a tenant principal can address.
// ---------------------------------------------------------------------------

const ACCESS_REQUEST_QUEUE =
  "the platform's access-request queue (P10-05): super admin only (rbac on the admin router); the table has no tenant and no tenant principal reaches it";
const PLATFORM_TENANTS =
  "the platform operator's view of a tenant: only the super admin reaches it (ADR-051/ADR-052), so no tenant principal can name another tenant here";
const PLATFORM_ROLE =
  "roles and menu groups are global (no tenant column) and managed by the super admin alone";
const PLATFORM_SESSIONS = "the platform's session console, super admin only; a user's own sessions are /sessions/mine (session.own.q08)";
const PLATFORM_PERMISSIONS = "per-user permission overrides, managed by the super admin alone";

const NOT_TENANT_ADDRESSED: Readonly<Record<string, AllowEntry>> = {
  "api/admin.route PATCH /tenants/:id/status": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/admin.route PATCH /tenants/:id/flags": { kind: "platform", reason: PLATFORM_TENANTS },
  // P10-04 (ADR-098 §7.2): a tenant's SSO email-domain claim is platform-controlled
  // (a tenant must not claim a domain for itself) — super admin only, as the flags above.
  "api/admin.route GET /tenants/:id/sso-domains": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/admin.route PUT /tenants/:id/sso-domains": { kind: "platform", reason: PLATFORM_TENANTS },
  // P10-05 / P10-07 (ADR-098 §6): the platform's access-request queue. The
  // table has no tenant; no tenant principal reaches it (the admin router's
  // rbac) — accessRequest.route.p1005.test.ts proves the 403 for tenant admins.
  "api/admin.route GET /access-requests/:id": { kind: "platform", reason: ACCESS_REQUEST_QUEUE },
  "api/admin.route POST /access-requests/:id/approve": { kind: "platform", reason: ACCESS_REQUEST_QUEUE },
  "api/admin.route POST /access-requests/:id/reject": { kind: "platform", reason: ACCESS_REQUEST_QUEUE },
  "api/admin.route POST /access-requests/:id/resend-invitation": { kind: "platform", reason: ACCESS_REQUEST_QUEUE },
  "api/dataRetention.route PUT /:tenantId/policy": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/dataRetention.route POST /:tenantId/legal-hold": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/dataRetention.route DELETE /:tenantId/legal-hold": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/dataRetention.route POST /:tenantId/purge": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/dataRetention.route POST /:tenantId/mask-pii": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/dataRetention.route POST /:tenantId/anonymize": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/featureFlags.route POST /:tenantId/initialize": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/featureFlags.route POST /:tenantId/:flagKey": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/featureFlags.route DELETE /:tenantId/:flagKey": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/tenantHierarchy.route PUT /:tenantId/parent": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/tenantHierarchy.route DELETE /:tenantId/parent": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/tenantLifecycle.route POST /:tenantId/suspend": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/tenantLifecycle.route POST /:tenantId/resume": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/tenantLifecycle.route POST /:tenantId/grace-period": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/tenantLifecycle.route POST /:tenantId/offboard": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/tenantLifecycle.route POST /:tenantId/offboard/cancel": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/tenantLifecycle.route GET /:tenantId/export": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/oidc.route POST /clients/:clientId/rotate-secret": {
    kind: "platform",
    reason: "OIDC clients are registered and rotated by the super admin alone",
  },
  "api/oidc.route DELETE /clients/:clientId": {
    kind: "platform",
    reason: "OIDC clients are registered and deleted by the super admin alone",
  },
  // A-280 (ADR-094): the operator names the tenant in the path.
  "api/networkSecurity.route GET /tenants/:tenantId/ip-allowlist": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/networkSecurity.route PUT /tenants/:tenantId/ip-allowlist": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/networkSecurity.route GET /tenants/:tenantId/geofence": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/networkSecurity.route PUT /tenants/:tenantId/geofence": { kind: "platform", reason: PLATFORM_TENANTS },
  "api/oidc.route GET /tenants/:tenantId/clients": {
    kind: "platform",
    reason: "a tenant's OIDC clients, listed by the super admin alone (A-280)",
  },
  "api/oidc.route POST /tenants/:tenantId/clients": {
    kind: "platform",
    reason: "OIDC clients are registered in a named tenant by the super admin alone (A-280)",
  },
  "api/oidc.route POST /tenants/:tenantId/clients/:clientId/rotate-secret": {
    kind: "platform",
    reason: "OIDC clients are rotated in a named tenant by the super admin alone (A-280)",
  },
  "api/oidc.route DELETE /tenants/:tenantId/clients/:clientId": {
    kind: "platform",
    reason: "OIDC clients are deleted in a named tenant by the super admin alone (A-280)",
  },
  "api/roles.route GET /:id": { kind: "platform", reason: PLATFORM_ROLE },
  "api/roles.route PATCH /:id": { kind: "platform", reason: PLATFORM_ROLE },
  "api/roles.route DELETE /:id": { kind: "platform", reason: PLATFORM_ROLE },
  "api/roles.route GET /menus/:id": { kind: "platform", reason: PLATFORM_ROLE },
  "api/roles.route PATCH /menus/:id": { kind: "platform", reason: PLATFORM_ROLE },
  "api/roles.route DELETE /menus/:id": { kind: "platform", reason: PLATFORM_ROLE },
  "api/roles.route POST /:roleId/permissions": { kind: "platform", reason: PLATFORM_ROLE },
  "api/roles.route DELETE /:roleId/permissions/:menuGroupId": { kind: "platform", reason: PLATFORM_ROLE },
  "api/roles.route DELETE /assign/:userId": { kind: "platform", reason: PLATFORM_ROLE },
  "api/session.route GET /:id": { kind: "platform", reason: PLATFORM_SESSIONS },
  "api/session.route POST /:id/revoke": { kind: "platform", reason: PLATFORM_SESSIONS },
  "api/session.route POST /user/:userId/revoke-all": { kind: "platform", reason: PLATFORM_SESSIONS },
  "api/session.route DELETE /:id": { kind: "platform", reason: PLATFORM_SESSIONS },
  "api/userPermissions.route GET /:userId": { kind: "platform", reason: PLATFORM_PERMISSIONS },
  "api/userPermissions.route POST /:userId": { kind: "platform", reason: PLATFORM_PERMISSIONS },
  "api/userPermissions.route DELETE /:userId/:menuGroupId": { kind: "platform", reason: PLATFORM_PERMISSIONS },

  "api/auth.route POST /sso/callback/:tenantCode": {
    kind: "public",
    reason: "pre-authentication SSO callback; the tenant code selects which tenant's IdP to trust, it addresses no record",
  },
  "api/auth.route POST /sso/oidc/callback/:tenantCode": {
    kind: "public",
    reason: "pre-authentication OIDC callback; the tenant code selects which tenant's IdP to trust, it addresses no record",
  },
  "api/auth.route GET /sso/oidc/callback/:tenantCode": {
    kind: "public",
    reason: "pre-authentication OIDC callback; the tenant code selects which tenant's IdP to trust, it addresses no record",
  },
  "api/auth.route GET /sso/metadata/:tenantCode": {
    kind: "public",
    reason: "public SAML service-provider metadata for a tenant's SSO configuration, published to the IdP by design",
  },
  "api/certificates.route GET /verify/:certificateNumber": {
    kind: "public",
    reason: "public certificate verification (the QR code on the printed certificate), by design with no principal",
  },
  "api/certificates.route GET /verify/:certificateNumber/document": {
    kind: "public",
    reason: "public certificate document behind the verification page, token-gated (certificatePdf.service#getVerifiedDocument)",
  },
  "api/content.route GET /posts/public/:slug": {
    kind: "public",
    reason: "the public site's published posts; posts are platform content with no tenant column",
  },

  "api/attachments.route GET /:id/signed": {
    kind: "capability",
    reason: "a signed download link: the HMAC token over the id and expiry is the authorisation (attachment.service#verifySignedToken)",
  },

  "api/content.route GET /posts/:id": {
    kind: "not-tenant-owned",
    model: "Post",
    reason: "posts are platform content (the public site), with no tenant column; the content menu is the super admin's",
  },
  "api/content.route PATCH /posts/:id": {
    kind: "not-tenant-owned",
    model: "Post",
    reason: "posts are platform content (the public site), with no tenant column; the content menu is the super admin's",
  },
  "api/content.route DELETE /posts/:id": {
    kind: "not-tenant-owned",
    model: "Post",
    reason: "posts are platform content (the public site), with no tenant column; the content menu is the super admin's",
  },
  "api/content.route PATCH /categories/:id": {
    kind: "not-tenant-owned",
    model: "PostCategory",
    reason: "post categories are platform content with no tenant column; the content menu is the super admin's",
  },
  "api/content.route DELETE /categories/:id": {
    kind: "not-tenant-owned",
    model: "PostCategory",
    reason: "post categories are platform content with no tenant column; the content menu is the super admin's",
  },
};

// ---------------------------------------------------------------------------
// Readers over the real tree
// ---------------------------------------------------------------------------

const readTestFile = (file: string): string | null => {
  const full = path.join(TESTS_DIR, file);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
};

const testSources = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const full of listFiles(TESTS_DIR, (n) => /\.test\.(js|ts)$/.test(n) && n !== SELF)) {
    out[path.relative(TESTS_DIR, full).split(path.sep).join("/")] = fs.readFileSync(full, "utf8");
  }
  return out;
};

interface ModelsModule {
  readonly sequelize: { readonly models: Record<string, { rawAttributes: Record<string, unknown> } | undefined> };
}

const modelHasTenant = (name: string): boolean | null => {
  const model = jest.requireActual<ModelsModule>("../../models").sequelize.models[name];
  if (!model) {
    return null;
  }
  return "tenantId" in model.rawAttributes || "tenant_id" in model.rawAttributes;
};

let routes: RouteEntry[] = [];
let result: CheckResult;

beforeAll(() => {
  routes = enumerateRoutes(ROUTES_DIR);
  const { markers, problems } = markersIn(testSources());
  const checked = checkCoverage({
    routes,
    markers,
    earlier: EARLIER_TESTS,
    allowList: NOT_TENANT_ADDRESSED,
    readTest: readTestFile,
    modelHasTenant,
  });
  result = { ...checked, violations: [...problems, ...checked.violations] };
});

describe("the two-tenant guard — every :id route has a two-tenant test or a reviewed reason", () => {
  it("walked the whole route tree (a scan that finds nothing is not a pass)", () => {
    const files = new Set(routes.map((r) => r.file));
    expect(files.size).toBeGreaterThanOrEqual(55);
    expect(routes.filter(isParamRoute).length).toBeGreaterThanOrEqual(200);
  });

  it("every route with a path parameter is covered or allow-listed, and every marker and entry is live", () => {
    expect(result.violations).toEqual([]);
  });

  it("accounts for every :id route exactly once", () => {
    expect(result.covered.length + result.allowListed.length).toBe(routes.filter(isParamRoute).length);
  });
});

// ---------------------------------------------------------------------------
// The guard bites.
// ---------------------------------------------------------------------------

describe("the two-tenant guard refuses what it must", () => {
  const gated = (...chain: unknown[]): readonly unknown[] => chain;
  const tenantGate = (): unknown => undefined;
  const base = {
    markers: [] as Marker[],
    earlier: {},
    allowList: {},
    readTest: (): string | null => null,
    modelHasTenant: (m: string): boolean | null => (m === "Vendor" ? true : m === "Post" ? false : null),
  };

  it("a route PLANTED in a .ts route file, with no test, is refused — and a .js one next to it too", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "two-tenant-guard-"));
    try {
      fs.mkdirSync(path.join(dir, "api"));
      const planted = (param: string): string =>
        "function router() {}\n" +
        `router.stack = [{ route: { path: "/:${param}", methods: { get: true }, stack: [{ handle: function planted() {} }] } }];\n` +
        "module.exports = router;\n";
      fs.writeFileSync(path.join(dir, "api", "planted.route.ts"), planted("plantedId"));
      fs.writeFileSync(path.join(dir, "api", "legacy.route.js"), planted("legacyId"));
      fs.writeFileSync(path.join(dir, "api", "types.d.ts"), "export {};\n");

      const found = enumerateRoutes(dir);
      expect(found.map(routeId).sort()).toEqual(["api/legacy.route GET /:legacyId", "api/planted.route GET /:plantedId"]);

      const refused = checkCoverage({ ...base, routes: found });
      expect(refused.violations).toEqual([
        expect.stringContaining("api/legacy.route GET /:legacyId: names a record by a path parameter and has no two-tenant test"),
        expect.stringContaining("api/planted.route GET /:plantedId: names a record by a path parameter and has no two-tenant test"),
      ]);

      // A marker naming the .ts route by either extension covers it.
      const { markers } = markersIn({
        "routes/planted.twoTenant.test.ts": " * @two-tenant api/planted.route.js GET /:plantedId\n expect(404)",
      });
      const passed = checkCoverage({ ...base, routes: found, markers });
      expect(passed.violations).toEqual([expect.stringContaining("api/legacy.route GET /:legacyId")]);
      expect(passed.covered).toEqual(["api/planted.route GET /:plantedId"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a route planted beside the REAL tree is refused", () => {
    const { markers } = markersIn(testSources());
    const planted = { file: "api/planted.route", key: "DELETE /:plantedId", chain: gated(authModule.auth, tenantGate) };
    const check = checkCoverage({
      ...base,
      routes: [...routes, planted],
      markers,
      earlier: EARLIER_TESTS,
      allowList: NOT_TENANT_ADDRESSED,
      readTest: readTestFile,
      modelHasTenant,
    });
    expect(check.violations).toEqual([expect.stringContaining("api/planted.route DELETE /:plantedId: names a record")]);
  });

  it("a marker for a route that does not exist is refused, and so is a marked file with no 404", () => {
    const { markers, problems } = markersIn({ "routes/x.test.ts": "// @two-tenant api/gone.route.js GET /:id" });
    expect(problems).toEqual(["routes/x.test.ts: carries @two-tenant markers but asserts no 404"]);
    expect(checkCoverage({ ...base, routes: [], markers }).violations).toEqual([
      "routes/x.test.ts: @two-tenant marker for a route that does not exist — api/gone.route GET /:id",
    ]);
  });

  it("an earlier test that was renamed or deleted no longer covers its route", () => {
    const route = { file: "api/x.route", key: "GET /:id", chain: gated(authModule.auth) };
    const earlier = { "api/x.route GET /:id": { test: "routes/x.test.js", title: "another tenant's x answers 404" } };
    const renamed = checkCoverage({ ...base, routes: [route], earlier, readTest: () => "it('something else')" });
    expect(renamed.violations).toEqual([
      "EARLIER_TESTS api/x.route GET /:id: routes/x.test.js no longer has a test titled \"another tenant's x answers 404\"",
    ]);
    const deleted = checkCoverage({ ...base, routes: [route], earlier });
    expect(deleted.violations).toEqual(["EARLIER_TESTS api/x.route GET /:id: test file routes/x.test.js does not exist"]);
  });

  it("an allow-list kind the chain contradicts is refused", () => {
    const tenantRoute = { file: "api/x.route", key: "GET /:id", chain: gated(authModule.auth, tenantGate) };
    const platformRoute = { file: "api/x.route", key: "PUT /:id", chain: gated(authModule.auth, authModule.superAdminOnly) };
    const publicRoute = { file: "api/x.route", key: "DELETE /:id", chain: gated(authModule.auth) };
    const reason = "a reason long enough for a reviewer to check it";
    const check = checkCoverage({
      ...base,
      routes: [tenantRoute, platformRoute, publicRoute],
      allowList: {
        "api/x.route GET /:id": { kind: "platform", reason },
        "api/x.route PUT /:id": { kind: "platform", reason },
        "api/x.route DELETE /:id": { kind: "public", reason },
      },
    });
    expect(check.violations).toEqual([
      "api/x.route GET /:id: listed as platform, but its chain admits a tenant principal",
      "api/x.route DELETE /:id: listed as public, but its chain authenticates a principal",
    ]);
    expect(check.allowListed).toContain("api/x.route PUT /:id");
  });

  it("an rbac gate that admits a tenant role is not a platform gate; one naming only the super admin is", () => {
    const tenantAdmin = rbacModule.rbac(["SUPERADMIN", "TENANT_ADMIN"]);
    const operator = rbacModule.rbac(["SUPERADMIN"]);
    expect(isPlatformChain([authModule.auth, tenantAdmin])).toBe(false);
    expect(isPlatformChain([authModule.auth, operator])).toBe(true);
  });

  it("not-tenant-owned needs a real model without a tenant column; a stale or doubled entry is refused", () => {
    const route = (key: string): RouteEntry => ({ file: "api/x.route", key, chain: gated(authModule.auth) });
    const reason = "a reason long enough for a reviewer to check it";
    const { markers } = markersIn({ "routes/x.test.ts": "@two-tenant api/x.route.js PATCH /:id 404" });
    const check = checkCoverage({
      ...base,
      routes: [route("GET /:id"), route("PUT /:id"), route("PATCH /:id")],
      markers,
      allowList: {
        "api/x.route GET /:id": { kind: "not-tenant-owned", model: "Vendor", reason },
        "api/x.route PUT /:id": { kind: "not-tenant-owned", model: "Nope", reason },
        "api/x.route PATCH /:id": { kind: "not-tenant-owned", model: "Post", reason },
        "api/x.route POST /:id": { kind: "not-tenant-owned", model: "Post", reason: "short" },
      },
    });
    expect(check.violations).toEqual([
      "NOT_TENANT_ADDRESSED api/x.route POST /:id: no such route — remove the entry",
      "api/x.route GET /:id: listed as not-tenant-owned, but Vendor has a tenant column",
      "api/x.route PUT /:id: listed as not-tenant-owned without a model that exists",
      "api/x.route PATCH /:id: has a two-tenant test AND an allow-list entry — remove the entry",
    ]);
  });

  it("a route without a parameter is not the guard's business", () => {
    const check = checkCoverage({ ...base, routes: [{ file: "api/x.route", key: "GET /", chain: [] }] });
    expect(check).toEqual({ violations: [], covered: [], allowListed: [] });
  });
});
