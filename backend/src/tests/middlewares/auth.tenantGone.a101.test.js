/**
 * A-101 — the per-request `auth` middleware refuses a user whose tenant is
 * soft-deleted.
 *
 * getAuthUserWithTenant loads the tenant through the Tenant model's default
 * scope (isDeleted = false) and paranoid, with `required: false`, so a
 * soft-deleted or destroyed tenant comes back as `tenant: null`. The middleware
 * only refused a VISIBLE suspended/deleted tenant, so a null one was treated as
 * "no tenant" and the request went through with `req.tenantId` still set to
 * the deleted tenant — on any unexpired session, although sign-in itself
 * refuses the same user (A-83, auth.service tenantRefusal).
 *
 * Super admin: the seeded super admin lives in the DEFAULT tenant, and a
 * platform super admin may have no tenant at all. A tenant-less principal is
 * never refused; a super admin whose home tenant is gone is refused exactly as
 * sign-in already refuses them.
 *
 * What is real: auth.middleware. What is faked: the JWT verify, the session
 * check, the user loader, the tenant-header lookups and the responders — as
 * in auth.test.js.
 */

jest.mock("../../utils/jwt.util", () => ({
  verifyAccessToken: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  unauthorized: jest.fn(),
  forbidden: jest.fn(),
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
  logger: { error: jest.fn() },
}));

const { verifyAccessToken } = require("../../utils/jwt.util");
const { unauthorized, forbidden } = require("../../utils/response.util");
const authService = require("../../services/auth.service");
const tenantService = require("../../services/tenant.service");
const { auth, optionalAuth } = require("../../middlewares/auth.middleware");

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT_ID = "33333333-3333-4333-8333-333333333333";

const principal = (overrides = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  isActive: true,
  status: "ACTIVE",
  tenantId: TENANT_ID,
  tenant: { id: TENANT_ID, name: "RS A", status: "ACTIVE" },
  role: { name: "TECHNICIAN" },
  ...overrides,
});

// P6-07: an operator without MFA gets an enrolment-only session; these cases
// are about the tenant, so the operator has enrolled.
const superAdmin = (overrides = {}) =>
  principal({ role: { name: "SUPER_ADMIN" }, mfaEnabled: true, ...overrides });

let req;
let res;
let next;

beforeEach(() => {
  jest.clearAllMocks();
  verifyAccessToken.mockReturnValue({ id: "11111111-1111-4111-8111-111111111111", sid: "s-1" });
  req = { headers: { authorization: "Bearer t" } };
  res = {};
  next = jest.fn();
});

const refusedWith = (message) => {
  expect(forbidden).toHaveBeenCalledWith(res, message);
  // The request goes no further, and no tenant context is established.
  expect(next).not.toHaveBeenCalled();
  expect(req.tenantId).toBeUndefined();
};

describe("A-101: auth refuses a user whose tenant is gone", () => {
  it("a user whose tenant is soft-deleted (the include is null) is refused 403 'Tenant account is deleted'", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal({ tenant: null }));

    await auth(req, res, next);

    refusedWith("Tenant account is deleted");
  });

  it("an undefined tenant (include not returned) is refused the same way", async () => {
    const user = principal();
    delete user.tenant;
    authService.getAuthUserWithTenant.mockResolvedValue(user);

    await auth(req, res, next);

    refusedWith("Tenant account is deleted");
  });

  it.each([
    ["suspended", "Tenant account is suspended"],
    ["SUSPENDED", "Tenant account is suspended"],
    ["deleted", "Tenant account is deleted"],
    ["DELETED", "Tenant account is deleted"],
  ])("a visible %s tenant is still refused", async (status, message) => {
    authService.getAuthUserWithTenant.mockResolvedValue(
      principal({ tenant: { id: TENANT_ID, status } }),
    );

    await auth(req, res, next);

    refusedWith(message);
  });

  it("an active tenant, and a tenant with no status, pass — the sign-in rule", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal());
    await auth(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.tenantId).toBe(TENANT_ID);

    next.mockClear();
    req = { headers: { authorization: "Bearer t" } };
    authService.getAuthUserWithTenant.mockResolvedValue(
      principal({ tenant: { id: TENANT_ID, status: null } }),
    );
    await auth(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("the user checks still come first: a banned user in a gone tenant is 'Account banned'", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(
      principal({ isActive: false, tenant: null }),
    );

    await auth(req, res, next);

    expect(forbidden).toHaveBeenCalledWith(res, "Account banned");
  });
});

describe("A-101: the super admin is not locked out", () => {
  it("a super admin with no tenant is not refused", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(
      superAdmin({ tenantId: null, tenant: null }),
    );

    await auth(req, res, next);

    expect(forbidden).not.toHaveBeenCalled();
    expect(unauthorized).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it("a tenant-less super admin may still select a tenant by header", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(
      superAdmin({ tenantId: null, tenant: null }),
    );
    tenantService.getTenantByIdForMiddleware.mockResolvedValue({
      id: OTHER_TENANT_ID,
      status: "ACTIVE",
    });
    req.headers["x-tenant-id"] = OTHER_TENANT_ID;

    await auth(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.tenantId).toBe(OTHER_TENANT_ID);
  });

  it("a super admin in an active home tenant (the seeded default) passes", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(superAdmin());

    await auth(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.tenantId).toBe(TENANT_ID);
  });

  it("a super admin whose home tenant is gone is refused, as sign-in refuses them", async () => {
    // A header cannot rescue it: the home-tenant check runs first.
    authService.getAuthUserWithTenant.mockResolvedValue(superAdmin({ tenant: null }));
    req.headers["x-tenant-id"] = OTHER_TENANT_ID;

    await auth(req, res, next);

    refusedWith("Tenant account is deleted");
    expect(tenantService.getTenantByIdForMiddleware).not.toHaveBeenCalled();
  });
});

describe("A-101: optionalAuth does not attach a principal whose tenant is gone", () => {
  it("a user in a soft-deleted tenant is treated as anonymous", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal({ tenant: null }));

    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeUndefined();
    expect(req.tenantId).toBeUndefined();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("a user in a suspended tenant is treated as anonymous", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(
      principal({ tenant: { id: TENANT_ID, status: "suspended" } }),
    );

    await optionalAuth(req, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });

  it("a user in an active tenant, and a tenant-less super admin, are attached", async () => {
    const user = principal();
    authService.getAuthUserWithTenant.mockResolvedValue(user);
    await optionalAuth(req, res, next);
    expect(req.user).toBe(user);
    expect(req.tenantId).toBe(TENANT_ID);

    req = { headers: { authorization: "Bearer t" } };
    const admin = superAdmin({ tenantId: null, tenant: null });
    authService.getAuthUserWithTenant.mockResolvedValue(admin);
    await optionalAuth(req, res, next);
    expect(req.user).toBe(admin);
    expect(req.tenantId).toBeUndefined();
  });
});
