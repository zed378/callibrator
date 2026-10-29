/**
 * A-179 (b) — POST /network-security/evaluate-login had no permission gate.
 *
 * Not a login-time call: no sign-in path calls evaluateLoginSecurity, and the
 * route sits behind `auth`, so a principal that has not signed in cannot reach
 * it. It is the network-security screen's dry run ("would this IP / location
 * be allowed?"). Its answer — the IP verdict, the distance to the geofence
 * centre and the radius — is the policy the two A-155-gated reads return, and
 * a handful of calls triangulate the geofence centre. Every role could ask.
 *
 * It now takes the same gate as those reads: `network-security: read`, with
 * `checkTenant`. The matrix is the REAL seed read back through the REAL
 * permission-matrix service and enforced by the REAL dynamicAccess
 * (fixtures/seededAuthorization, as in readGates.a155.test.js). The allowed
 * roles are written out by hand from seedMenuGroups.util.js: they are the claim.
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

jest.mock("../../services/networkSecurity.service", () => ({
  evaluateLoginSecurity: jest.fn(async () => ({
    allowed: false,
    ip: { allowed: true },
    geofence: { allowed: false, distanceKm: 12.5, radiusKm: 5 },
    requiresStepUp: true,
  })),
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
const networkSecurityService = require("../../services/networkSecurity.service") as {
  evaluateLoginSecurity: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const router = require("../../routes/api/networkSecurity.route") as {
  handle: (
    req: unknown,
    res: unknown,
    next: (err?: { status?: number; statusCode?: number; message?: string }) => void,
  ) => void;
  stack: Array<{ route?: { path?: string; stack: unknown[] } }>;
};

const BODY = { ip: "203.0.113.9", latitude: -6.2, longitude: 106.8 };

const post = (body: Record<string, unknown> = BODY, query: Record<string, unknown> = {}): Promise<HttpResponse> =>
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
      method: "POST",
      url: "/evaluate-login",
      originalUrl: "/evaluate-login",
      body,
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

// Hand-written claim (seedMenuGroups.util.js): the tenant roles seeded with
// `network-security`.
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

describe("A-179 — POST /network-security/evaluate-login needs network-security: read", () => {
  it("the route carries a permission gate (it was auth alone)", () => {
    const layer = router.stack.find((l) => l.route && l.route.path === "/evaluate-login");
    // auth is router-level; the route's own stack is the gate + the handler.
    expect(layer?.route?.stack.length).toBe(2);
  });

  it.each(TENANT_ROLES)("in its own tenant: %s", async (role) => {
    currentUser = seededPrincipal(fx.tenantA, role);

    const res = await post();

    if (NETWORK_SECURITY.includes(role)) {
      expect(res.status).toBe(200);
      expect(networkSecurityService.evaluateLoginSecurity).toHaveBeenCalledWith(
        fx.tenantA.id,
        BODY.ip,
        BODY.latitude,
        BODY.longitude,
      );
    } else {
      expect(res.status).toBe(403);
      expect(networkSecurityService.evaluateLoginSecurity).not.toHaveBeenCalled();
    }
  });

  it("naming another tenant's id is 404, like one that does not exist — the policy is never evaluated", async () => {
    currentUser = seededPrincipal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    const foreign = await post({ ...BODY, tenantId: fx.tenantB.id });
    const missing = await post({ ...BODY, tenantId: NO_SUCH_TENANT });

    expect(foreign.status).toBe(404);
    expect(foreign).toEqual(missing);
    expect(networkSecurityService.evaluateLoginSecurity).not.toHaveBeenCalled();
  });
});
