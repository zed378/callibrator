/**
 * AZ-01 / G-03 — `GET /quota` carries the billing page's gate (ADR-088).
 *
 * The matrix (TASKS/AUDIT-2026-09-AUTHZ-MATRIX.md, G-03) found `GET /quota` on
 * `auth` alone. ADR-058 then kept it there as `accepted`, because "the natural
 * gate, `billing`, is unreachable for every seeded tenant role (Q-20)". That
 * premise stopped being true the same day: ADR-056 (Q-20) granted
 * `billing: read` to HEALTHCARE ADMIN and CALIBRATOR ADMIN. The only consumer
 * of the endpoint is the billing page's PlanQuotaCard, so the endpoint now
 * carries that page's gate.
 *
 * `auth` is the only stub. `dynamicAccess` is the real middleware over the
 * REAL seed read back through the REAL getRolePermissionsMatrix
 * (fixtures/seededAuthorization). The allowed roles are written out by hand
 * from ROLE_MENU_ASSIGNMENTS — they are the claim:
 *
 *   billing: read   HEALTHCARE ADMIN, CALIBRATOR ADMIN   (SUPERADMIN: write)
 *   (none)          every other seeded role
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
    Tenants: { findByPk: jest.fn() },
    User: { findByPk: jest.fn() },
    Users: { findByPk: jest.fn() },
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
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../services/quota.service", () => ({
  getUsageSummary: jest.fn(async (tenantId: string) => ({ tenantId, plan: "pro", seats: { used: 1, limit: 5 } })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { twoTenants } = require("../fixtures/routeClient") as typeof RouteClient;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createSeededAuthorization } = require("../fixtures/seededAuthorization") as {
  createSeededAuthorization: () => Seed;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const quotaService = require("../../services/quota.service") as {
  getUsageSummary: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const router = require("../../routes/api/quota.route") as {
  handle: (
    req: unknown,
    res: unknown,
    next: (err?: { status?: number; statusCode?: number; message?: string }) => void,
  ) => void;
};

const http = (): Promise<HttpResponse> =>
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
      set() {
        return this;
      },
    };
    const req = {
      method: "GET",
      url: "/",
      originalUrl: "/api/v1/quota",
      body: {},
      query: {},
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

const R = ROLE_NAMES;
// Hand-written from ROLE_MENU_ASSIGNMENTS (Q-20 / ADR-056). The claim.
const BILLING_READ: readonly string[] = [R.HEALTCARE_ADMIN, R.CALIBRATOR_ADMIN];
const TENANT_ROLES = Object.keys(ROLE_IDS)
  .filter((key) => key !== "SUPER_ADMIN")
  .map((key) => ROLE_NAMES[key as keyof typeof ROLE_NAMES]);

let fx: TwoTenantWorld;

beforeEach(async () => {
  jest.clearAllMocks();
  fx = twoTenants();
  mockSeed.current = createSeededAuthorization();
  await mockSeed.current.seed();
  currentUser = null;
});

const seededPrincipal = (tenant: TwoTenantWorld["tenantA"], role: string): Principal => {
  const p = fx.principal(tenant, role);
  p.role.id = mockSeed.current?.roleId(p.role.name) as string;
  return p;
};

describe("AZ-01 / G-03 — GET /quota needs `billing: read`", () => {
  it.each(TENANT_ROLES)("%s", async (role) => {
    currentUser = seededPrincipal(fx.tenantA, role);

    const res = await http();

    if (BILLING_READ.includes(role)) {
      expect(res.status).toBe(200);
      expect(quotaService.getUsageSummary).toHaveBeenCalledWith(fx.tenantA.id);
    } else {
      expect(res.status).toBe(403);
      expect(quotaService.getUsageSummary).not.toHaveBeenCalled();
    }
  });

  it("the super admin keeps it", async () => {
    currentUser = fx.superAdmin;

    const res = await http();

    expect(res.status).toBe(200);
  });

  it("two tenants: each admin reads only its own tenant's usage — the tenant comes from the principal, never the request", async () => {
    currentUser = seededPrincipal(fx.tenantA, R.HEALTCARE_ADMIN);
    const a = await http();
    currentUser = seededPrincipal(fx.tenantB, R.HEALTCARE_ADMIN);
    const b = await http();

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(quotaService.getUsageSummary.mock.calls).toEqual([[fx.tenantA.id], [fx.tenantB.id]]);
    expect(fx.tenantA.id).not.toBe(fx.tenantB.id);
  });

  it("an API key needs a `billing` scope", async () => {
    const key = (scopes: string[]): Principal => ({
      ...fx.principal(fx.tenantA, R.USER),
      isApiKey: true,
      apiKeyScopes: scopes,
    });

    currentUser = key(["equipment:read"]);
    const refused = await http();
    currentUser = key(["billing:read"]);
    const allowed = await http();

    expect(refused.status).toBe(403);
    expect(allowed.status).toBe(200);
  });
});
