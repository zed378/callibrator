/**
 * A-160 — a tenant "MFA required" policy. When the user's tenant sets
 * `mfa_required` (utils/mfaPolicy.util.js), a signed-in user without MFA is
 * answered 403 MFA_ENROLMENT_REQUIRED on every route but the MFA enrolment
 * ones, change-password, logout and "who am I" — the A-123 mechanism.
 *
 * Fail-before (baseline 2a157f1): there was no policy — the first case
 * answered by calling next() (the request went through), and the module
 * utils/mfaPolicy.util.js did not exist.
 *
 * What is real: auth.middleware, utils/mfaPolicy.util.js, response.util.
 * Faked as in auth.mustChangePassword.a123.test.js: the JWT verify, the
 * session check, the user loader (which in production attaches
 * `user.mfaPolicy` — asserted separately in
 * tests/services/auth.getAuthUser.mfaPolicy.a160.test.js) and the tenant
 * context.
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
const {
  auth,
  optionalAuth,
  MFA_ENROLMENT_ALLOWED,
  MFA_ENROLMENT_REQUIRED_CODE,
  PASSWORD_CHANGE_REQUIRED_CODE,
} = require("../../middlewares/auth.middleware");
const { parseMfaPolicy } = require("../../utils/mfaPolicy.util");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

const policy = (settings) =>
  parseMfaPolicy(Object.entries(settings).map(([key, value]) => ({ key, value })));

const principal = (overrides = {}) => ({
  id: USER_ID,
  isActive: true,
  status: "ACTIVE",
  tenantId: TENANT_ID,
  tenant: { id: TENANT_ID, name: "RS A", status: "active" },
  role: { name: "TECHNICIAN", roleLevel: 3 },
  mustChangePassword: false,
  mfaEnabled: false,
  mfaPolicy: policy({ mfa_required: "true" }),
  ...overrides,
});

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

const request = (method, baseUrl, path) => ({
  method,
  baseUrl,
  path,
  headers: { authorization: "Bearer t" },
});

const run = async (user, req = request("GET", "/api/v1/calibration-devices", "/")) => {
  authService.getAuthUserWithTenant.mockResolvedValue(user);
  const res = makeRes();
  const next = jest.fn();
  await auth(req, res, next);
  return { req, res, next };
};

beforeEach(() => {
  jest.clearAllMocks();
  verifyAccessToken.mockReturnValue({ id: USER_ID, sid: "s-1" });
});

describe("A-160: a user without MFA in a tenant that requires it", () => {
  it("is answered 403 MFA_ENROLMENT_REQUIRED on an ordinary route, and the request goes no further", async () => {
    const { req, res, next } = await run(principal());

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      status: 403,
      code: MFA_ENROLMENT_REQUIRED_CODE,
      message: expect.stringMatching(/requires multi-factor authentication/i),
    });
    expect(req.user).toBeUndefined();
    expect(req.tenantId).toBeUndefined();
  });

  it("the code is the one the frontend redirects on", () => {
    expect(MFA_ENROLMENT_REQUIRED_CODE).toBe("MFA_ENROLMENT_REQUIRED");
  });

  it.each([
    ["POST", "/api/v1/auth", "/mfa/setup"],
    ["POST", "/api/v1/auth", "/mfa/verify"],
    ["POST", "/api/v1/auth", "/just-update-password"],
    ["POST", "/api/v1/auth", "/logout"],
    ["POST", "/api/v1/auth", "/logout-all"],
    ["POST", "/api/v1/auth", "/verify"],
  ])("%s %s%s is still answered, and reports the pending enrolment", async (method, baseUrl, path) => {
    const { req, res, next } = await run(principal(), request(method, baseUrl, path));

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user.id).toBe(USER_ID);
    expect(req.mfaEnrolmentRequired).toBe(true);
  });

  it("the allowlist is exactly enrolment, change-password, logout (both) and who-am-I", () => {
    expect([...MFA_ENROLMENT_ALLOWED].sort()).toEqual([
      "POST /api/v1/auth/just-update-password",
      "POST /api/v1/auth/logout",
      "POST /api/v1/auth/logout-all",
      "POST /api/v1/auth/mfa/setup",
      "POST /api/v1/auth/mfa/verify",
      "POST /api/v1/auth/verify",
    ]);
  });

  it.each([
    ["POST", "/api/v1/auth", "/mfa/disable"],
    ["GET", "/api/v1/auth", "/mfa/setup"], // wrong method
    ["POST", "/api/v1/auth", "/socket-token"],
    ["POST", "/api/v1/esignature", "/mfa/setup"], // same path, another router
    ["PATCH", "/api/v1/tenants", "/settings"], // cannot switch the policy off first
  ])("%s %s%s is refused", async (method, baseUrl, path) => {
    const { res, next } = await run(principal(), request(method, baseUrl, path));

    expect(next).not.toHaveBeenCalled();
    expect(res.body.code).toBe(MFA_ENROLMENT_REQUIRED_CODE);
  });

  it("a request object without baseUrl or path is refused, not let through", async () => {
    const { res, next } = await run(principal(), { method: "POST", headers: { authorization: "Bearer t" } });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("an account also under A-123's forced change is sent to change the password FIRST, and change-password is reachable", async () => {
    const both = principal({ mustChangePassword: true });

    const refused = await run(both);
    expect(refused.res.body.code).toBe(PASSWORD_CHANGE_REQUIRED_CODE);

    const change = await run(both, request("POST", "/api/v1/auth", "/just-update-password"));
    expect(change.next).toHaveBeenCalledTimes(1);

    // Enrolment is not reachable until the password is changed (A-123 first).
    const setup = await run(both, request("POST", "/api/v1/auth", "/mfa/setup"));
    expect(setup.res.body.code).toBe(PASSWORD_CHANGE_REQUIRED_CODE);
  });
});

describe("A-160: who is NOT held back", () => {
  it.each([
    ["a user who has MFA", principal({ mfaEnabled: true })],
    ["a user whose tenant does not require it", principal({ mfaPolicy: policy({ mfa_required: "false" }) })],
    ["a user whose tenant never set it", principal({ mfaPolicy: policy({}) })],
    ["a loader that attached no policy", principal({ mfaPolicy: undefined })],
    ["the super admin", principal({ role: { name: "SUPERADMIN", roleLevel: 10 } })],
    ["the super admin (legacy spelling)", principal({ role: { name: "SUPER_ADMIN", roleLevel: 10 } })],
    [
      "a role below the policy's minimum level",
      principal({ mfaPolicy: policy({ mfa_required: "true", mfa_required_min_role_level: "5" }) }),
    ],
    [
      "a user with no role under a minimum level (lowest)",
      principal({ role: null, mfaPolicy: policy({ mfa_required: "true", mfa_required_min_role_level: "1" }) }),
    ],
  ])("%s", async (_label, user) => {
    const { req, next } = await run(user);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.mfaEnrolmentRequired).toBe(false);
  });

  it("an impersonation session is not refused (the operator cannot enrol the holder's authenticator)", async () => {
    verifyAccessToken.mockReturnValue({ id: USER_ID, sid: "s-1", impersonatorId: "super-1" });

    const { req, next } = await run(principal());

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.impersonatorId).toBe("super-1");
    expect(req.mfaEnrolmentRequired).toBe(false);
  });
});

describe("A-160: the minimum role level", () => {
  it.each([
    ["at the minimum", "3", true],
    ["above the minimum", "2", true],
    ["below the minimum", "4", false],
    ["an unparseable minimum applies to everyone (stricter, never weaker)", "admins", true],
    ["a negative minimum applies to everyone", "-1", true],
  ])("%s", async (_label, level, refused) => {
    const user = principal({
      mfaPolicy: policy({ mfa_required: "true", mfa_required_min_role_level: level }),
    });

    const { res } = await run(user);

    expect(res.statusCode === 403).toBe(refused);
  });

  it.each([["TRUE"], [" true "], ["True"]])("the switch %p is read case- and space-insensitively", async (value) => {
    const { res } = await run(principal({ mfaPolicy: policy({ mfa_required: value }) }));

    expect(res.body.code).toBe(MFA_ENROLMENT_REQUIRED_CODE);
  });

  it.each([["1"], ["yes"], [""], [null]])("the switch %p is off", async (value) => {
    const { next } = await run(principal({ mfaPolicy: policy({ mfa_required: value }) }));

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("A-160: optional auth treats an account that must enrol as anonymous", () => {
  it("does not attach the principal", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal());
    const req = request("GET", "/api/v1/content", "/posts");
    const next = jest.fn();

    await optionalAuth(req, makeRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });

  it("still attaches one that has enrolled", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal({ mfaEnabled: true }));
    const req = request("GET", "/api/v1/content", "/posts");

    await optionalAuth(req, makeRes(), jest.fn());

    expect(req.user.id).toBe(USER_ID);
  });
});
