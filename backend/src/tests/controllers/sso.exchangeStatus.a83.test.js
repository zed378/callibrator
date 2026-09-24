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
const USER_ID = "11111111-1111-4111-8111-111111111111";

const call = (handler, req) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      redirect(url) {
        resolve({ status: 302, redirect: url });
      },
      set() {
        return this;
      },
    };
    handler({ headers: { "user-agent": "jest" }, ip: "203.0.113.7", ...req }, res, () => {});
  });

const userRow = (overrides = {}) => ({
  id: USER_ID,
  tenantId: TENANT.id,
  email: EMAIL,
  isActive: true,
  status: "ACTIVE",
  tenant: { id: TENANT.id, status: "active" },
  ...overrides,
});

/** An active user completes the SAML callback; return the one-time code. */
const codeFromCallback = async () => {
  Users.findOne.mockResolvedValue(userRow());
  const cb = await call(ssoController.ssoCallback, {
    body: { SAMLResponse: "PHNhbWxwOlJlc3BvbnNlLz4=" },
    params: { tenantCode: TENANT.code },
  });
  expect(cb.status).toBe(302);
  return new URL(cb.redirect).searchParams.get("code");
};

const exchange = (code) => call(ssoController.ssoExchange, { body: { code } });

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
    expect(ex.body.message).toBe(message);
    expect(createSession).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();

    // The code was spent by the refused attempt: it cannot be retried once
    // the account is re-enabled.
    Users.findByPk.mockResolvedValue(userRow());
    expect((await exchange(code)).status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });
});
