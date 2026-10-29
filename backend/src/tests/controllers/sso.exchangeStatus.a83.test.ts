/**
 * A-83 — the SSO exchange re-checks the user and the tenant at redemption.
 *
 * The hand-off code stands for the IdP's answer at the callback and is
 * redeemable for 60 seconds. ssoExchange created the session from it without
 * looking at the user again, so an account suspended (SCIM deprovisioning) or
 * a tenant suspended inside that window still got a session and a LOGIN row.
 *
 * What is real: sso.controller (callback, hand-off, exchange), sso.service's
 * provisionUser, auth.service's tenant check, controllerWrapper and
 * response.util. What is faked — as in sso.suspendedUser.a70.test.js — the IdP,
 * the models, tenant settings, the Redis hand-off store (in memory),
 * createSession and the audit writer, so every write is observable.
 */

// A-288 (ADR-100): the network policy has its own suites (signInPolicy.*.a288); here it permits.
jest.mock("../../services/signInPolicy.service", () => ({ assertSignInPermitted: jest.fn(() => Promise.resolve(undefined)) }));
jest.mock("../../models", () => ({
  Tenants: { findOne: jest.fn() },
  // A-188: update — the exchange stamps last_login_at.
  Users: { findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn(), update: jest.fn(() => Promise.resolve([1])) },
  Role: {},
  sequelize: { transaction: jest.fn((fn: (tx: string) => unknown) => Promise.resolve(fn("mock-transaction"))) },
}));

jest.mock("../../services/tenant.service", () => ({
  getTenantSettings: jest.fn(),
}));

jest.mock("../../services/redis.service", () => {
  const mockStore = new Map<string, string>();
  return {
    mockStore,
    set: jest.fn((key: string, value: unknown) => {
      mockStore.set(key, JSON.stringify(value));
      return Promise.resolve(true);
    }),
    getDel: jest.fn((key: string) => {
      const raw = mockStore.get(key);
      if (raw === undefined) {
        return Promise.resolve(null);
      }
      mockStore.delete(key);
      return Promise.resolve(JSON.parse(raw) as unknown);
    }),
  };
});

jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({ id: "audit-1" }),
}));

jest.mock("../../services/session.service", () => ({
  createSession: jest.fn().mockResolvedValue({ id: "session-1" }),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

interface ModelsDouble {
  Tenants: { findOne: jest.Mock };
  Users: { findOne: jest.Mock; findByPk: jest.Mock; create: jest.Mock; update: jest.Mock };
  Role: Record<string, unknown>;
  sequelize: { transaction: jest.Mock };
}

interface TenantServiceDouble {
  getTenantSettings: jest.Mock;
}

interface RedisDouble {
  mockStore: Map<string, string>;
  set: jest.Mock;
  getDel: jest.Mock;
}

interface AuditServiceDouble {
  logAction: jest.Mock;
}

interface SessionServiceDouble {
  createSession: jest.Mock;
}

interface SsoServiceDouble {
  parseAndVerifyResponse: jest.Mock;
  provisionUser: jest.Mock;
}

type SsoHandler = (req: unknown, res: unknown, next: () => void) => unknown;

interface SsoControllerDouble {
  ssoCallback: SsoHandler;
  ssoExchange: SsoHandler;
}

interface SignInPolicyDouble {
  assertSignInPermitted: jest.Mock;
}

interface CustomAppError extends Error {
  status: number;
  publicCode?: string;
}

interface AppErrorUtilDouble {
  AppError: new (status: number, message: string) => CustomAppError;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { Tenants, Users } = require("../../models") as ModelsDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const tenantService = require("../../services/tenant.service") as TenantServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const redis = require("../../services/redis.service") as RedisDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const auditService = require("../../services/audit.service") as AuditServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { createSession } = require("../../services/session.service") as SessionServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const ssoService = require("../../services/sso.service") as SsoServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const ssoController = require("../../controllers/sso.controller") as SsoControllerDouble;

interface CallResponse {
  status: number;
  body?: { message?: string; success?: boolean; code?: string; [key: string]: unknown } | undefined;
  redirect?: string | undefined;
}

const TENANT = { id: "22222222-2222-4222-8222-222222222222", code: "rsx" };
const EMAIL = "nurse@hospital.example.com";
const USER_ID = "11111111-1111-4111-8111-111111111111";

const call = (
  handler: (req: unknown, res: unknown, next: () => void) => unknown,
  req: Record<string, unknown>,
): Promise<CallResponse> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: CallResponse["body"]) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      redirect(url: string) {
        resolve({ status: 302, redirect: url });
      },
      set() {
        return this;
      },
    };
    handler({ headers: { "user-agent": "jest" }, ip: "203.0.113.7", ...req }, res, () => undefined);
  });

interface UserRow {
  id: string;
  tenantId: string;
  email: string;
  isActive: boolean;
  status: string;
  tenant: { id: string; status: string } | null;
  [key: string]: unknown;
}

const userRow = (overrides: Record<string, unknown> = {}): UserRow => ({
  id: USER_ID,
  tenantId: TENANT.id,
  email: EMAIL,
  isActive: true,
  status: "ACTIVE",
  tenant: { id: TENANT.id, status: "active" },
  ...overrides,
});

/** An active user completes the SAML callback; return the one-time code. */
const codeFromCallback = async (): Promise<string | null> => {
  Users.findOne.mockResolvedValue(userRow());
  const cb = await call(ssoController.ssoCallback, {
    body: { SAMLResponse: "PHNhbWxwOlJlc3BvbnNlLz4=" },
    params: { tenantCode: TENANT.code },
  });
  expect(cb.status).toBe(302);
  const redirect = cb.redirect;
  if (!redirect) {
    throw new Error("cb.redirect is undefined");
  }
  return new URL(redirect).searchParams.get("code");
};

const exchange = (code: string | null): Promise<CallResponse> =>
  call(ssoController.ssoExchange, { body: { code } });

beforeEach(() => {
  jest.clearAllMocks();
  redis.mockStore.clear();
  Tenants.findOne.mockResolvedValue(TENANT);
  tenantService.getTenantSettings.mockResolvedValue({
    data: { settings: { sso_enabled: "true" } },
  });
  jest.spyOn(ssoService, "parseAndVerifyResponse").mockResolvedValue({ email: EMAIL });
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("A-83: ssoExchange re-checks status at redemption", () => {
  it("positive control: still active at redemption — one session, one LOGIN row", async () => {
    const code = await codeFromCallback();
    Users.findByPk.mockResolvedValue(userRow());

    const ex = await exchange(code);

    expect(ex.status).toBe(200);
    expect(Users.findByPk).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        include: [expect.objectContaining({ as: "tenant", required: false })],
      }),
    );
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["suspended by SCIM (status SUSPENDED)", userRow({ status: "SUSPENDED" }), "Account is suspended"],
    ["switched off (isActive false)", userRow({ isActive: false }), "Account is suspended"],
    ["deleted since the callback", null, "Account is suspended"],
    [
      "in a tenant suspended since the callback",
      userRow({ tenant: { id: TENANT.id, status: "suspended" } }),
      "Tenant account is suspended",
    ],
    ["in a tenant deleted since the callback", userRow({ tenant: null }), "Tenant account is deleted"],
  ])("ssoExchange refuses a user %s: no session, no LOGIN row", async (_label, atRedemption, message) => {
    const code = await codeFromCallback();
    Users.findByPk.mockResolvedValue(atRedemption);

    const ex = await exchange(code);

    expect(ex.status).toBe(403);
    expect(ex.body?.message).toBe(message);
    expect(createSession).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();

    // The code was spent by the refused attempt: it cannot be retried once
    // the account is re-enabled.
    Users.findByPk.mockResolvedValue(userRow());
    expect((await exchange(code)).status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("A-288 (ADR-100): the tenant's network policy at the SSO exchange", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
  const signInPolicy = require("../../services/signInPolicy.service") as SignInPolicyDouble;

  it("asks the policy for this account and address (method sso), before the session", async () => {
    const code = await codeFromCallback();
    Users.findByPk.mockResolvedValue(userRow());
    expect((await exchange(code)).status).toBe(200);
    expect(signInPolicy.assertSignInPermitted).toHaveBeenCalledWith(
      { id: USER_ID, tenantId: TENANT.id },
      { ip: "203.0.113.7", userAgent: "jest", method: "sso" },
    );
  });

  it("a refusal is the policy's 403 with its code, and no session or LOGIN row is written", async () => {
    const code = await codeFromCallback();
    Users.findByPk.mockResolvedValue(userRow());
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
    const { AppError } = require("../../utils/appError.util") as AppErrorUtilDouble;
    const refusal = new AppError(403, "Sign-in is not permitted from this network or location.");
    refusal.publicCode = "NETWORK_POLICY";
    signInPolicy.assertSignInPermitted.mockRejectedValueOnce(refusal);

    const ex = await exchange(code);

    expect(ex.status).toBe(403);
    expect(ex.body).toMatchObject({ success: false, code: "NETWORK_POLICY" });
    expect(createSession).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("a request with no address or user agent passes nulls", async () => {
    const code = await codeFromCallback();
    Users.findByPk.mockResolvedValue(userRow());
    await call(ssoController.ssoExchange, { body: { code }, ip: undefined, headers: {} });
    expect(signInPolicy.assertSignInPermitted).toHaveBeenLastCalledWith(
      expect.anything(),
      { ip: null, userAgent: null, method: "sso" },
    );
  });
});
