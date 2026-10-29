/**
 * A-136 — the retention reads had no permission gate (P6-04).
 *
 * `GET /tenants/:tenantId/policy` and `GET /tenants/:tenantId/legal-hold` ran
 * behind `auth` alone. Any principal — any role, in any tenant — could read any
 * tenant's retention periods and legal-hold state by putting its id in the
 * path. (The global tenant hooks confined the SETTINGS lookup to the caller's
 * own tenant, so a foreign id answered 200 with the platform defaults and
 * "not on hold" — a well-formed, wrong answer, not a 404.)
 *
 * Now both need `data-retention: read`, with `checkTenant`: a tenant id that is
 * not the caller's own answers 404, byte-identical to one that does not exist.
 *
 * The matrix is the REAL seed read back through the REAL permission-matrix
 * service and enforced by the REAL dynamicAccess (fixtures/seededAuthorization).
 * The allowed roles below are written out by hand: they are the claim.
 */

import type { Request, Response, NextFunction, Router } from "express";
import type { Principal, TenantRow, TwoTenantWorld } from "../fixtures/routeClient";
import { ROLE_NAMES, ROLE_IDS } from "../../constants/roleConstants";

interface ModelFinder {
  findOne(...args: unknown[]): unknown;
  findByPk(...args: unknown[]): unknown;
}

interface Seed {
  Roles: ModelFinder;
  MenuGroup: {
    findAll(...args: unknown[]): unknown;
    findOne(...args: unknown[]): unknown;
    create(...args: unknown[]): unknown;
  };
  RoleMenuPermission: {
    findAll(...args: unknown[]): unknown;
    findOne(...args: unknown[]): unknown;
    create(...args: unknown[]): unknown;
    destroy(...args: unknown[]): unknown;
  };
  seed(): Promise<void>;
  roleId(name: string): string;
}

interface SeedState {
  current: Seed | null;
}
interface FxState {
  current: TwoTenantWorld | null;
}

const mockSeed: SeedState = { current: null };
const mockFx: FxState = { current: null };
let currentUser: Principal | null = null;

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual<Record<string, unknown>>("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { user: Principal | null }).user = currentUser;
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

// Pulled in by migration.service (the real seed); not exercised here.
jest.mock("../../services/featureFlag.service", () => ({}));
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
jest.mock("../../services/dataRetention.service", () => ({
  getRetentionPolicy: jest.fn(() => Promise.resolve({ notifications: 90, sessions: 30 })),
  isOnLegalHold: jest.fn(() => Promise.resolve(false)),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

interface TwoTenantsModule {
  createTwoTenants(): TwoTenantWorld;
}
interface SeededAuthorizationModule {
  createSeededAuthorization(): Seed;
}
interface DataRetentionServiceMock {
  getRetentionPolicy: jest.Mock;
  isOnLegalHold: jest.Mock;
}

const { createTwoTenants } = jest.requireActual<TwoTenantsModule>("../fixtures/twoTenants");
const { createSeededAuthorization } = jest.requireActual<SeededAuthorizationModule>("../fixtures/seededAuthorization");
const dataRetentionService = jest.requireMock<DataRetentionServiceMock>("../../services/dataRetention.service");
const router = jest.requireActual<Router>("../../routes/api/dataRetention.route");

interface HttpResponse {
  status: number;
  body: Record<string, unknown>;
}

const http = (method: string, url: string): Promise<HttpResponse> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: Record<string, unknown>) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload: Record<string, unknown>) {
        return this.json(payload);
      },
      setHeader() {
        return this;
      },
    };
    const req = {
      method,
      url,
      originalUrl: "/api/v1/tenants" + url,
      body: {},
      query: {},
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    (router as unknown as { handle: (req: unknown, res: unknown, next: (err?: { status?: number; statusCode?: number; message?: string }) => void) => void }).handle(req, res, (err) => {
      resolve({
        status: err ? (err.status ?? err.statusCode ?? 500) : 404,
        body: { message: err ? (err.message ?? "unknown error") : "no route" },
      });
    });
  });

// Hand-written claim: the roles seeded with data-retention read or write.
const ALLOWED = [ROLE_NAMES.HEALTCARE_ADMIN, ROLE_NAMES.CALIBRATOR_ADMIN];
const TENANT_ROLES = (Object.keys(ROLE_IDS) as (keyof typeof ROLE_IDS)[])
  .filter((key) => key !== "SUPER_ADMIN")
  .map((key) => ROLE_NAMES[key]);
const READS: [string, keyof DataRetentionServiceMock][] = [
  ["policy", "getRetentionPolicy"],
  ["legal-hold", "isOnLegalHold"],
];
const NO_SUCH_TENANT = "99999999-9999-4999-8999-999999999999";

let fx: TwoTenantWorld;

beforeEach(async () => {
  jest.clearAllMocks();
  fx = createTwoTenants();
  mockFx.current = fx;
  mockSeed.current = createSeededAuthorization();
  await mockSeed.current.seed();
  currentUser = null;
});

const seededPrincipal = (tenant: TenantRow, role: string): Principal => {
  const p = fx.principal(tenant, role);
  if (mockSeed.current) {
    p.role.id = mockSeed.current.roleId(p.role.name);
  }
  return p;
};

describe.each(READS)("A-136 — GET /:tenantId/%s", (path, serviceFn) => {
  it.each(TENANT_ROLES)("in its own tenant: %s", async (role) => {
    currentUser = seededPrincipal(fx.tenantA, role);

    const res = await http("GET", `/${fx.tenantA.id}/${path}`);

    if ((ALLOWED as string[]).includes(role)) {
      expect(res.status).toBe(200);
      expect(dataRetentionService[serviceFn]).toHaveBeenCalledWith(fx.tenantA.id);
    } else {
      expect(res.status).toBe(403);
      expect(dataRetentionService[serviceFn]).not.toHaveBeenCalled();
    }
  });

  it("another tenant's id is 404, indistinguishable from an id that does not exist", async () => {
    currentUser = seededPrincipal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    const foreign = await http("GET", `/${fx.tenantB.id}/${path}`);
    const missing = await http("GET", `/${NO_SUCH_TENANT}/${path}`);

    expect(foreign.status).toBe(404);
    expect(foreign).toEqual(missing);
    expect(dataRetentionService[serviceFn]).not.toHaveBeenCalled();
  });

  it("the super admin reads any tenant", async () => {
    currentUser = fx.superAdmin;

    const res = await http("GET", `/${fx.tenantB.id}/${path}`);

    expect(res.status).toBe(200);
    expect(dataRetentionService[serviceFn]).toHaveBeenCalledWith(fx.tenantB.id);
  });
});
