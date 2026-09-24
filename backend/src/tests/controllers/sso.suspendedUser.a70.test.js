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

jest.mock("../../models", () => ({
  Tenants: { findOne: jest.fn() },
  // A-188: update — the exchange stamps last_login_at.
  Users: { findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn(), update: jest.fn(async () => [1]) },
  Role: {},
  sequelize: { transaction: jest.fn(async (fn) => fn("mock-transaction")) },
}));

jest.mock("../../services/tenant.service", () => ({
  getTenantSettings: jest.fn(),
}));

jest.mock("../../services/redis.service", () => {
  const mockStore = new Map();
  return {
    mockStore,
    set: jest.fn(async (key, value) => {
      mockStore.set(key, JSON.stringify(value));
      return true;
    }),
    getDel: jest.fn(async (key) => {
      if (!mockStore.has(key)) {
        return null;
      }
      const raw = mockStore.get(key);
      mockStore.delete(key);
      return JSON.parse(raw);
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

const { Tenants, Users } = require("../../models");
const tenantService = require("../../services/tenant.service");
const redis = require("../../services/redis.service");
const auditService = require("../../services/audit.service");
const { createSession } = require("../../services/session.service");
const ssoService = require("../../services/sso.service");
const ssoController = require("../../controllers/sso.controller");

const TENANT = { id: "22222222-2222-4222-8222-222222222222", code: "rsx" };
const EMAIL = "nurse@hospital.example.com";

const call = (handler, req) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      redirect(url) {
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
    handler({ headers: { "user-agent": "jest" }, ip: "203.0.113.7", ...req }, res, () => {});
  });

const userRow = (overrides) => ({
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

const samlCallback = () =>
  call(ssoController.ssoCallback, {
    body: { SAMLResponse: "PHNhbWxwOlJlc3BvbnNlLz4=" },
    params: { tenantCode: TENANT.code },
  });

// A-68: an OIDC callback needs a sign-in this server started — its state and
// the browser's binding cookie. The flow's own store write is then forgotten,
// so "no hand-off code was issued" below still reads redis.set alone.
const oidcCallback = async () => {
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
    const code = new URL(cb.redirect).searchParams.get("code");

    const ex = await call(ssoController.ssoExchange, { body: { code } });
    expect(ex.status).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    expect(auditService.logAction.mock.calls[0][0]).toMatchObject({
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
    const target = new URL(res.redirect);
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

    expect(new URL(res.redirect).searchParams.get("error")).toBe("sso_account_refused");
    expect(redis.set).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });
});
