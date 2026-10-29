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
import type { NextFunction, Request, Response } from "express";
import type * as AuthMiddlewareModule from "../../middlewares/auth.middleware";

jest.mock("../../utils/jwt.util", () => ({
  verifyAccessToken: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  unauthorized: jest.fn(),
  forbidden: jest.fn(),
  error: jest.fn(),
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
  logger: { error: jest.fn() },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { verifyAccessToken } = require("../../utils/jwt.util") as { verifyAccessToken: jest.Mock };
const { unauthorized, forbidden, error: errorResponse } = require("../../utils/response.util") as {
  unauthorized: jest.Mock;
  forbidden: jest.Mock;
  error: jest.Mock;
};
const authService = require("../../services/auth.service") as {
  getAuthUserWithTenant: jest.Mock;
};
const tenantService = require("../../services/tenant.service") as {
  getTenantByCodeForMiddleware: jest.Mock;
  getTenantByIdForMiddleware: jest.Mock;
};
const { auth, optionalAuth } = require("../../middlewares/auth.middleware") as typeof AuthMiddlewareModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT_ID = "33333333-3333-4333-8333-333333333333";

interface TenantPayload {
  id: string;
  name?: string;
  status?: string | null;
}

interface PrincipalPayload {
  id: string;
  isActive: boolean;
  status: string;
  tenantId: string | null;
  tenant?: TenantPayload | null;
  role: { name: string };
  mfaEnabled?: boolean;
  [key: string]: unknown;
}

const principal = (overrides: Record<string, unknown> = {}): PrincipalPayload => ({
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
const superAdmin = (overrides: Record<string, unknown> = {}) =>
  principal({ role: { name: "SUPER_ADMIN" }, mfaEnabled: true, ...overrides });

interface MockReq {
  headers: Record<string, string | undefined>;
  user?: unknown;
  tenantId?: unknown;
  [key: string]: unknown;
}

let req: MockReq;
let res: Record<string, unknown>;
let next: jest.Mock;

const asReq = (r: unknown): Request => r as Request;
const asRes = (r: unknown): Response => r as Response;
const asNext = (n: unknown): NextFunction => n as NextFunction;

beforeEach(() => {
  jest.clearAllMocks();
  verifyAccessToken.mockReturnValue({ id: "11111111-1111-4111-8111-111111111111", sid: "s-1" });
  req = { headers: { authorization: "Bearer t" } };
  res = {};
  next = jest.fn();
});

// P21-03 (G-O5): a tenant refusal carries its SCOPE_LOSS_CODES code at the top level.
const refusedWith = (message: string) => {
  const code = message.endsWith("suspended") ? "TENANT_SUSPENDED" : "TENANT_DELETED";
  expect(errorResponse).toHaveBeenCalledWith(asRes(res), message, 403, null, { code });
  // The request goes no further, and no tenant context is established.
  expect(next).not.toHaveBeenCalled();
  expect(req.tenantId).toBeUndefined();
};

describe("A-101: auth refuses a user whose tenant is gone", () => {
  it("a user whose tenant is soft-deleted (the include is null) is refused 403 'Tenant account is deleted'", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal({ tenant: null }));

    await auth(asReq(req), asRes(res), asNext(next));

    refusedWith("Tenant account is deleted");
  });

  it("an undefined tenant (include not returned) is refused the same way", async () => {
    const user = principal();
    delete (user as Record<string, unknown>)["tenant"];
    authService.getAuthUserWithTenant.mockResolvedValue(user);

    await auth(asReq(req), asRes(res), asNext(next));

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

    await auth(asReq(req), asRes(res), asNext(next));

    refusedWith(message);
  });

  it("an active tenant, and a tenant with no status, pass — the sign-in rule", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal());
    await auth(asReq(req), asRes(res), asNext(next));
    expect(next).toHaveBeenCalledWith();
    expect(req.tenantId).toBe(TENANT_ID);

    next.mockClear();
    req = { headers: { authorization: "Bearer t" } };
    authService.getAuthUserWithTenant.mockResolvedValue(
      principal({ tenant: { id: TENANT_ID, status: null } }),
    );
    await auth(asReq(req), asRes(res), asNext(next));
    expect(next).toHaveBeenCalledWith();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("the user checks still come first: a banned user in a gone tenant is 'Account banned'", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(
      principal({ isActive: false, tenant: null }),
    );

    await auth(asReq(req), asRes(res), asNext(next));

    expect(errorResponse).toHaveBeenCalledWith(asRes(res), "Account banned", 403, null, { code: "ACCOUNT_INACTIVE" });
  });
});

describe("A-101: the super admin is not locked out", () => {
  it("a super admin with no tenant is not refused", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(
      superAdmin({ tenantId: null, tenant: null }),
    );

    await auth(asReq(req), asRes(res), asNext(next));

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

    await auth(asReq(req), asRes(res), asNext(next));

    expect(next).toHaveBeenCalledWith();
    expect(req.tenantId).toBe(OTHER_TENANT_ID);
  });

  it("a super admin in an active home tenant (the seeded default) passes", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(superAdmin());

    await auth(asReq(req), asRes(res), asNext(next));

    expect(next).toHaveBeenCalledWith();
    expect(req.tenantId).toBe(TENANT_ID);
  });

  it("a super admin whose home tenant is gone is refused, as sign-in refuses them", async () => {
    // A header cannot rescue it: the home-tenant check runs first.
    authService.getAuthUserWithTenant.mockResolvedValue(superAdmin({ tenant: null }));
    req.headers["x-tenant-id"] = OTHER_TENANT_ID;

    await auth(asReq(req), asRes(res), asNext(next));

    refusedWith("Tenant account is deleted");
    expect(tenantService.getTenantByIdForMiddleware).not.toHaveBeenCalled();
  });
});

describe("A-101: optionalAuth does not attach a principal whose tenant is gone", () => {
  it("a user in a soft-deleted tenant is treated as anonymous", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal({ tenant: null }));

    await optionalAuth(asReq(req), asRes(res), asNext(next));

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeUndefined();
    expect(req.tenantId).toBeUndefined();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("a user in a suspended tenant is treated as anonymous", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(
      principal({ tenant: { id: TENANT_ID, status: "suspended" } }),
    );

    await optionalAuth(asReq(req), asRes(res), asNext(next));

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });

  it("a user in an active tenant, and a tenant-less super admin, are attached", async () => {
    const user = principal();
    authService.getAuthUserWithTenant.mockResolvedValue(user);
    await optionalAuth(asReq(req), asRes(res), asNext(next));
    expect(req.user).toBe(user);
    expect(req.tenantId).toBe(TENANT_ID);

    req = { headers: { authorization: "Bearer t" } };
    const admin = superAdmin({ tenantId: null, tenant: null });
    authService.getAuthUserWithTenant.mockResolvedValue(admin);
    await optionalAuth(asReq(req), asRes(res), asNext(next));
    expect(req.user).toBe(admin);
    expect(req.tenantId).toBeUndefined();
  });
});
