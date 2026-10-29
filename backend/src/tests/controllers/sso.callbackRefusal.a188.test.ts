/* eslint-disable no-restricted-properties -- tests exercise FRONTEND_URL directly */
/**
 * A-188 / A-210 / A-160 — what an SSO sign-in records and refuses, through the
 * real controller and the real provisionUser.
 *
 *  - A-188: a refused browser callback redirects to `/login?error=<code>`
 *    (it used to render the JSON error envelope as a page); an SSO sign-in
 *    stamps `users.last_login_at` (it never did, so an SSO-only account read
 *    as dormant).
 *  - A-210: a platform operator (role level 10) never signs in through a
 *    tenant's identity provider — the tenant's own administrators configure
 *    that IdP.
 *  - A-160: the SSO session and its access token carry how it signed in
 *    ("saml" / "oidc"), which the tenant MFA policy reads.
 *
 * What is real: sso.controller, sso.service#provisionUser, jwt.util,
 * controllerWrapper and response.util. What is faked: the IdP answer, the
 * models, tenant settings, the Redis hand-off store, createSession and the
 * audit writer.
 */

// A-288 (ADR-100): the network policy has its own suites (signInPolicy.*.a288); here it permits.
jest.mock("../../services/signInPolicy.service", () => ({
  assertSignInPermitted: jest.fn(() => Promise.resolve(undefined)),
}));
jest.mock("../../models", () => ({
  Tenants: { findOne: jest.fn() },
  Users: { findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn(), update: jest.fn() },
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
  Users: {
    findOne: jest.Mock;
    findByPk: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
}

interface TenantServiceDouble {
  getTenantSettings: jest.Mock;
}

interface RedisDouble {
  mockStore: Map<string, string>;
  set: jest.Mock;
  getDel: jest.Mock;
}

interface SessionServiceDouble {
  createSession: jest.Mock;
}

interface ActivityLogDouble {
  logger: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
}

interface SsoServiceDouble {
  parseAndVerifyResponse: (resp: unknown, settings: unknown) => Promise<unknown>;
  verifyOidcCallback: (code: unknown, settings: unknown, redirectUri: unknown, flow: unknown) => Promise<unknown>;
  [key: string]: unknown;
}

type SsoHandler = (req: unknown, res: unknown, next: () => void) => unknown;

interface SsoControllerDouble {
  ssoCallback: SsoHandler;
  oidcCallback: SsoHandler;
  ssoExchange: SsoHandler;
  beginOidcFlow: (tenantCode: string, redirectUri: string) => Promise<{ state: string; binding: string }>;
  OIDC_BINDING_COOKIE: string;
}

interface JwtUtilDouble {
  verifyAccessToken: (token?: string) => Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { Tenants, Users } = require("../../models") as ModelsDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const tenantService = require("../../services/tenant.service") as TenantServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const redis = require("../../services/redis.service") as RedisDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { createSession } = require("../../services/session.service") as SessionServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { logger } = require("../../middlewares/activityLog.middleware") as ActivityLogDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const ssoService = require("../../services/sso.service") as SsoServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const ssoController = require("../../controllers/sso.controller") as SsoControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { verifyAccessToken } = require("../../utils/jwt.util") as JwtUtilDouble;

interface CallResponse {
  status: number;
  body?: { token?: string; [key: string]: unknown } | undefined;
  redirect?: string | undefined;
}

const TENANT = { id: "22222222-2222-4222-8222-222222222222", code: "rsx" };
const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "nurse@hospital.example.com";

const call = (
  handler: SsoHandler,
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
      clearCookie() {
        return this;
      },
    };
    handler({ headers: { "user-agent": "jest" }, ip: "203.0.113.7", params: {}, ...req }, res, () => undefined);
  });

const samlCallback = (): Promise<CallResponse> =>
  call(ssoController.ssoCallback, {
    body: { SAMLResponse: "PHNhbWxwOlJlc3BvbnNlLz4=" },
    params: { tenantCode: TENANT.code },
  });

const oidcCallback = async (): Promise<CallResponse> => {
  const flow = await ssoController.beginOidcFlow(TENANT.code, "https://sp.example.com/cb");
  return call(ssoController.oidcCallback, {
    body: { code: "idp-code", state: flow.state },
    params: { tenantCode: TENANT.code },
    headers: { "user-agent": "jest", cookie: `${ssoController.OIDC_BINDING_COOKIE}=${flow.binding}` },
  });
};

const loginErrorOf = (response: CallResponse): string | null => {
  expect(response.status).toBe(302);
  const target = new URL(response.redirect ?? "");
  expect(target.pathname).toBe("/login");
  expect(target.searchParams.has("code")).toBe(false);
  return target.searchParams.get("error");
};

const userRow = (overrides: Record<string, unknown> = {}) => ({
  id: USER_ID,
  tenantId: TENANT.id,
  email: EMAIL,
  isActive: true,
  status: "ACTIVE",
  role: { id: "r-1", name: "TECHNICIAN", roleLevel: 3 },
  ...overrides,
});

const ORIGINAL_FRONTEND_URL = process.env["FRONTEND_URL"];

beforeEach(() => {
  jest.clearAllMocks();
  redis.mockStore.clear();
  process.env["FRONTEND_URL"] = "https://kalibrasi.example.com";
  Tenants.findOne.mockResolvedValue(TENANT);
  tenantService.getTenantSettings.mockResolvedValue({ data: { settings: { sso_enabled: "true" } } });
  Users.update.mockResolvedValue([1]);
  jest.spyOn(ssoService, "parseAndVerifyResponse").mockResolvedValue({ email: EMAIL });
  jest.spyOn(ssoService, "verifyOidcCallback").mockResolvedValue({ email: EMAIL });
});

afterAll(() => {
  if (ORIGINAL_FRONTEND_URL === undefined) {
    delete process.env["FRONTEND_URL"];
  } else {
    process.env["FRONTEND_URL"] = ORIGINAL_FRONTEND_URL;
  }
  jest.restoreAllMocks();
});

describe("A-188: a refused callback goes back to the login page, with a fixed code", () => {
  it("an IdP answer that does not verify is sso_failed, and the reason is only logged", async () => {
    const refusal = Object.assign(new Error("SAML signature verification failed"), { status: 401 });
    jest.spyOn(ssoService, "parseAndVerifyResponse").mockRejectedValueOnce(refusal);

    const res = await samlCallback();

    expect(loginErrorOf(res)).toBe("sso_failed");
    expect(res.redirect).not.toContain("signature");
    expect(logger.warn).toHaveBeenCalledWith("SSO callback refused", {
      protocol: "saml",
      code: "sso_failed",
      status: 401,
      reason: "SAML signature verification failed",
    });
  });

  it("a status carried as statusCode is read too", async () => {
    jest.spyOn(ssoService, "verifyOidcCallback").mockRejectedValueOnce(
      Object.assign(new Error("Forbidden by the IdP"), { statusCode: 403 }),
    );

    expect(loginErrorOf(await oidcCallback())).toBe("sso_account_refused");
  });

  it("an unexpected failure (no status) is sso_error — still a redirect, never a stack trace", async () => {
    jest.spyOn(ssoService, "parseAndVerifyResponse").mockRejectedValueOnce(new TypeError("x is undefined"));

    const res = await samlCallback();

    expect(loginErrorOf(res)).toBe("sso_error");
    expect(logger.warn).toHaveBeenCalledWith(
      "SSO callback refused",
      expect.objectContaining({ code: "sso_error", status: 500 }),
    );
  });

  it("with FRONTEND_URL unset the login page is the development default", async () => {
    delete process.env["FRONTEND_URL"];

    const res = await call(ssoController.ssoCallback, { body: {} });

    expect(res.redirect).toBe("http://localhost:3000/login?error=sso_unavailable");
  });

  it("with FRONTEND_URL unset a successful callback hands off to the development default", async () => {
    delete process.env["FRONTEND_URL"];
    Users.findOne.mockResolvedValue(userRow());

    const res = await samlCallback();

    expect(res.redirect).toMatch(/^http:\/\/localhost:3000\/sso-callback\?code=/);
  });
});

describe("A-210: a platform operator never signs in through a tenant's IdP", () => {
  it.each([
    ["SAML", samlCallback],
    ["OIDC", oidcCallback],
  ])("%s: the tenant IdP asserting the super admin's address gets no code, no session", async (_p, callback) => {
    Users.findOne.mockResolvedValue(
      userRow({ role: { id: "r-sa", name: "SUPERADMIN", roleLevel: 10 } }),
    );

    const res = await callback();

    expect(loginErrorOf(res)).toBe("sso_account_refused");
    expect(redis.mockStore.size).toBe(0);
    expect(createSession).not.toHaveBeenCalled();
    expect(Users.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        include: [expect.objectContaining({ attributes: ["id", "name", "roleLevel"], required: false })],
      }),
    );
  });

  it("a role at level 10 under any name is an operator", async () => {
    Users.findOne.mockResolvedValue(userRow({ role: { id: "r-x", name: "PLATFORM", roleLevel: 10 } }));

    expect(loginErrorOf(await samlCallback())).toBe("sso_account_refused");
  });
});

describe("A-188 / A-160: what an SSO sign-in writes", () => {
  it.each([
    ["saml", samlCallback],
    ["oidc", oidcCallback],
  ])("%s: the session records the method, the token carries it as amr, last_login_at is stamped in the transaction", async (method, callback) => {
    Users.findOne.mockResolvedValue(userRow());
    Users.findByPk.mockResolvedValue(userRow({ tenant: { id: TENANT.id, status: "active" } }));

    const cb = await callback();
    const code = new URL(cb.redirect ?? "").searchParams.get("code");
    const ex = await call(ssoController.ssoExchange, { body: { code } });

    expect(ex.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ authMethod: method }));
    expect(verifyAccessToken(ex.body?.token)).toMatchObject({ id: USER_ID, sid: "session-1", amr: method });
    expect(Users.update).toHaveBeenCalledTimes(1);
    const updateCall = Users.update.mock.calls[0] as [{ lastLoginAt: unknown }, unknown];
    const [values, options] = updateCall;
    expect(values.lastLoginAt).toBeInstanceOf(Date);
    expect(options).toEqual({
      where: { id: USER_ID, tenantId: TENANT.id },
      transaction: "mock-transaction",
      skipTenantScope: true,
    });
  });
});
