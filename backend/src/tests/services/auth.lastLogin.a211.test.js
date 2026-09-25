/**
 * A-211 — `lastLoginAt` is stamped when a session is ISSUED, not at the
 * password step.
 *
 * Before: loginUser wrote `lastLoginAt` as soon as the password matched —
 * before the MFA step — so an account whose password was known but whose
 * second factor never passed looked as if it had signed in, and a LOGIN that
 * rolled back (A-72: the session and its audit row are one transaction) still
 * left the stamp.
 *
 * Now: openLoginSession writes it in the session's transaction, for the
 * password-only sign-in and for the MFA step alike. SSO already did (A-188,
 * sso.controller#issueSsoTokens, proven in its own tests); impersonation is
 * not the holder signing in and does not stamp it.
 *
 * What is real: auth.service (loginUser, loginMfa), audit.service#logAction
 * with the audit schema enforced by the auditLedger fixture, the Joi login
 * schema, the throttle on its in-process store. Faked: the user rows (their
 * update() writes into the ledger), createSession, bcrypt and the TOTP check.
 */
const { createLedger } = require("../fixtures/auditLedger");

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

jest.mock("../../services/session.service", () => ({
  createSession: jest.fn(async () => ({ id: "33333333-3333-4333-8333-333333333333" })),
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(async (plain, hash) => plain === "Right-password-1" && hash === "hash"),
}));

jest.mock("../../services/mfa.service", () => ({ consumeCode: jest.fn(), consumeRecoveryCode: jest.fn() }));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { Users } = require("../../models");
const mfaService = require("../../services/mfa.service");
const authService = require("../../services/auth.service");
const limiter = require("../../services/rateLimiter.redis.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

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
  mfaSecret: null,
  role: null,
  update: jest.fn(async (values, options) => mockRef.ledger.write("users", values, options)),
  ...overrides,
});

const stamps = () => mockRef.ledger.committed("users").filter((row) => row.lastLoginAt);
const logins = () => mockRef.ledger.auditRows().filter((row) => row.action === "LOGIN");

let account;

beforeEach(() => {
  jest.clearAllMocks();
  mockRef.ledger = createLedger();
  limiter.clearMemoryStore();
  account = userRow();
  Users.findOne.mockImplementation(async () => account);
  Users.findByPk.mockImplementation(async () => account);
});

const passwordStep = () =>
  authService.loginUser({ user: "ada", password: "Right-password-1", ip: "198.51.100.9", userAgent: "ua" });

describe("A-211: the password step is not a sign-in", () => {
  it("an MFA account's correct password (202, MFA required) stamps nothing", async () => {
    account = userRow({ mfaEnabled: true, mfaSecret: "S" });

    const result = await passwordStep();

    expect(result.status).toBe(202);
    expect(stamps()).toEqual([]);
    expect(account.update).not.toHaveBeenCalledWith(expect.objectContaining({ lastLoginAt: expect.anything() }));
  });

  it("a wrong second factor after it stamps nothing either", async () => {
    account = userRow({ mfaEnabled: true, mfaSecret: "S" });
    await passwordStep();
    mfaService.consumeCode.mockResolvedValue(false);

    await expect(authService.loginMfa(USER_ID, "000000", "198.51.100.9", "ua")).rejects.toMatchObject({
      status: 401,
    });

    expect(stamps()).toEqual([]);
    expect(logins()).toEqual([]);
  });

  it("the MFA step that issues the session stamps it, in the session's transaction", async () => {
    account = userRow({ mfaEnabled: true, mfaSecret: "S" });
    await passwordStep();
    mfaService.consumeCode.mockResolvedValue(true);
    const before = Date.now();

    const result = await authService.loginMfa(USER_ID, "123456", "198.51.100.9", "ua");

    expect(result.status).toBe(200);
    expect(stamps()).toHaveLength(1);
    expect(stamps()[0].lastLoginAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(logins()).toHaveLength(1);
    // One write, inside a transaction (the ledger stages it and commits it with the LOGIN row).
    const [, options] = account.update.mock.calls.find(([values]) => values.lastLoginAt);
    expect(options.transaction).toBeDefined();
  });

  it("a password-only sign-in stamps it with the session it issues", async () => {
    const result = await passwordStep();

    expect(result.status).toBe(200);
    expect(stamps()).toHaveLength(1);
    expect(logins()).toHaveLength(1);
  });

  it("a sign-in whose LOGIN row cannot be written fails, and leaves no stamp", async () => {
    mockRef.ledger.failNext("audit_logs");

    await expect(passwordStep()).rejects.toThrow();

    expect(stamps()).toEqual([]);
    expect(logins()).toEqual([]);
  });
});
