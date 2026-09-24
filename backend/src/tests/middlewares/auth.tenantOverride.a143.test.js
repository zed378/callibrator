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
  runWithSession: jest.fn((sessionId, fn) => fn()),
}));

jest.mock("../../middlewares/tenantContext.middleware", () => ({
  tenantContextMiddleware: jest.fn((req, res, next) => next()),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const { verifyAccessToken } = require("../../utils/jwt.util");
const authService = require("../../services/auth.service");
const tenantService = require("../../services/tenant.service");
const { auth, optionalAuth } = require("../../middlewares/auth.middleware");
const { createTwoTenants } = require("../fixtures/twoTenants");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");
const { TENANT_STATUS, isActiveTenantStatus } = require("../../constants/tenantStatus");
const { ROLE_NAMES } = require("../../constants/roleConstants");

const makeRes = () => {
  const res = {
    statusCode: 200,
    body: undefined,
    status: jest.fn((code) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((body) => {
      res.body = body;
      return res;
    }),
  };
  return res;
};

let fx;
const run = async (user, headers = {}) => {
  authService.getAuthUserWithTenant.mockResolvedValue(user);
  verifyAccessToken.mockReturnValue({ id: user.id, sid: "s-1" });
  const req = {
    method: "GET",
    baseUrl: "/api/v1/calibration-devices",
    path: "/",
    headers: { authorization: "Bearer t", ...headers },
  };
  const res = makeRes();
  const next = jest.fn();
  await auth(req, res, next);
  return { req, res, next };
};

/** A tenant row as getTenantByIdForMiddleware returns it (ENUM value). */
const tenantRow = (tenant, status) => ({ id: tenant.id, name: tenant.name, status });

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
    expect(req.tenant.id).toBe(fx.tenantB.id);
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

describe("A-125 follow-up: a non-super-admin whose home tenant is PLATFORM is refused", () => {
  const inPlatform = (principal) => ({
    ...principal,
    tenantId: PLATFORM_TENANT_ID,
    // The include that loads user.tenant is NOT covered by the Tenant model's
    // excludePlatformTenant hook: the row comes back, active.
    tenant: { id: PLATFORM_TENANT_ID, name: "Callibrator Platform", status: "active" },
  });

  it("a non-super-admin in PLATFORM is refused 403 and gets no tenant context (was: let through)", async () => {
    const { req, res, next } = await run(inPlatform(fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN)));

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toBe("Tenant account is not available");
    expect(req.tenantId).toBeUndefined();
  });

  it("optional auth treats it as anonymous", async () => {
    const user = inPlatform(fx.principal(fx.tenantA, ROLE_NAMES.USER));
    authService.getAuthUserWithTenant.mockResolvedValue(user);
    verifyAccessToken.mockReturnValue({ id: user.id, sid: "s-1" });
    const req = { method: "GET", baseUrl: "/api/v1/content", path: "/", headers: { authorization: "Bearer t" } };

    await optionalAuth(req, makeRes(), jest.fn());

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
