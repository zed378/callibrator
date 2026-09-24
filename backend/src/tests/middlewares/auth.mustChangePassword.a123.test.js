/**
 * A-123 (ADR-051 Q-11) — an account an administrator created must change its
 * password before it can do anything else.
 *
 * Since ADR-047 a password signs, so the administrator who chose it could sign
 * as the user (F-3). userCreate now sets `mustChangePassword`; while it is set
 * the `auth` middleware answers every authenticated route with 403 and the
 * machine-readable code PASSWORD_CHANGE_REQUIRED (the frontend redirects on
 * it), except change-password, logout and "who am I".
 *
 * Fail-before: the old middleware had no such check — the first case answered
 * by calling next() (the request went through).
 *
 * What is real: auth.middleware and response.util (the 403 body is asserted
 * as sent). What is faked: the JWT verify, the session check, the user loader
 * and the tenant context — as in auth.tenantGone.a101.test.js.
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
  PASSWORD_CHANGE_ALLOWED,
  PASSWORD_CHANGE_REQUIRED_CODE,
} = require("../../middlewares/auth.middleware");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

const principal = (overrides = {}) => ({
  id: USER_ID,
  isActive: true,
  status: "ACTIVE",
  tenantId: TENANT_ID,
  tenant: { id: TENANT_ID, name: "RS A", status: "ACTIVE" },
  role: { name: "TECHNICIAN" },
  mustChangePassword: true,
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

/** A request as Express presents it to a route-level middleware. */
const request = (method, baseUrl, path) => ({
  method,
  baseUrl,
  path,
  headers: { authorization: "Bearer t" },
});

beforeEach(() => {
  jest.clearAllMocks();
  verifyAccessToken.mockReturnValue({ id: USER_ID, sid: "s-1" });
});

describe("A-123: a flagged account is refused everywhere but the password routes", () => {
  it("an ordinary authenticated route answers 403 PASSWORD_CHANGE_REQUIRED, and the request goes no further", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal());
    const req = request("GET", "/api/v1/calibration-devices", "/");
    const res = makeRes();
    const next = jest.fn();

    await auth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      status: 403,
      code: PASSWORD_CHANGE_REQUIRED_CODE,
      message: expect.stringMatching(/change the password/i),
    });
    // No principal and no tenant context were established.
    expect(req.user).toBeUndefined();
    expect(req.tenantId).toBeUndefined();
  });

  it("the code is the one the frontend redirects on", () => {
    expect(PASSWORD_CHANGE_REQUIRED_CODE).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it.each([
    ["POST", "/api/v1/auth", "/just-update-password"],
    ["POST", "/api/v1/auth", "/logout"],
    ["POST", "/api/v1/auth", "/logout-all"],
    ["POST", "/api/v1/auth", "/verify"],
  ])("%s %s%s is still answered", async (method, baseUrl, path) => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal());
    const req = request(method, baseUrl, path);
    const res = makeRes();
    const next = jest.fn();

    await auth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user.id).toBe(USER_ID);
  });

  it("the allowlist is exactly change-password, logout (both) and who-am-I", () => {
    expect([...PASSWORD_CHANGE_ALLOWED].sort()).toEqual([
      "POST /api/v1/auth/just-update-password",
      "POST /api/v1/auth/logout",
      "POST /api/v1/auth/logout-all",
      "POST /api/v1/auth/verify",
    ]);
  });

  it.each([
    ["GET", "/api/v1/auth", "/verify"], // wrong method
    ["POST", "/api/v1/auth", "/socket-token"],
    ["POST", "/api/v1/auth", "/pass-is-valid"],
    ["POST", "/api/v1/auth", "/mfa/setup"],
    ["POST", "/api/v1/esignature", "/logout"], // same path, another router
    ["POST", "/api/v1/users", "/create"],
  ])("%s %s%s is refused", async (method, baseUrl, path) => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal());
    const res = makeRes();
    const next = jest.fn();

    await auth(request(method, baseUrl, path), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.body.code).toBe(PASSWORD_CHANGE_REQUIRED_CODE);
  });

  it("a request object without baseUrl or path is refused, not let through", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal());
    const res = makeRes();
    const next = jest.fn();

    await auth({ method: "POST", headers: { authorization: "Bearer t" } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("an account that is not flagged is not affected", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal({ mustChangePassword: false }));
    const req = request("GET", "/api/v1/calibration-devices", "/");
    const res = makeRes();
    const next = jest.fn();

    await auth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("an impersonation session of a flagged account is not refused (the operator is not the holder)", async () => {
    verifyAccessToken.mockReturnValue({ id: USER_ID, sid: "s-1", impersonatorId: "super-1" });
    authService.getAuthUserWithTenant.mockResolvedValue(principal());
    const req = request("GET", "/api/v1/calibration-devices", "/");
    const res = makeRes();
    const next = jest.fn();

    await auth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.impersonatorId).toBe("super-1");
  });
});

describe("A-123: optional auth treats a flagged account as anonymous", () => {
  it("does not attach the principal", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal());
    const req = request("GET", "/api/v1/content", "/posts");
    const next = jest.fn();

    await optionalAuth(req, makeRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });

  it("still attaches an unflagged one", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal({ mustChangePassword: false }));
    const req = request("GET", "/api/v1/content", "/posts");

    await optionalAuth(req, makeRes(), jest.fn());

    expect(req.user.id).toBe(USER_ID);
  });
});
