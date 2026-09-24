/**
 * A-146 — a refreshed impersonation token keeps its `impersonatorId`.
 *
 * impersonateUser puts the super admin's id in the access token as
 * `impersonatorId`. That claim is what F-8 attributes audit rows with and what
 * A-127 (ADR-052) refuses Part 11 acts on. The session row did not store it, so
 * refreshUserToken — which rebuilds the access token from the session — issued
 * a token WITHOUT it: after one refresh the operator's changes were audited as
 * the hospital user alone, and signing was no longer refused. The refresh also
 * turned the one-hour impersonation into a seven-day session.
 *
 * What is real: auth.service (impersonateUser, refreshUserToken),
 * session.service (createSession, validateSession, revokeSession,
 * isSessionLive), jwt.util (tokens are really signed and verified),
 * the auth middleware, denyPlatformAuthoring, audit.service#logAction, and
 * the audit_logs schema through the auditLedger fixture. What is faked: the
 * users and sessions tables (in memory, with the model's snake_case columns),
 * Redis, and the tenant / API-key lookups the middleware does not reach here.
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, sessions: new Map(), users: new Map(), nextId: 1 };

jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

/** A row of the fake `sessions` table: snake_case, as the model declares. */
const mockSessionRow = (values) => {
  const row = {
    id: `sess-${mockRef.nextId++}`,
    is_revoked: false,
    is_active: true,
    impersonator_id: null,
    ...values,
    update: jest.fn(async (changes) => Object.assign(row, changes)),
  };
  return row;
};
const mockMatches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);

jest.mock("../../models", () => ({
  Users: {
    findByPk: jest.fn(async (id) => mockRef.users.get(id) || null),
    findOne: jest.fn(async ({ where }) => {
      const user = mockRef.users.get(where.id);
      return user && user.tenantId === where.tenantId ? user : null;
    }),
  },
  Role: {},
  User: {},
  Tenants: {},
  Sessions: {
    create: jest.fn(async (values) => {
      const row = mockSessionRow(values);
      mockRef.sessions.set(row.id, row);
      return row;
    }),
    findOne: jest.fn(async ({ where }) => [...mockRef.sessions.values()].find((r) => mockMatches(r, where)) || null),
    update: jest.fn(async (changes, { where }) => {
      const rows = [...mockRef.sessions.values()].filter((r) => mockMatches(r, where));
      rows.forEach((r) => Object.assign(r, changes));
      return [rows.length];
    }),
  },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
}));

jest.mock("../../services/redis.service", () => ({
  get: jest.fn(async () => null),
  set: jest.fn(async () => undefined),
  del: jest.fn(async () => undefined),
  delPattern: jest.fn(),
  cacheKeys: {},
  getRedisConnection: jest.fn(() => null),
}));

jest.mock("../../services/tenant.service", () => ({
  getTenantByCodeForMiddleware: jest.fn(),
  getTenantByIdForMiddleware: jest.fn(),
}));
jest.mock("../../services/apiKey.service", () => ({ verifyApiKey: jest.fn() }));
jest.mock("../../middlewares/tenantContext.middleware", () => {
  const actual = jest.requireActual("../../middlewares/tenantContext.middleware");
  return {
    ...actual,
    tenantContextMiddleware: (req, res, next) =>
      actual.tenantStorage.run({ tenantId: req.tenantId, isSuperAdmin: false }, () => next()),
  };
});
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const authService = require("../../services/auth.service");
const auditService = require("../../services/audit.service");
const { verifyAccessToken } = require("../../utils/jwt.util");
const { auth } = require("../../middlewares/auth.middleware");
const { denyPlatformAuthoring } = require("../../middlewares/denyPlatformAuthoring.middleware");

const SUPER_ADMIN = "99999999-9999-4999-8999-999999999999";
const HOSPITAL_USER = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const HOUR = 60 * 60 * 1000;

const superAdmin = (overrides = {}) => ({
  id: SUPER_ADMIN,
  email: "ops@callibrator.example",
  tenantId: null,
  isActive: true,
  status: "ACTIVE",
  role: { name: "SUPER_ADMIN" },
  ...overrides,
});

const hospitalUser = () => ({
  id: HOSPITAL_USER,
  email: "nurse@hospital.example",
  username: "nurse",
  tenantId: TENANT,
  tenant: { id: TENANT, status: "active", settings: {} },
  isActive: true,
  status: "ACTIVE",
  mustChangePassword: false,
  role: { id: "r-1", name: "USER" },
});

const impersonate = () => authService.impersonateUser(SUPER_ADMIN, TENANT, HOSPITAL_USER, "10.0.0.1", "ops-browser");

beforeEach(() => {
  jest.clearAllMocks();
  mockRef.ledger = createLedger();
  mockRef.sessions.clear();
  mockRef.users.clear();
  mockRef.users.set(SUPER_ADMIN, superAdmin());
  mockRef.users.set(HOSPITAL_USER, hospitalUser());
});

describe("A-146: an impersonation survives a refresh", () => {
  it("the impersonation session row records the operator", async () => {
    const result = await impersonate();

    const row = mockRef.sessions.get(result.session.id);
    expect(row.impersonator_id).toBe(SUPER_ADMIN);
    expect(row.user_id).toBe(HOSPITAL_USER);
  });

  it("a refreshed impersonation token still carries impersonatorId", async () => {
    const { refreshToken } = await impersonate();

    const refreshed = await authService.refreshUserToken(refreshToken);

    const claims = verifyAccessToken(refreshed.data.token);
    expect(claims.id).toBe(HOSPITAL_USER);
    expect(claims.impersonatorId).toBe(SUPER_ADMIN);
    expect(claims.sid).toBe(refreshed.data.session.id);
    // ... and so does the new session row, so the NEXT refresh keeps it too.
    expect(mockRef.sessions.get(refreshed.data.session.id).impersonator_id).toBe(SUPER_ADMIN);

    const again = await authService.refreshUserToken(refreshed.data.refreshToken);
    expect(verifyAccessToken(again.data.token).impersonatorId).toBe(SUPER_ADMIN);
  });

  it("a refresh does not extend the impersonation beyond its hour", async () => {
    const { refreshToken, session } = await impersonate();
    const originalExpiry = mockRef.sessions.get(session.id).expired_at;
    expect(originalExpiry.getTime()).toBeLessThanOrEqual(Date.now() + HOUR);

    const refreshed = await authService.refreshUserToken(refreshToken);

    expect(mockRef.sessions.get(refreshed.data.session.id).expired_at).toBe(originalExpiry);
  });

  it("an ordinary session's refresh carries no claim and gets its seven days", async () => {
    const created = await require("../../services/session.service").createSession({
      tenantId: TENANT,
      userId: HOSPITAL_USER,
      refreshToken: "plain-refresh",
      expiredAt: new Date(Date.now() + HOUR),
    });
    expect(created.impersonator_id).toBeNull();

    const refreshed = await authService.refreshUserToken("plain-refresh");

    expect(verifyAccessToken(refreshed.data.token)).not.toHaveProperty("impersonatorId");
    expect(mockRef.sessions.get(refreshed.data.session.id).expired_at.getTime()).toBeGreaterThan(
      Date.now() + 6 * 24 * HOUR,
    );
  });

  it.each([
    ["deleted", null],
    ["deactivated", superAdmin({ isActive: false })],
    ["suspended", superAdmin({ status: "SUSPENDED" })],
    ["demoted", superAdmin({ role: { name: "TENANT_ADMIN" } })],
    ["role-less", superAdmin({ role: null })],
  ])("an operator since %s cannot refresh the impersonation — it ends, revoked", async (_, operator) => {
    const { refreshToken, session } = await impersonate();
    if (operator) {mockRef.users.set(SUPER_ADMIN, operator);} else {mockRef.users.delete(SUPER_ADMIN);}

    await expect(authService.refreshUserToken(refreshToken)).rejects.toMatchObject({
      status: 401,
      message: "The impersonation has ended: the operator may no longer impersonate",
    });
    expect(mockRef.sessions.get(session.id)).toMatchObject({
      is_revoked: true,
      revoked_reason: "IMPERSONATOR_REVOKED",
    });
    expect([...mockRef.sessions.values()]).toHaveLength(1);
  });

  it("SUPERADMIN (the legacy role name) may still refresh", async () => {
    const { refreshToken } = await impersonate();
    mockRef.users.set(SUPER_ADMIN, superAdmin({ role: { name: "SUPERADMIN" } }));

    const refreshed = await authService.refreshUserToken(refreshToken);

    expect(verifyAccessToken(refreshed.data.token).impersonatorId).toBe(SUPER_ADMIN);
  });
});

describe("A-146: the refreshed token is still treated as an impersonation (F-8, A-127)", () => {
  /** Run `work(req)` behind the real auth middleware, then `after` middlewares. */
  const withRefreshedToken = async (token, ...chain) => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    const req = {
      method: "POST",
      baseUrl: "/api/v1/esignature",
      path: "/sign",
      headers: { authorization: `Bearer ${token}`, "user-agent": "UA" },
      ip: "10.0.0.7",
    };
    let pending = null;
    const run = (i) => {
      if (i >= chain.length) {return;}
      const handler = chain[i];
      pending = Promise.resolve(handler(req, res, () => run(i + 1)));
    };
    await auth(req, res, () => run(0));
    await pending;
    return { req, res };
  };

  beforeEach(() => {
    jest.spyOn(authService, "getAuthUserWithTenant").mockImplementation(async (id) => mockRef.users.get(id));
  });

  it("an audit row written with the refreshed token names the impersonating super admin", async () => {
    const { refreshToken } = await impersonate();
    const { data } = await authService.refreshUserToken(refreshToken);

    const { req } = await withRefreshedToken(data.token, (r) =>
      mockRef.ledger.transaction((transaction) =>
        auditService.logAction(
          { tenantId: TENANT, userId: r.user.id, action: "UPDATE", resourceType: "Device", resourceId: "d-1" },
          { transaction },
        ),
      ),
    );

    expect(req.impersonatorId).toBe(SUPER_ADMIN);
    const rows = mockRef.ledger.auditRows().filter((r) => r.resourceType === "Device");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: HOSPITAL_USER, impersonatorId: SUPER_ADMIN });
  });

  it("signing with the refreshed token is still refused (A-127, ADR-052)", async () => {
    const { refreshToken } = await impersonate();
    const { data } = await authService.refreshUserToken(refreshToken);
    const handler = jest.fn();

    const { res } = await withRefreshedToken(data.token, denyPlatformAuthoring, handler);

    expect(res.statusCode).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});
