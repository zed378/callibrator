/**
 * A-143 — the super admin's x-tenant-id override never applied; and the A-125
 * follow-up — a non-super-admin whose home tenant is PLATFORM is refused.
 *
 * A-143. auth.middleware accepted the override only when the tenant's status
 * `=== "ACTIVE"`, but `tenants.status` is a lower-case ENUM ("active",
 * "suspended", "deleted" — models/tenant.model.js), so it never matched: the
 * super admin stayed in its home tenant whatever it selected. ADR-052 designs
 * around the override (denyPlatformAuthoring refuses Part 11 authoring under
 * it). Fail-before (baseline 2a157f1): "a super admin selects an active
 * tenant" fails — req.tenantId stays the home tenant.
 *
 * A-125 follow-up. The Tenant model hides PLATFORM from every Tenant query,
 * but NOT from the include that loads `user.tenant`, so a non-super-admin
 * account whose tenantId is PLATFORM was let through as an ordinary tenant
 * member. Fail-before (baseline 2a157f1): "a non-super-admin in PLATFORM"
 * reaches next().
 *
 * Real: auth.middleware, constants/tenantStatus.js, constants/platformTenant.js.
 * Faked as in auth.mustChangePassword.a123.test.js; the tenant loaders are
 * doubles returning rows in the ENUM's real (lower-case) shape.
 */
import type { NextFunction, Request, Response } from "express";
import type * as AuthMiddlewareModule from "../../middlewares/auth.middleware";
import type * as PlatformTenantModule from "../../constants/platformTenant";
import type * as TenantStatusModule from "../../constants/tenantStatus";
import type * as RoleConstantsModule from "../../constants/roleConstants";

jest.mock("../../utils/jwt.util", () => ({
  verifyAccessToken: jest.fn(),
}));

jest.mock("../../services/auth.service", () => ({
  getAuthUserWithTenant: jest.fn(),
}));

jest.mock("../../services/tenant.service", () => ({
  getTenantByCodeForMiddleware: jest.fn(),
  getTenantByIdForMiddleware: jest.fn(),
}));

jest.mock("../../services/apiKey.service", () => ({
  verifyApiKey: jest.fn(),
}));

jest.mock("../../services/session.service", () => ({
  isSessionLive: jest.fn().mockResolvedValue(true),
  runWithSession: jest.fn((_sessionId: string, fn: () => unknown) => fn()),
}));

jest.mock("../../middlewares/tenantContext.middleware", () => ({
  tenantContextMiddleware: jest.fn((_req: Request, _res: Response, next: NextFunction) => {
    next();
  }),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { verifyAccessToken } = require("../../utils/jwt.util") as { verifyAccessToken: jest.Mock };
const authService = require("../../services/auth.service") as {
  getAuthUserWithTenant: jest.Mock;
};
const tenantService = require("../../services/tenant.service") as {
  getTenantByCodeForMiddleware: jest.Mock;
  getTenantByIdForMiddleware: jest.Mock;
};
const { auth, optionalAuth } = require("../../middlewares/auth.middleware") as typeof AuthMiddlewareModule;
const { createTwoTenants } = require("../fixtures/twoTenants") as {
  createTwoTenants: () => TwoTenantsFixture;
};
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant") as typeof PlatformTenantModule;
const { TENANT_STATUS, isActiveTenantStatus } =
  require("../../constants/tenantStatus") as typeof TenantStatusModule;
const { ROLE_NAMES } = require("../../constants/roleConstants") as typeof RoleConstantsModule;
/* eslint-enable @typescript-eslint/no-require-imports */

interface TenantShape {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface TwoTenantsFixture {
  tenantA: TenantShape;
  tenantB: TenantShape;
  superAdmin: { id: string; tenantId: string; [key: string]: unknown };
  principal: (tenant: TenantShape, roleName?: string) => Record<string, unknown>;
  [key: string]: unknown;
}

interface MockRes {
  statusCode: number;
  body: unknown;
  status: jest.Mock;
  json: jest.Mock;
}

const makeRes = (): MockRes => {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };
  return res;
};

interface MockReq {
  method: string;
  baseUrl: string;
  path: string;
  headers: Record<string, string | undefined>;
  tenantId?: unknown;
  tenant?: unknown;
  user?: unknown;
  [key: string]: unknown;
}

let fx: TwoTenantsFixture;
const run = async (user: Record<string, unknown>, headers: Record<string, string> = {}) => {
  authService.getAuthUserWithTenant.mockResolvedValue(user);
  verifyAccessToken.mockReturnValue({ id: user["id"], sid: "s-1" });
  const req: MockReq = {
    method: "GET",
    baseUrl: "/api/v1/calibration-devices",
    path: "/",
    headers: { authorization: "Bearer t", ...headers },
  };
  const res = makeRes();
  const next = jest.fn();
  await auth(req as unknown as Request, res as unknown as Response, next);
  return { req, res, next };
};

/** A tenant row as getTenantByIdForMiddleware returns it (ENUM value). */
const tenantRow = (tenant: TenantShape, status: string) => ({ id: tenant.id, name: tenant.name, status });

beforeEach(() => {
  jest.clearAllMocks();
  fx = createTwoTenants();
});

describe("A-143: the super admin's x-tenant-id override", () => {
  it("a super admin selects an active tenant: the request runs in it (was: stayed in the home tenant)", async () => {
    tenantService.getTenantByIdForMiddleware.mockResolvedValue(
      tenantRow(fx.tenantB, TENANT_STATUS.ACTIVE),
    );

    const { req, next } = await run(fx.superAdmin, { "x-tenant-id": fx.tenantB.id });

    expect(next).toHaveBeenCalledTimes(1);
    expect(tenantService.getTenantByIdForMiddleware).toHaveBeenCalledWith(fx.tenantB.id);
    expect(req.tenantId).toBe(fx.tenantB.id);
    expect((req.tenant as { id: string }).id).toBe(fx.tenantB.id);
  });

  it.each([[TENANT_STATUS.SUSPENDED], [TENANT_STATUS.DELETED]])(
    "a %s tenant is not selected: the request stays in the super admin's home tenant",
    async (status) => {
      tenantService.getTenantByIdForMiddleware.mockResolvedValue(tenantRow(fx.tenantB, status));

      const { req, next } = await run(fx.superAdmin, { "x-tenant-id": fx.tenantB.id });

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.tenantId).toBe(fx.superAdmin.tenantId);
    },
  );

  it("an id that resolves to no tenant (unknown, or PLATFORM — hidden by the Tenant model) is not selected", async () => {
    tenantService.getTenantByIdForMiddleware.mockResolvedValue(null);

    const { req } = await run(fx.superAdmin, { "x-tenant-id": PLATFORM_TENANT_ID });

    expect(req.tenantId).toBe(fx.superAdmin.tenantId);
  });

  it("a non-super-admin's header is ignored: not even looked up", async () => {
    const admin = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    tenantService.getTenantByIdForMiddleware.mockResolvedValue(
      tenantRow(fx.tenantB, TENANT_STATUS.ACTIVE),
    );

    const { req, next } = await run(admin, { "x-tenant-id": fx.tenantB.id });

    expect(next).toHaveBeenCalledTimes(1);
    expect(tenantService.getTenantByIdForMiddleware).not.toHaveBeenCalled();
    expect(req.tenantId).toBe(fx.tenantA.id);
  });

  it("isActiveTenantStatus: the ENUM value, in any case; nothing else", () => {
    expect(isActiveTenantStatus("active")).toBe(true);
    expect(isActiveTenantStatus("ACTIVE")).toBe(true);
    expect(isActiveTenantStatus("suspended")).toBe(false);
    expect(isActiveTenantStatus("")).toBe(false);
    expect(isActiveTenantStatus(undefined)).toBe(false);
    expect(isActiveTenantStatus(null)).toBe(false);
  });
});

interface UserShape {
  id: string;
  tenantId: string;
  [key: string]: unknown;
}

describe("A-125 follow-up: a non-super-admin whose home tenant is PLATFORM is refused", () => {
  const inPlatform = (p: Record<string, unknown>): UserShape => ({
    id: String(p["id"]),
    ...p,
    tenantId: PLATFORM_TENANT_ID,
    // The include that loads user.tenant is NOT covered by the Tenant model's
    // excludePlatformTenant hook: the row comes back, active.
    tenant: { id: PLATFORM_TENANT_ID, name: "Callibrator Platform", status: "active" },
  });

  it("a non-super-admin in PLATFORM is refused 403 and gets no tenant context (was: let through)", async () => {
    const { req, res, next } = await run(inPlatform(fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN)));

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect((res.body as { message: string }).message).toBe("Tenant account is not available");
    expect(req.tenantId).toBeUndefined();
  });

  it("optional auth treats it as anonymous", async () => {
    const user = inPlatform(fx.principal(fx.tenantA, ROLE_NAMES.USER));
    authService.getAuthUserWithTenant.mockResolvedValue(user);
    verifyAccessToken.mockReturnValue({ id: user.id, sid: "s-1" });
    const req: { method: string; baseUrl: string; path: string; headers: { authorization: string }; user?: unknown } = { method: "GET", baseUrl: "/api/v1/content", path: "/", headers: { authorization: "Bearer t" } };

    await optionalAuth(req as unknown as Request, makeRes() as unknown as Response, jest.fn());

    expect(req.user).toBeUndefined();
  });

  it("a super admin whose home is PLATFORM is let through", async () => {
    const { req, next } = await run(inPlatform(fx.superAdmin));

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.tenantId).toBe(PLATFORM_TENANT_ID);
  });

  it("an ordinary tenant member is unaffected", async () => {
    const { next } = await run(fx.principal(fx.tenantA, ROLE_NAMES.USER));

    expect(next).toHaveBeenCalledTimes(1);
  });
});
