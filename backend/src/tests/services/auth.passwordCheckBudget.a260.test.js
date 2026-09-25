/**
 * A-260 — the signed-in password checks are budgeted per user.
 *
 * Before: POST /auth/pass-is-valid, the change-password route and the fresh
 * re-authentication of a passkey removal, an email change and an MFA
 * rotation or disable compared a typed password with the caller's hash as
 * often as asked. Whoever held a session could guess the password there
 * without ever meeting the sign-in throttle (ADR-068 recorded it as open).
 *
 * Now (ADR-072, auth.service#verifySessionPassword): one budget per user,
 * AUTH_ENDPOINTS.passwordCheck — five wrong passwords in fifteen minutes,
 * across every one of those checks. The attempt that spends it:
 *  - signs out the session that made it and writes ACCOUNT_LOCKED (actor
 *    system:auth-lockout) in ONE transaction of its own, which survives the
 *    rollback of the change being re-authenticated;
 *  - answers 429 carrying `retryAfterSeconds`, as does every check until the
 *    window ends — without comparing the password at all.
 * It never writes users.locked_until, and the right password clears the count.
 *
 * What is real: auth.service, webauthn.service#disable, the limiter on its
 * in-process store, audit.service#logAction with the audit schema enforced by
 * the auditLedger fixture. Faked: rows, bcrypt, session revocation (it writes
 * a `sessions` row into the ledger, in whatever transaction is ambient).
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, sessionId: "33333333-3333-4333-8333-333333333333" };

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

jest.mock("../../services/redis.service", () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn() }));

jest.mock("../../services/session.service", () => ({
  createSession: jest.fn(),
  revokeAllSessions: jest.fn(async () => 0),
  revokeOtherSessions: jest.fn(async () => 0),
  getCurrentSessionId: jest.fn(() => mockRef.sessionId),
  revokeSessionById: jest.fn(async (id, reason) => {
    mockRef.ledger.write("sessions", { id, revokedReason: reason });
    return [1];
  }),
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(async (plain) => `hash:${plain}`),
  comparePassword: jest.fn(async (plain, hash) => hash === `hash:${plain}`),
}));

jest.mock("../../services/mfa.service", () => ({
  consumeCode: jest.fn(async (user, code) => code === "123456"),
  consumeRecoveryCode: jest.fn(async () => false),
  MFA_CLEARED: {},
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { Users } = require("../../models");
const sessionService = require("../../services/session.service");
const { comparePassword } = require("../../utils/password.util");
const { logger } = require("../../middlewares/activityLog.middleware");
const authService = require("../../services/auth.service");
const webauthn = require("../../services/webauthn.service");
const limiter = require("../../services/rateLimiter.redis.service");
const { AUTH_ENDPOINTS } = require("../../constants/rateLimitConstants");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const RIGHT = "Right-password-1";
const WRONG = "Wrong-password-1";
const CONTEXT = { ipAddress: "198.51.100.8", userAgent: "jest" };

const userRow = (overrides = {}) => ({
  id: USER_ID,
  tenantId: TENANT_ID,
  password: `hash:${RIGHT}`,
  mfaEnabled: false,
  webauthnEnabled: true,
  mustChangePassword: false,
  temporaryPasswordExpiresAt: null,
  update: jest.fn(async (values, options) => {
    mockRef.ledger.write("users", values, options);
  }),
  ...overrides,
});

let account;

beforeEach(() => {
  jest.clearAllMocks();
  mockRef.ledger = createLedger();
  mockRef.sessionId = "33333333-3333-4333-8333-333333333333";
  limiter.clearMemoryStore();
  account = userRow();
  Users.findOne.mockImplementation(async () => account);
  Users.findByPk.mockImplementation(async () => account);
});

const outcome = (promise) =>
  promise.then(
    (r) => ({ ok: true, value: r }),
    (e) => ({ status: e.status, message: e.message, retryAfterSeconds: e.retryAfterSeconds }),
  );

const checkWrong = () => outcome(authService.passIsValid(USER_ID, WRONG, CONTEXT));

describe("A-260: the budget and its configuration", () => {
  it("is five wrong passwords in fifteen minutes, and never the sign-in lock", () => {
    expect(AUTH_ENDPOINTS.passwordCheck).toEqual({
      maxAttempts: 5,
      windowMs: 15 * 60 * 1000,
      lockoutMs: 15 * 60 * 1000,
      description: "Signed-in password checks",
      persistUserLockout: false,
    });
  });
});

describe("A-260: POST /auth/pass-is-valid", () => {
  it("four wrong answers are ordinary 'invalid' answers", async () => {
    for (let i = 0; i < 4; i += 1) {
      const r = await checkWrong();
      expect(r).toEqual({ ok: true, value: expect.objectContaining({ data: { valid: false } }) });
    }
    expect(mockRef.ledger.auditRows()).toEqual([]);
    expect(sessionService.revokeSessionById).not.toHaveBeenCalled();
  });

  it("the fifth is a 429 with Retry-After: the session is signed out and ACCOUNT_LOCKED is written with it", async () => {
    for (let i = 0; i < 4; i += 1) {
      await checkWrong();
    }
    const fifth = await checkWrong();

    expect(fifth).toEqual({
      status: 429,
      message:
        "Too many wrong passwords. Password checks for this account are paused; try again later. This session has been signed out.",
      retryAfterSeconds: 900,
    });
    expect(sessionService.revokeSessionById).toHaveBeenCalledWith(mockRef.sessionId, "PASSWORD_CHECKS_EXHAUSTED");
    expect(mockRef.ledger.committed("sessions")).toEqual([
      { id: mockRef.sessionId, revokedReason: "PASSWORD_CHECKS_EXHAUSTED" },
    ]);
    const rows = mockRef.ledger.auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: TENANT_ID,
      userId: null,
      actorType: "system",
      actorName: "system:auth-lockout",
      action: "ACCOUNT_LOCKED",
      resourceType: "User",
      resourceId: USER_ID,
      changes: {
        endpoint: "passwordCheck",
        scope: "session-password-check",
        purpose: "Checking your password",
        failedAttempts: 5,
        lockedUntil: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
        sessionRevoked: true,
      },
      ipAddress: "198.51.100.8",
      userAgent: "jest",
    });
    // Never the sign-in lock.
    expect(Users.update).not.toHaveBeenCalled();
    expect(account.update).not.toHaveBeenCalled();
  });

  it("while paused, even the right password is refused 429 without being compared, and nothing more is audited", async () => {
    for (let i = 0; i < 5; i += 1) {
      await checkWrong();
    }
    comparePassword.mockClear();

    const r = await outcome(authService.passIsValid(USER_ID, RIGHT, CONTEXT));

    expect(r.status).toBe(429);
    expect(r.message).toBe(
      "Too many wrong passwords. Password checks for this account are paused; try again later.",
    );
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(900);
    expect(comparePassword).not.toHaveBeenCalled();
    expect(mockRef.ledger.auditRows()).toHaveLength(1);
  });

  it("the right password clears the count", async () => {
    for (let i = 0; i < 4; i += 1) {
      await checkWrong();
    }
    const right = await outcome(authService.passIsValid(USER_ID, RIGHT, CONTEXT));
    expect(right.value.data).toEqual({ valid: true });

    for (let i = 0; i < 4; i += 1) {
      expect((await checkWrong()).ok).toBe(true);
    }
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("a missing or non-string password is a 400, not a guess", async () => {
    for (const password of [undefined, "", 12345]) {
      const r = await outcome(authService.passIsValid(USER_ID, password));
      expect(r).toMatchObject({ status: 400, message: "Password is required" });
    }
    expect(comparePassword).not.toHaveBeenCalled();
    expect((await limiter.checkPasswordCheckBudget(USER_ID)).throttled).toBe(false);
  });

  it("an unknown user is still a 404", async () => {
    account = null;
    expect(await outcome(authService.passIsValid(USER_ID, WRONG))).toMatchObject({ status: 404 });
  });
});

describe("A-260: one budget across every signed-in password check", () => {
  it("wrong passwords spread over change-password, MFA rotation, MFA disable and a passkey removal share it", async () => {
    await authService.justUpdatePassword(USER_ID, "New-password-12", WRONG, CONTEXT).catch(() => {});
    // A rotation: setup on an account that already has MFA.
    account = userRow({ mfaEnabled: true });
    await authService.setupMfa(USER_ID, { currentPassword: WRONG, code: "123456" }, CONTEXT).catch(() => {});
    await authService
      .disableMfa(USER_ID, { currentPassword: WRONG, code: "123456" }, { ...CONTEXT, sessionId: "sid-own" })
      .catch(() => {});
    account = userRow();
    await webauthn.disable(TENANT_ID, USER_ID, { currentPassword: WRONG }, CONTEXT).catch(() => {});
    expect(mockRef.ledger.auditRows()).toEqual([]);

    const fifth = await outcome(authService.justUpdatePassword(USER_ID, "New-password-12", WRONG, CONTEXT));

    expect(fifth.status).toBe(429);
    expect(mockRef.ledger.auditRows()[0].changes).toMatchObject({
      purpose: "Changing your password",
      failedAttempts: 5,
    });
    // The password did not change.
    expect(mockRef.ledger.committed("users")).toEqual([]);
  });

  it("a wrong password below the budget keeps each route's own answer", async () => {
    expect(await outcome(authService.justUpdatePassword(USER_ID, "New-password-12", WRONG))).toMatchObject({
      status: 400,
      message: "Current password is incorrect",
    });
    account = userRow({ mfaEnabled: true });
    expect(await outcome(authService.setupMfa(USER_ID, { currentPassword: WRONG, code: "123456" }))).toMatchObject({
      status: 400,
      message: "Current password or MFA code is incorrect",
    });
    expect(
      await outcome(authService.disableMfa(USER_ID, { currentPassword: WRONG, code: "123456" })),
    ).toMatchObject({ status: 400, message: "Current password or MFA code is incorrect" });
  });

  it("MFA disable spends the budget with its own session id; rotation with the request's", async () => {
    account = userRow({ mfaEnabled: true });
    for (let i = 0; i < 4; i += 1) {
      await authService.setupMfa(USER_ID, { currentPassword: WRONG, code: "123456" }, CONTEXT).catch(() => {});
    }
    const fifth = await outcome(
      authService.disableMfa(USER_ID, { currentPassword: WRONG, code: "123456" }, { ...CONTEXT, sessionId: "sid-own" }),
    );
    expect(fifth.status).toBe(429);
    expect(sessionService.revokeSessionById).toHaveBeenCalledWith("sid-own", "PASSWORD_CHECKS_EXHAUSTED");
    expect(mockRef.ledger.auditRows()[0].changes.purpose).toBe("Turning off MFA");
  });

  it("a re-authentication's pause survives the rollback of the change it guarded", async () => {
    for (let i = 0; i < 4; i += 1) {
      await webauthn.disable(TENANT_ID, USER_ID, { currentPassword: WRONG }, CONTEXT).catch(() => {});
    }
    const fifth = await outcome(webauthn.disable(TENANT_ID, USER_ID, { currentPassword: WRONG }, CONTEXT));

    expect(fifth.status).toBe(429);
    // The passkey is still there: the removal rolled back...
    expect(mockRef.ledger.committed("users")).toEqual([]);
    // ...but the pause, its audit row and the sign-out committed on their own.
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        action: "ACCOUNT_LOCKED",
        changes: expect.objectContaining({ purpose: "Removing a passkey", sessionRevoked: true }),
        ipAddress: "198.51.100.8",
      }),
    ]);
    expect(mockRef.ledger.committed("sessions")).toHaveLength(1);
  });

  it("reauthenticate refuses a spent budget before comparing anything", async () => {
    for (let i = 0; i < 5; i += 1) {
      await checkWrong();
    }
    comparePassword.mockClear();
    const r = await outcome(
      authService.reauthenticate(account, { currentPassword: RIGHT }, { purpose: "Changing your email address" }),
    );
    expect(r.status).toBe(429);
    expect(comparePassword).not.toHaveBeenCalled();
  });
});

describe("A-260: verifySessionPassword edge cases", () => {
  const verify = (candidate, options = { purpose: "Checking your password" }) =>
    outcome(authService.verifySessionPassword(account, candidate, options));

  it("a tenant-less account (the platform operator) is audited in the platform tenant", async () => {
    account = userRow({ tenantId: null });
    for (let i = 0; i < 4; i += 1) {
      await verify(WRONG);
    }
    expect((await verify(WRONG)).status).toBe(429);
    expect(mockRef.ledger.auditRows()[0].tenantId).toBe(PLATFORM_TENANT_ID);
  });

  it("with no session to sign out, the pause is still audited, and says so", async () => {
    mockRef.sessionId = null;
    for (let i = 0; i < 4; i += 1) {
      await verify(WRONG);
    }
    const fifth = await verify(WRONG);
    expect(fifth.message).toBe(
      "Too many wrong passwords. Password checks for this account are paused; try again later.",
    );
    expect(sessionService.revokeSessionById).not.toHaveBeenCalled();
    expect(mockRef.ledger.auditRows()[0].changes.sessionRevoked).toBe(false);
  });

  it("a session already revoked counts as not signed out", async () => {
    sessionService.revokeSessionById.mockResolvedValueOnce([0]);
    for (let i = 0; i < 4; i += 1) {
      await verify(WRONG);
    }
    await verify(WRONG);
    expect(mockRef.ledger.auditRows()[0].changes.sessionRevoked).toBe(false);
  });

  it("if the audit row cannot be written, the session is signed out anyway and the failure is logged", async () => {
    for (let i = 0; i < 4; i += 1) {
      await verify(WRONG);
    }
    mockRef.ledger.failNext("audit_logs");
    const fifth = await verify(WRONG);

    expect(fifth.status).toBe(429);
    expect(fifth.message).toMatch(/This session has been signed out\.$/);
    expect(mockRef.ledger.auditRows()).toEqual([]);
    // The in-transaction revoke rolled back; the fallback one committed.
    expect(mockRef.ledger.committed("sessions")).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Password-check pause was not audited; signing the session out without its row",
      { userId: USER_ID, error: expect.any(String) },
    );
  });

  it("an attempt racing past the budget signs its own session out but writes no second row", async () => {
    for (let i = 0; i < 5; i += 1) {
      await limiter.recordPasswordCheckFailure(USER_ID);
    }
    // The check ran before the other attempts were counted.
    jest.spyOn(limiter, "checkPasswordCheckBudget").mockResolvedValueOnce({ throttled: false, retryAfterSeconds: 0 });

    const late = await verify(WRONG);

    expect(late.status).toBe(429);
    expect(late.message).toMatch(/This session has been signed out\.$/);
    expect(sessionService.revokeSessionById).toHaveBeenCalledTimes(1);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });
});

describe("A-260: the limiter's password-check counter", () => {
  it("counts per user, engages once, and clears", async () => {
    const results = [];
    for (let i = 0; i < 6; i += 1) {
      results.push(await limiter.recordPasswordCheckFailure("u-a"));
    }
    expect(results.map((r) => [r.failedAttempts, r.engaged, r.exhausted])).toEqual([
      [1, false, false],
      [2, false, false],
      [3, false, false],
      [4, false, false],
      [5, true, true],
      [6, false, true],
    ]);
    expect(results[4].retryAfterSeconds).toBe(900);
    expect(results[4].pausedUntil).toBeInstanceOf(Date);
    expect((await limiter.checkPasswordCheckBudget("u-a")).throttled).toBe(true);
    // Another user's budget is their own.
    expect(await limiter.checkPasswordCheckBudget("u-b")).toEqual({ throttled: false, retryAfterSeconds: 0 });

    await limiter.clearPasswordCheckBudget("u-a");
    expect((await limiter.checkPasswordCheckBudget("u-a")).throttled).toBe(false);
  });

  it("a paused budget reports at least one second to wait", async () => {
    const realNow = Date.now;
    const t0 = realNow();
    try {
      Date.now = () => t0;
      for (let i = 0; i < 5; i += 1) {
        await limiter.recordPasswordCheckFailure("u-c");
      }
      Date.now = () => t0 + 15 * 60 * 1000 - 500;
      expect(await limiter.checkPasswordCheckBudget("u-c")).toEqual({ throttled: true, retryAfterSeconds: 1 });
    } finally {
      Date.now = realNow;
    }
  });
});
