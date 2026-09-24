/**
 * A-126 (ADR-051 Q-15) — a brute-force lockout writes an `ACCOUNT_LOCKED`
 * audit row, in the transaction that persists the lock.
 *
 * Before: the fifth wrong password (auth.service#loginUser) and the per-user
 * budget of the MFA step (rateLimiter.redis.service#recordAuthFailure) wrote
 * `users.locked_until` and nothing else. The ENUM had no member for it, and a
 * lock is exactly what 21 CFR 11.300(d) asks to be detected and reported.
 *
 * What is real: auth.service#loginUser, rateLimiter.redis.service (on its
 * in-process store — no Redis is ready in a unit run), audit.service
 * (logAction and recordAccountLock, with its closed ACTION and actor checks),
 * the Joi login schema, and the audit_logs schema — action ENUM, NOT NULL
 * columns and migration 0033's actor CHECK — through the auditLedger fixture,
 * which also stands in for the database transaction. What is faked: the user
 * rows and bcrypt.
 *
 * What it does not prove: that PostgreSQL accepts the new ENUM labels — that
 * is migration 0049, verified on PostgreSQL 18 (see the A-126 section of
 * TASKS/AUDIT-2026-09-REMEDIATION.md).
 */
const { createLedger } = require("../fixtures/auditLedger");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");

const mockRef = { ledger: null };

jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

jest.mock("../../models", () => ({
  Users: { findOne: jest.fn(), findByPk: jest.fn(), update: jest.fn() },
  Role: {},
  User: {},
  Tenants: {},
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { Users } = require("../../models");
const { comparePassword } = require("../../utils/password.util");
const { logger } = require("../../middlewares/activityLog.middleware");
const authService = require("../../services/auth.service");
const {
  recordAuthFailure,
  noteAuthFailure,
  clearMemoryStore,
} = require("../../services/rateLimiter.redis.service");
const { getAuthConfig } = require("../../constants/rateLimitConstants");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

/** A user row whose `update` writes to the ledger's `users` table. */
const userRow = (overrides = {}) => ({
  id: USER_ID,
  tenantId: TENANT_ID,
  tenant: { id: TENANT_ID, status: "active" },
  username: "ada",
  email: "ada@hospital.example.com",
  password: "hash",
  isActive: true,
  status: "ACTIVE",
  failedLoginAttempts: 0,
  lockedUntil: null,
  mfaEnabled: false,
  role: null,
  update: jest.fn(async (values, options) => mockRef.ledger.write("users", values, options)),
  ...overrides,
});

const lockedRows = () => mockRef.ledger.auditRows().filter((r) => r.action === "ACCOUNT_LOCKED");
const lockWrites = () => mockRef.ledger.committed("users").filter((r) => r.lockedUntil);

const wrongPassword = (identifier = "ada") =>
  authService
    .loginUser({ user: identifier, password: "Wrong-password-1", ip: "198.51.100.7", userAgent: "probe" })
    .catch((e) => e);

beforeEach(() => {
  jest.clearAllMocks();
  mockRef.ledger = createLedger();
  clearMemoryStore();
  comparePassword.mockResolvedValue(false);
  Users.update.mockImplementation(async (values, options) =>
    mockRef.ledger.write("users", values, options),
  );
});

describe("A-126: the password lockout writes ACCOUNT_LOCKED", () => {
  it("the fifth wrong password writes one ACCOUNT_LOCKED row, committed with the lock", async () => {
    Users.findOne.mockResolvedValue(userRow({ failedLoginAttempts: 4 }));

    const err = await wrongPassword();

    expect(err.status).toBe(423);
    expect(lockedRows()).toHaveLength(1);
    const [row] = lockedRows();
    expect(row).toMatchObject({
      tenantId: TENANT_ID,
      // The lock is the system's act; the account is what it acted on.
      userId: null,
      actorType: "system",
      actorName: "system:auth-lockout",
      action: "ACCOUNT_LOCKED",
      resourceType: "User",
      resourceId: USER_ID,
      changes: { endpoint: "login", failedAttempts: 5, lockedUntil: expect.any(String) },
      ipAddress: "198.51.100.7",
      userAgent: "probe",
    });
    // The lock and its row committed together.
    expect(lockWrites()).toHaveLength(1);
    expect(new Date(row.changes.lockedUntil).getTime()).toBe(lockWrites()[0].lockedUntil.getTime());
  });

  it("a wrong password below the threshold writes no audit row (failed sign-ins stay in the security log)", async () => {
    Users.findOne.mockResolvedValue(userRow({ failedLoginAttempts: 2 }));

    const err = await wrongPassword();

    expect(err.status).toBe(401);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("an unknown account is never locked and never gets a row — no enumeration signal", async () => {
    Users.findOne.mockResolvedValue(null);

    for (let i = 0; i < 6; i += 1) {
      const err = await wrongPassword("nobody@nowhere.example");
      expect(err.status).toBe(401);
    }

    expect(mockRef.ledger.auditRows()).toEqual([]);
    expect(lockWrites()).toEqual([]);
  });

  it("an account with no tenant is recorded under PLATFORM (ADR-051 Q-14)", async () => {
    Users.findOne.mockResolvedValue(userRow({ tenantId: null, tenant: null, failedLoginAttempts: 4 }));

    await wrongPassword();

    expect(lockedRows()).toHaveLength(1);
    expect(lockedRows()[0].tenantId).toBe(PLATFORM_TENANT_ID);
  });

  it("if the row cannot be written the lock is still persisted — the lock never depends on the audit table", async () => {
    Users.findOne.mockResolvedValue(userRow({ failedLoginAttempts: 4 }));
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

    const err = await wrongPassword();

    expect(err.status).toBe(423);
    expect(mockRef.ledger.auditRows()).toEqual([]);
    // Rolled back with the failed row, then written again on its own.
    expect(lockWrites()).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      "ACCOUNT_LOCKED was not recorded; persisting the lock without its audit row",
      { userId: USER_ID, endpoint: "login", error: "audit insert failed" },
    );
  });
});

describe("A-126: the per-user limiter's sign-in lock writes ACCOUNT_LOCKED", () => {
  const max = getAuthConfig("mfaLogin").maxAttempts;
  const failMfa = (n, audit) =>
    (async () => {
      for (let i = 0; i < n; i += 1) {
        await recordAuthFailure({ userId: USER_ID, endpoint: "mfaLogin", audit });
      }
    })();

  it("the attempt that reaches the budget writes one row; a racing attempt past it writes none", async () => {
    Users.findByPk.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID });

    await failMfa(max - 1);
    expect(mockRef.ledger.auditRows()).toEqual([]);

    await failMfa(2, { ipAddress: "203.0.113.9", userAgent: "ua" });

    expect(lockedRows()).toHaveLength(1);
    expect(lockedRows()[0]).toMatchObject({
      tenantId: TENANT_ID,
      actorName: "system:auth-lockout",
      resourceId: USER_ID,
      changes: { endpoint: "mfaLogin", failedAttempts: max },
      ipAddress: "203.0.113.9",
      userAgent: "ua",
    });
    // Both attempts at or past the budget persist the lock.
    expect(lockWrites()).toHaveLength(2);
    // The account is read deliberately across tenants (there is no tenant
    // context before sign-in), and only for its id and tenant.
    expect(Users.findByPk).toHaveBeenCalledWith(USER_ID, {
      attributes: ["id", "tenantId"],
      skipTenantScope: true,
    });
  });

  it("an id that names no account persists the lock and writes no row", async () => {
    Users.findByPk.mockResolvedValue(null);

    await failMfa(max);

    expect(mockRef.ledger.auditRows()).toEqual([]);
    expect(lockWrites()).toHaveLength(1);
    expect(Users.update).toHaveBeenLastCalledWith(
      { failedLoginAttempts: max, lockedUntil: expect.any(Date) },
      { where: { id: USER_ID } },
    );
  });

  it("an account that cannot be read still gets its lock", async () => {
    Users.findByPk.mockRejectedValue(new Error("connection reset"));

    await failMfa(max);

    expect(mockRef.ledger.auditRows()).toEqual([]);
    expect(lockWrites()).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Could not load the account being locked: connection reset",
    );
  });

  it("an endpoint whose lock is its own (mfaManage) writes no ACCOUNT_LOCKED — the account is not locked", async () => {
    Users.findByPk.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID });

    for (let i = 0; i < getAuthConfig("mfaManage").maxAttempts; i += 1) {
      await recordAuthFailure({ userId: USER_ID, endpoint: "mfaManage" });
    }

    expect(mockRef.ledger.auditRows()).toEqual([]);
    expect(lockWrites()).toEqual([]);
  });

  it("noteAuthFailure records the request's address and agent on the row, even with per-IP counting off", async () => {
    delete process.env.AUTH_RATE_LIMIT_BY_IP;
    Users.findByPk.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID });
    const req = (headers) => ({
      rateLimitContext: { userId: USER_ID, tokenHash: null, ip: "10.9.9.9", endpoint: "mfaLogin" },
      ip: "10.9.9.9",
      headers,
      socket: {},
    });

    for (let i = 0; i < max - 1; i += 1) {
      await noteAuthFailure(req({}), "mfaLogin");
    }
    await noteAuthFailure(req({ "user-agent": "curl/8" }), "mfaLogin");

    expect(lockedRows()).toHaveLength(1);
    expect(lockedRows()[0]).toMatchObject({ ipAddress: "10.9.9.9", userAgent: "curl/8" });
  });

  it("noteAuthFailure records nulls when the request carries neither", async () => {
    Users.findByPk.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID });
    const req = { rateLimitContext: { userId: USER_ID, endpoint: "mfaLogin" }, socket: {} };

    for (let i = 0; i < max; i += 1) {
      await noteAuthFailure(req, "mfaLogin");
    }

    expect(lockedRows()[0]).toMatchObject({ ipAddress: null, userAgent: null });
  });
});
