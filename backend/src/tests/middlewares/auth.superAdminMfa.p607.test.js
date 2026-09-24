/**
 * P6-07 (PR-3) — a platform operator (role level 10) must have MFA; and the
 * two owner questions A-160 left open: passkeys, and SSO users under a
 * tenant's MFA policy.
 *
 * Before: utils/mfaPolicy.util exempted the super admin from every MFA demand
 * ("the recovery path"), so the one account that bypasses every permission
 * and every tenant predicate signed in with a password alone. Now a level-10
 * account without MFA gets an ENROLMENT-ONLY session: every route but MFA
 * enrolment, change-password, "who am I" and sign-out answers 403
 * MFA_ENROLMENT_REQUIRED — server-side, whatever the client does — and once
 * it has enrolled, every password sign-in asks for the code (loginUser's MFA
 * step, unchanged).
 *
 * What is real: auth.middleware, utils/mfaPolicy.util.js, response.util.
 * Faked as in auth.mfaPolicy.a160.test.js: the JWT verify, the session check,
 * the user loader and the tenant context.
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
} = require("../../middlewares/auth.middleware");
const {
  parseMfaPolicy,
  isPlatformOperator,
  isFederatedMethod,
  mfaEnrolmentRequired,
} = require("../../utils/mfaPolicy.util");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

const policy = (settings) =>
  parseMfaPolicy(Object.entries(settings).map(([key, value]) => ({ key, value })));

const operator = (overrides = {}) => ({
  id: USER_ID,
  isActive: true,
  status: "ACTIVE",
  tenantId: TENANT_ID,
  tenant: { id: TENANT_ID, name: "Default Hospital Tenant", status: "active" },
  role: { name: "SUPERADMIN", roleLevel: 10 },
  mustChangePassword: false,
  mfaEnabled: false,
  // The operator's home tenant sets no policy: P6-07 needs none.
  mfaPolicy: policy({}),
  ...overrides,
});

const member = (overrides = {}) =>
  operator({ role: { name: "TECHNICIAN", roleLevel: 3 }, mfaPolicy: policy({ mfa_required: "true" }), ...overrides });

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

const run = async (user, req = request("GET", "/api/v1/tenants", "/all")) => {
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

describe("P6-07: a platform operator without MFA has an enrolment-only session", () => {
  it.each([
    ["SUPERADMIN", { name: "SUPERADMIN", roleLevel: 10 }],
    ["SUPER_ADMIN (legacy spelling)", { name: "SUPER_ADMIN", roleLevel: 10 }],
    ["a super admin role whose level was never backfilled", { name: "SUPERADMIN", roleLevel: 0 }],
    ["any role at level 10", { name: "PLATFORM OPERATOR", roleLevel: 10 }],
  ])("%s: an ordinary route is refused 403 MFA_ENROLMENT_REQUIRED and goes no further", async (_label, role) => {
    const { res, next } = await run(operator({ role }));

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: MFA_ENROLMENT_REQUIRED_CODE });
  });

  it("with no tenant at all (a platform-only operator) — the demand does not depend on a tenant policy", async () => {
    const { res, next } = await run(operator({ tenantId: null, tenant: null, mfaPolicy: undefined }));

    expect(next).not.toHaveBeenCalled();
    expect(res.body.code).toBe(MFA_ENROLMENT_REQUIRED_CODE);
  });

  it("impersonation is not reachable from it (the impersonate route is refused like any other)", async () => {
    const { res, next } = await run(operator(), request("POST", "/api/v1/auth", "/impersonate"));

    expect(next).not.toHaveBeenCalled();
    expect(res.body.code).toBe(MFA_ENROLMENT_REQUIRED_CODE);
  });

  it.each([...MFA_ENROLMENT_ALLOWED])("the enrolment path stays open: %s", async (route) => {
    const [method, full] = route.split(" ");
    const cut = full.indexOf("/", "/api/v1/".length);
    const { req, next } = await run(operator(), request(method, full.slice(0, cut), full.slice(cut)));

    expect(next).toHaveBeenCalledTimes(1);
    // "who am I" tells the frontend to go to the MFA page.
    expect(req.mfaEnrolmentRequired).toBe(true);
  });

  it("optionalAuth treats it as anonymous", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(operator());
    const req = request("GET", "/api/v1/content", "/");
    const next = jest.fn();

    await optionalAuth(req, makeRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });

  it("an ENROLLED operator passes", async () => {
    const { req, next } = await run(operator({ mfaEnabled: true }));

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.mfaEnrolmentRequired).toBe(false);
  });

  it("an operator's SSO session is no way around it (A-210 refuses the SSO sign-in itself)", async () => {
    verifyAccessToken.mockReturnValue({ id: USER_ID, sid: "s-1", amr: "saml" });

    const { next } = await run(operator());

    expect(next).not.toHaveBeenCalled();
  });

  it("a passkey is not a second factor for it either", async () => {
    const { next } = await run(operator({ webauthnEnabled: true }));

    expect(next).not.toHaveBeenCalled();
  });
});

describe("A-160 (owner question): an SSO session answers to its IdP's MFA, not the tenant's local policy", () => {
  it.each(["saml", "oidc"])("a %s session of a member without local MFA passes under mfa_required", async (amr) => {
    verifyAccessToken.mockReturnValue({ id: USER_ID, sid: "s-1", amr });

    const { req, next } = await run(member());

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.mfaEnrolmentRequired).toBe(false);
  });

  it.each([
    ["a password session", "password"],
    ["a session opened before the claim existed", undefined],
    ["a claim that is not a string", ["saml"]],
  ])("%s is still held to the policy", async (_label, amr) => {
    verifyAccessToken.mockReturnValue({ id: USER_ID, sid: "s-1", amr });

    const { res, next } = await run(member());

    expect(next).not.toHaveBeenCalled();
    expect(res.body.code).toBe(MFA_ENROLMENT_REQUIRED_CODE);
  });
});

describe("A-160 (owner question): a passkey does not satisfy the tenant policy", () => {
  it("a member with an enrolled passkey but no TOTP is still asked to enrol", async () => {
    const { res, next } = await run(
      member({ webauthnEnabled: true, webauthnCredentialId: "cred-1" }),
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.body.code).toBe(MFA_ENROLMENT_REQUIRED_CODE);
  });
});

describe("the policy helpers", () => {
  it("isPlatformOperator: by name or by level; nobody without a role", () => {
    expect(isPlatformOperator({ role: { name: "SUPER_ADMIN" } })).toBe(true);
    expect(isPlatformOperator({ role: { name: "X", roleLevel: 10 } })).toBe(true);
    expect(isPlatformOperator({ role: { name: "TENANT_ADMIN", roleLevel: 9 } })).toBe(false);
    expect(isPlatformOperator({ role: { name: "X" } })).toBe(false);
    expect(isPlatformOperator({ role: null })).toBe(false);
    expect(isPlatformOperator(null)).toBe(false);
  });

  it("isFederatedMethod: only saml and oidc", () => {
    expect(["saml", "oidc", "password", "password+totp", null, undefined].map(isFederatedMethod)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("mfaEnrolmentRequired: no user, an impersonation, or MFA already enrolled — never", () => {
    expect(mfaEnrolmentRequired(null, null)).toBe(false);
    expect(mfaEnrolmentRequired(operator(), "operator-2")).toBe(false);
    expect(mfaEnrolmentRequired(operator({ mfaEnabled: true }), null)).toBe(false);
    expect(mfaEnrolmentRequired(operator(), null)).toBe(true);
  });
});
