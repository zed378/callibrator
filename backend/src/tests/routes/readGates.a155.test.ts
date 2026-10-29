/**
 * A-155 — more reads gated on a token alone (P6-04).
 *
 *  - GET /tenant-lifecycle/:tenantId/status     any tenant's lifecycle state
 *  - GET /feature-flags/:tenantId/:flagKey       any tenant's flag
 *  - GET /feature-flags?tenantId=                any tenant's flags (same defect)
 *  - GET /network-security/ip-allowlist, /geofence   the caller's own tenant's
 *    sign-in restrictions, to every role
 *
 * Each now needs its seeded menu permission (`tenant-lifecycle`,
 * `feature-flags`, `network-security`: read), with `checkTenant`: a tenant id
 * that is not the caller's — in the path or the query — answers 404,
 * byte-identical to an id that does not exist.
 *
 * The matrix is the REAL seed read back through the REAL permission-matrix
 * service and enforced by the REAL dynamicAccess (fixtures/seededAuthorization,
 * as in dataRetention.gate.a136.test.js). The allowed roles are written out by
 * hand from seedMenuGroups.util.js: they are the claim.
 */

import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, TwoTenantWorld } from "../fixtures/routeClient";
import { ROLE_NAMES, ROLE_IDS } from "../../constants/roleConstants";

interface Seed {
  seed(): Promise<unknown>;
  roleId(name: string): string;
  Roles: { findOne(...a: unknown[]): unknown; findByPk(...a: unknown[]): unknown };
  MenuGroup: {
    findAll(...a: unknown[]): unknown;
    findOne(...a: unknown[]): unknown;
    create(...a: unknown[]): unknown;
  };
  RoleMenuPermission: {
    findAll(...a: unknown[]): unknown;
    findOne(...a: unknown[]): unknown;
    create(...a: unknown[]): unknown;
    destroy(...a: unknown[]): unknown;
  };
}

interface HttpResponse {
  status: number;
  body: unknown;
}

const mockSeed: { current: Seed | null } = { current: null };
const mockFx: { current: TwoTenantWorld | null } = { current: null };
let currentUser: Principal | null = null;

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual<typeof import("../../middlewares/auth.middleware")>(
    "../../middlewares/auth.middleware",
  );
  return {
    ...actual,
    auth: (req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = currentUser;
      next();
    },
  };
});

jest.mock("../../models", () => {
  const roles = {
    findOne: (...args: unknown[]) => mockSeed.current?.Roles.findOne(...args),
    findByPk: (...args: unknown[]) => mockSeed.current?.Roles.findByPk(...args),
  };
  return {
    Tenants: { findByPk: (...args: unknown[]) => mockFx.current?.Tenants.findByPk(...args) },
    User: { findByPk: (...args: unknown[]) => mockFx.current?.Users.findByPk(...args) },
    Users: { findByPk: (...args: unknown[]) => mockFx.current?.Users.findByPk(...args) },
    Role: roles,
    Roles: roles,
    MenuGroup: {
      findAll: (...args: unknown[]) => mockSeed.current?.MenuGroup.findAll(...args),
      findOne: (...args: unknown[]) => mockSeed.current?.MenuGroup.findOne(...args),
      create: (...args: unknown[]) => mockSeed.current?.MenuGroup.create(...args),
    },
    RoleMenuPermission: {
      findAll: (...args: unknown[]) => mockSeed.current?.RoleMenuPermission.findAll(...args),
      findOne: (...args: unknown[]) => mockSeed.current?.RoleMenuPermission.findOne(...args),
      create: (...args: unknown[]) => mockSeed.current?.RoleMenuPermission.create(...args),
      destroy: (...args: unknown[]) => mockSeed.current?.RoleMenuPermission.destroy(...args),
    },
  };
});

jest.mock("../../services/featureFlag.service", () => ({
  getTenantFlags: jest.fn(async () => ({ enable_iot: true })),
  isEnabled: jest.fn(async () => true),
}));
jest.mock("../../services/tenantLifecycle.service", () => ({
  getTenantLifecycleStatus: jest.fn(async () => ({ status: "ACTIVE" })),
}));
jest.mock("../../services/networkSecurity.service", () => ({
  getTenantIpAllowlist: jest.fn(async () => ["10.0.0.0/8"]),
  getTenantGeofence: jest.fn(async () => null),
}));
jest.mock("../../utils/password.util", () => ({ hashPassword: jest.fn() }));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  delPattern: jest.fn().mockResolvedValue(undefined),
  cacheKeys: { permissions: (id: string) => `permissions:${id}` },
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { twoTenants } = require("../fixtures/routeClient") as typeof RouteClient;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createSeededAuthorization } = require("../fixtures/seededAuthorization") as {
  createSeededAuthorization: () => Seed;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const featureFlagService = require("../../services/featureFlag.service") as {
  getTenantFlags: jest.Mock;
  isEnabled: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tenantLifecycleService = require("../../services/tenantLifecycle.service") as {
  getTenantLifecycleStatus: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const networkSecurityService = require("../../services/networkSecurity.service") as {
  getTenantIpAllowlist: jest.Mock;
  getTenantGeofence: jest.Mock;
};

interface RouterLike {
  handle: (
    req: unknown,
    res: unknown,
    next: (err?: { status?: number; statusCode?: number; message?: string }) => void,
  ) => void;
}

const routers = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  lifecycle: require("../../routes/api/tenantLifecycle.route") as RouterLike,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  flags: require("../../routes/api/featureFlags.route") as RouterLike,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  network: require("../../routes/api/networkSecurity.route") as RouterLike,
};

const http = (router: RouterLike, url: string, query: Record<string, unknown> = {}): Promise<HttpResponse> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload: unknown) {
        return this.json(payload);
      },
      setHeader() {
        return this;
      },
    };
    const req = {
      method: "GET",
      url,
      originalUrl: url,
      body: {},
      query,
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    router.handle(req, res, (err) =>
      resolve({
        status: err ? err.status || err.statusCode || 500 : 404,
        body: { message: err ? err.message : "no route" },
      }),
    );
  });

// Hand-written claim (seedMenuGroups.util.js): the tenant roles seeded with each menu.
const LIFECYCLE_AND_FLAGS: readonly string[] = [ROLE_NAMES.HEALTCARE_ADMIN, ROLE_NAMES.CALIBRATOR_ADMIN];
const NETWORK_SECURITY: readonly string[] = [ROLE_NAMES.HEALTCARE_ADMIN];
const TENANT_ROLES = Object.keys(ROLE_IDS)
  .filter((key) => key !== "SUPER_ADMIN")
  .map((key) => ROLE_NAMES[key as keyof typeof ROLE_NAMES]);
const NO_SUCH_TENANT = "99999999-9999-4999-8999-999999999999";

let fx: TwoTenantWorld;

beforeEach(async () => {
  jest.clearAllMocks();
  fx = twoTenants();
  mockFx.current = fx;
  mockSeed.current = createSeededAuthorization();
  await mockSeed.current.seed();
  currentUser = null;
});

const seededPrincipal = (tenant: TwoTenantWorld["tenantA"], role: string): Principal => {
  const p = fx.principal(tenant, role);
  p.role.id = mockSeed.current?.roleId(p.role.name) as string;
  return p;
};

/**
 * Each tenant-addressed read: how to call it for a tenant id, the service
 * function behind it, and the roles allowed.
 */
interface TenantReadEntry {
  call: (tenantId: string) => Promise<HttpResponse>;
  service: () => jest.Mock;
  allowed: readonly string[];
}

const TENANT_READS: Record<string, TenantReadEntry> = {
  "GET /tenant-lifecycle/:tenantId/status": {
    call: (tenantId: string) => http(routers.lifecycle, `/${tenantId}/status`),
    service: () => tenantLifecycleService.getTenantLifecycleStatus,
    allowed: LIFECYCLE_AND_FLAGS,
  },
  "GET /feature-flags/:tenantId/:flagKey": {
    call: (tenantId: string) => http(routers.flags, `/${tenantId}/enable_iot`),
    service: () => featureFlagService.isEnabled,
    allowed: LIFECYCLE_AND_FLAGS,
  },
  "GET /feature-flags?tenantId=": {
    call: (tenantId: string) => http(routers.flags, "/", { tenantId }),
    service: () => featureFlagService.getTenantFlags,
    allowed: LIFECYCLE_AND_FLAGS,
  },
};

describe.each(Object.keys(TENANT_READS))("A-155 — %s", (name) => {
  const readEntry = TENANT_READS[name]!;
  const { call, service, allowed } = readEntry;

  it.each(TENANT_ROLES)("in its own tenant: %s", async (role) => {
    currentUser = seededPrincipal(fx.tenantA, role);

    const res = await call(fx.tenantA.id);

    if (allowed.includes(role)) {
      expect(res.status).toBe(200);
      expect(service().mock.calls[0]![0]).toBe(fx.tenantA.id);
    } else {
      expect(res.status).toBe(403);
      expect(service()).not.toHaveBeenCalled();
    }
  });

  it("another tenant's id is 404, indistinguishable from an id that does not exist", async () => {
    currentUser = seededPrincipal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    const foreign = await call(fx.tenantB.id);
    const missing = await call(NO_SUCH_TENANT);

    expect(foreign.status).toBe(404);
    expect(foreign).toEqual(missing);
    expect(service()).not.toHaveBeenCalled();
  });

  it("the super admin reads any tenant", async () => {
    currentUser = fx.superAdmin;

    const res = await call(fx.tenantB.id);

    expect(res.status).toBe(200);
    expect(service().mock.calls[0]![0]).toBe(fx.tenantB.id);
  });
});

describe.each([
  ["/ip-allowlist", () => networkSecurityService.getTenantIpAllowlist],
  ["/geofence", () => networkSecurityService.getTenantGeofence],
])("A-155 — GET /network-security%s", (path, service) => {
  it.each(TENANT_ROLES)("in its own tenant: %s", async (role) => {
    currentUser = seededPrincipal(fx.tenantA, role);

    const res = await http(routers.network, path);

    if (NETWORK_SECURITY.includes(role)) {
      expect(res.status).toBe(200);
      expect(service()).toHaveBeenCalledWith(fx.tenantA.id);
    } else {
      expect(res.status).toBe(403);
      expect(service()).not.toHaveBeenCalled();
    }
  });

  it("naming another tenant's id is 404, like one that does not exist — never an answer for the caller's own", async () => {
    currentUser = seededPrincipal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    const foreign = await http(routers.network, path, { tenantId: fx.tenantB.id });
    const missing = await http(routers.network, path, { tenantId: NO_SUCH_TENANT });

    expect(foreign.status).toBe(404);
    expect(foreign).toEqual(missing);
    expect(service()).not.toHaveBeenCalled();
  });
});
