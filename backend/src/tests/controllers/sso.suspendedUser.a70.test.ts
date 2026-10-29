/**
 * A-70 — SSO must refuse a suspended user: no hand-off code, no session, no
 * LOGIN audit row.
 *
 * sso.service.provisionUser checked `status` but not `isActive`, so a user
 * switched off by `isActive` (what auth.middleware reports as "Account
 * banned") completed SSO: a hand-off code, then at the exchange a session and
 * a LOGIN audit row for a login that should have been refused. The middleware
 * refused the token on every later request, so no data was reached — but the
 * audit trail recorded an access that never should have happened.
 *
 * What is real: sso.controller (callback, hand-off, exchange), sso.service's
 * provisionUser, controllerWrapper and response.util. What is faked: the IdP
 * (parseAndVerifyResponse / verifyOidcCallback are spied — assertion signature
 * checks are not under test), the models, tenant settings, the Redis hand-off
 * store (in memory), createSession and the audit writer, so every write the
 * flow makes is observable.
 *
 * The positive control drives an ACTIVE user through the same callback and
 * exchange and sees one session and one LOGIN row, so "nothing was written"
 * below is not an artefact of a harness that cannot write.
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
  verifyOidcCallback: jest.Mock;
}

type SsoHandler = (req: unknown, res: unknown, next: () => void) => unknown;

interface OidcFlow {
  state: string;
  nonce: string;
  binding: string;
}

interface SsoControllerDouble {
  ssoCallback: SsoHandler;
  oidcCallback: SsoHandler;
  ssoExchange: SsoHandler;
  beginOidcFlow: (tenantCode: string, redirectUri: string) => Promise<OidcFlow>;
  OIDC_BINDING_COOKIE: string;
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
  body?: unknown;
  redirect?: string;
}

const TENANT = { id: "22222222-2222-4222-8222-222222222222", code: "rsx" };
const EMAIL = "nurse@hospital.example.com";

const call = (
  handler: (req: unknown, res: unknown, next: () => void) => unknown,
  req: Record<string, unknown>,
): Promise<CallResponse> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      redirect(url: string) {
        this.headersSent = true;
        resolve({ status: 302, redirect: url });
      },
      set() {
        return this;
      },
      clearCookie() {
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
  tenant?: { id: string; status: string } | null;
  [key: string]: unknown;
}

const userRow = (overrides: Record<string, unknown> = {}): UserRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: TENANT.id,
  email: EMAIL,
  isActive: true,
  status: "ACTIVE",
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  redis.mockStore.clear();
  Tenants.findOne.mockResolvedValue(TENANT);
  tenantService.getTenantSettings.mockResolvedValue({
    data: { settings: { sso_enabled: "true" } },
  });
  jest.spyOn(ssoService, "parseAndVerifyResponse").mockResolvedValue({ email: EMAIL });
  jest.spyOn(ssoService, "verifyOidcCallback").mockResolvedValue({ email: EMAIL });
});

afterAll(() => {
  jest.restoreAllMocks();
});

const samlCallback = (): Promise<CallResponse> =>
  call(ssoController.ssoCallback, {
    body: { SAMLResponse: "PHNhbWxwOlJlc3BvbnNlLz4=" },
    params: { tenantCode: TENANT.code },
  });

// A-68: an OIDC callback needs a sign-in this server started — its state and
// the browser's binding cookie. The flow's own store write is then forgotten,
// so "no hand-off code was issued" below still reads redis.set alone.
const oidcCallback = async (): Promise<CallResponse> => {
  const flow = await ssoController.beginOidcFlow(TENANT.code, "https://sp.example.com/cb");
  redis.set.mockClear();
  return call(ssoController.oidcCallback, {
    body: { code: "idp-code", state: flow.state },
    params: { tenantCode: TENANT.code },
    headers: {
      "user-agent": "jest",
      cookie: `${ssoController.OIDC_BINDING_COOKIE}=${flow.binding}`,
    },
  });
};

describe("A-70: SSO refuses a suspended user", () => {
  it("positive control: an active user's SSO sign-in creates one session and one LOGIN row", async () => {
    Users.findOne.mockResolvedValue(userRow({}));
    // A-83: the exchange re-reads the user and its tenant.
    Users.findByPk.mockResolvedValue(
      userRow({ tenant: { id: TENANT.id, status: "active" } }),
    );

    const cb = await samlCallback();
    expect(cb.status).toBe(302);
    const redirect = cb.redirect;
    if (!redirect) {
      throw new Error("cb.redirect is undefined");
    }
    const code = new URL(redirect).searchParams.get("code");

    const ex = await call(ssoController.ssoExchange, { body: { code } });
    expect(ex.status).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    const firstAuditCall = (auditService.logAction.mock.calls as [Record<string, unknown>][])[0];
    if (!firstAuditCall) {
      throw new Error("auditService.logAction was not called");
    }
    expect(firstAuditCall[0]).toMatchObject({
      action: "LOGIN",
      resourceType: "Session",
    });
  });

  it.each([
    ["SAML", samlCallback],
    ["OIDC", oidcCallback],
  ])("a suspended user's SSO sign-in creates no session (%s, isActive false)", async (_p, callback) => {
    Users.findOne.mockResolvedValue(userRow({ isActive: false }));

    const res = await callback();

    // A-188: refused to the login page, with a code — never to /sso-callback.
    expect(res.status).toBe(302);
    const redirect = res.redirect;
    if (!redirect) {
      throw new Error("res.redirect is undefined");
    }
    const target = new URL(redirect);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("error")).toBe("sso_account_refused");
    expect(target.searchParams.has("code")).toBe(false);
    // No hand-off code was issued, so there is nothing to exchange ...
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.mockStore.size).toBe(0);
    // ... and no session or LOGIN row exists.
    expect(createSession).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("a user suspended by status (SCIM deprovisioning) is refused the same way", async () => {
    Users.findOne.mockResolvedValue(userRow({ status: "SUSPENDED" }));

    const res = await samlCallback();

    const redirect = res.redirect;
    if (!redirect) {
      throw new Error("res.redirect is undefined");
    }
    expect(new URL(redirect).searchParams.get("error")).toBe("sso_account_refused");
    expect(redis.set).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });
});
