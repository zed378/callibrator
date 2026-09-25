/**
 * A-215 — an administrator's temporary password expires.
 *
 * Before: the password an administrator chose at user creation, or issued by
 * the admin reset, signed in forever until its holder happened to change it.
 *
 * Now (ADR-068): it carries `temporaryPasswordExpiresAt`, 72 hours from issue
 * (user.service TEMPORARY_PASSWORD_TTL_MS; migration 0078 adds the column and
 * starts the clock for passwords issued before it). Past it:
 *  - sign-in answers the SAME 401 "Invalid credentials" as a wrong password,
 *    counted by the same throttle — so an expired temporary password is not
 *    an oracle for "this account exists and its temporary password was X";
 *  - a session opened before the expiry cannot use it to change the
 *    password (409, told only to someone who just proved it).
 * The holder's own change, and the e-mail-code reset, clear it.
 *
 * What is real: auth.service (loginUser, justUpdatePassword,
 * processResetPassword), the throttle on its in-process store, audit.service
 * with the auditLedger schema, the Joi schemas. Faked: rows, bcrypt,
 * createSession, session revocation.
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
  revokeAllSessions: jest.fn(async () => 0),
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(async (plain) => `hash:${plain}`),
  comparePassword: jest.fn(async (plain, hash) => hash === `hash:${plain}`),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { Users } = require("../../models");
const { logger } = require("../../middlewares/activityLog.middleware");
const authService = require("../../services/auth.service");
const limiter = require("../../services/rateLimiter.redis.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const TEMP = "Temporary-Pw-9";
const HOUR = 60 * 60 * 1000;

const userRow = (overrides = {}) => ({
  id: USER_ID,
  tenantId: TENANT_ID,
  tenant: { id: TENANT_ID, status: "active" },
  username: "ada",
  email: "ada@hospital.example.com",
  password: `hash:${TEMP}`,
  isActive: true,
  status: "ACTIVE",
  failedLoginAttempts: 0,
  lockedUntil: null,
  mfaEnabled: false,
  mustChangePassword: true,
  temporaryPasswordExpiresAt: new Date(Date.now() + 72 * HOUR),
  role: null,
  update: jest.fn(async (values, options) => {
    mockRef.ledger.write("users", values, options);
  }),
  ...overrides,
});

let account;

beforeEach(() => {
  jest.clearAllMocks();
  mockRef.ledger = createLedger();
  limiter.clearMemoryStore();
  account = userRow();
  Users.findOne.mockImplementation(async () => account);
  Users.findByPk.mockImplementation(async () => account);
});

const signIn = (password, identifier = "ada") =>
  authService
    .loginUser({ user: identifier, password, ip: "198.51.100.8", userAgent: "ua" })
    .then((r) => ({ status: r.status, message: r.message }))
    .catch((e) => ({ status: e.status, message: e.message }));

describe("A-215: sign-in with an administrator's temporary password", () => {
  it("works before it expires", async () => {
    expect(await signIn(TEMP)).toEqual({ status: 200, message: "Login successful" });
  });

  it("after it expires, is the same 401 as a wrong password — and as an unknown account", async () => {
    account = userRow({ temporaryPasswordExpiresAt: new Date(Date.now() - 1000) });

    const expired = await signIn(TEMP);
    const wrong = await signIn("Not-the-password-1");
    account = null;
    const unknown = await signIn(TEMP, "nobody");

    expect(expired).toEqual({ status: 401, message: "Invalid credentials" });
    expect(wrong).toEqual(expired);
    expect(unknown).toEqual(expired);
    // No session, no LOGIN row.
    expect(mockRef.ledger.auditRows()).toEqual([]);
    // The reason is in the server log only.
    expect(logger.info).toHaveBeenCalledWith("Sign-in refused: the temporary password has expired", {
      userId: USER_ID,
    });
  });

  it("an expired temporary password is counted by the throttle like any wrong password", async () => {
    account = userRow({ temporaryPasswordExpiresAt: new Date(Date.now() - 1000) });
    const { getAuthConfig } = require("../../constants/rateLimitConstants");
    const max = getAuthConfig("login").maxAttempts;

    const answers = [];
    for (let i = 0; i <= max; i += 1) {
      answers.push((await signIn(TEMP)).status);
    }

    expect(answers.slice(0, max).every((s) => s === 401)).toBe(true);
    expect(answers[max]).toBe(429);
  });

  it("a password the holder chose (no expiry) is unaffected", async () => {
    account = userRow({ mustChangePassword: false, temporaryPasswordExpiresAt: null });
    expect((await signIn(TEMP)).status).toBe(200);
  });
});

describe("A-215: the temporary password's lifetime", () => {
  it("temporaryPasswordExpired reads the column: null never expires, the past has", () => {
    expect(authService.temporaryPasswordExpired({ temporaryPasswordExpiresAt: null })).toBe(false);
    expect(authService.temporaryPasswordExpired({})).toBe(false);
    expect(authService.temporaryPasswordExpired({ temporaryPasswordExpiresAt: new Date(Date.now() + HOUR) })).toBe(
      false,
    );
    expect(
      authService.temporaryPasswordExpired({ temporaryPasswordExpiresAt: new Date(Date.now() - 1).toISOString() }),
    ).toBe(true);
  });

  it("the holder's change clears it", async () => {
    await authService.justUpdatePassword(USER_ID, "My-0wn-Passw0rd", TEMP);

    expect(mockRef.ledger.committed("users")).toEqual([
      expect.objectContaining({ mustChangePassword: false, temporaryPasswordExpiresAt: null }),
    ]);
  });

  it("a session opened before the expiry cannot change it afterwards: 409 with the state", async () => {
    account = userRow({ temporaryPasswordExpiresAt: new Date(Date.now() - 1000) });

    await expect(authService.justUpdatePassword(USER_ID, "My-0wn-Passw0rd", TEMP)).rejects.toMatchObject({
      status: 409,
      message:
        "The temporary password an administrator set for you has expired. Ask an administrator to reset your password again.",
    });
    expect(mockRef.ledger.committed("users")).toEqual([]);
  });

  it("but a WRONG current password is still the plain 400 — the expiry is told only to its holder", async () => {
    account = userRow({ temporaryPasswordExpiresAt: new Date(Date.now() - 1000) });

    await expect(
      authService.justUpdatePassword(USER_ID, "My-0wn-Passw0rd", "Guess-guess-1"),
    ).rejects.toMatchObject({ status: 400, message: "Current password is incorrect" });
  });

  it("an e-mail-code reset clears it", async () => {
    const crypto = require("crypto");
    account = userRow({
      otpCode: crypto.createHash("sha256").update("123456").digest("hex"),
      otpExpiredAt: new Date(Date.now() + HOUR),
    });

    await authService.processResetPassword({
      email: "ada@hospital.example.com",
      otp: "123456",
      password: "Brand-new-Passw0rd!",
      confirmPassword: "Brand-new-Passw0rd!",
    });

    expect(mockRef.ledger.committed("users")).toEqual([
      expect.objectContaining({ mustChangePassword: false, temporaryPasswordExpiresAt: null }),
    ]);
  });
});
