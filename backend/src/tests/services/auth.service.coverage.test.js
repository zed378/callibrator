/**
 * Branch/line coverage tests for auth.service.js
 *
 * Complements auth.service.test.js — targets the registration guard rails
 * (validation, lock contention, duplicate email/username, rollback), the login
 * lockout/MFA branches, and the OTP queue's failure handling.
 *
 * Mocking notes (this repo has a history of mocks that hide bugs):
 *  - The auth VALIDATOR is NOT stubbed wholesale: `validate` wraps the real Joi
 *    implementation, so schemas genuinely run. Only two provably-unreachable
 *    defensive guards override it, and each says so inline.
 *  - `cacheKeys` is the REAL object from redis.service. Do not fabricate keys on
 *    it — auth.service.js:567 already calls a `cacheKeys.userSessions` that does
 *    not exist, and a fabricated mock is what has been hiding that.
 */

jest.mock("../../config", () => ({
  db: { transaction: jest.fn() },
}));

jest.mock("../../models", () => ({
  Users: { findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn() },
  Role: { findOne: jest.fn() },
  Roles: { findOne: jest.fn() },
  Tenants: { findOne: jest.fn() },
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
}));

jest.mock("../../utils/jwt.util", () => ({
  generateAccessToken: jest.fn(),
  verifyAccessToken: jest.fn(),
  generateOpaqueRefreshToken: jest.fn(),
  generateRefreshToken: jest.fn(),
}));

jest.mock("../../services/emailQueue.service", () => ({
  queueActivationEmail: jest.fn(),
  queueOtpEmail: jest.fn(),
}));

jest.mock("../../services/session.service", () => ({
  createSession: jest.fn(),
  validateSession: jest.fn(),
  revokeSession: jest.fn(),
  revokeAllSessions: jest.fn(),
}));

// Real Joi schemas + real formatErrors; only `validate` is spy-wrapped so the
// two dead defensive guards below can be reached.
jest.mock("../../validators/auth.validator", () => {
  const actual = jest.requireActual("../../validators/auth.validator");
  return { ...actual, validate: jest.fn(actual.validate) };
});

// Real cacheKeys (see header note); only the IO functions are stubbed.
jest.mock("../../services/redis.service", () => {
  const actual = jest.requireActual("../../services/redis.service");
  return {
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    cacheKeys: actual.cacheKeys,
  };
});

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { db } = require("../../config");
const { Users } = require("../../models");
const { hashPassword, comparePassword } = require("../../utils/password.util");
const {
  generateAccessToken,
  generateOpaqueRefreshToken,
} = require("../../utils/jwt.util");
const {
  queueActivationEmail,
  queueOtpEmail,
} = require("../../services/emailQueue.service");
const { createSession } = require("../../services/session.service");
const { validate: validateInput } = require("../../validators/auth.validator");
const {
  acquireLock,
  releaseLock,
  set,
  del,
  cacheKeys,
} = require("../../services/redis.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const { ROLE_IDS } = require("../../constants");

const {
  registerUser,
  loginUser,
  requestOTP,
  verifyUserSession,
  loginMfa,
  impersonateUser,
} = require("../../services/auth.service");

// Satisfies the real registerSchema (alphanum username, upper+lower+digit password).
const VALID_REGISTRATION = {
  firstName: "Ada",
  lastName: "Lovelace",
  username: "adalovelace",
  email: "ada@example.com",
  password: "Str0ngPassw0rd",
};

// Mirrors a real Sequelize transaction: commit()/rollback() mark it `finished`,
// which is exactly what stops auth.service's catch block from double-rolling-back.
const makeTransaction = (overrides = {}) => {
  const t = {
    finished: undefined,
    LOCK: { UPDATE: "UPDATE" },
    ...overrides,
  };
  t.commit = jest.fn(async () => {
    t.finished = "commit";
  });
  t.rollback = jest.fn(async () => {
    t.finished = "rollback";
  });
  return t;
};

describe("auth.service (coverage)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    acquireLock.mockResolvedValue("lock-id");
    releaseLock.mockResolvedValue(true);
    set.mockResolvedValue(true);
    del.mockResolvedValue(true);
    hashPassword.mockResolvedValue("hashed");
    generateAccessToken.mockReturnValue("access-token");
    generateOpaqueRefreshToken.mockReturnValue("opaque-refresh");
    createSession.mockResolvedValue({ id: "session-1" });
    queueActivationEmail.mockResolvedValue(true);
    queueOtpEmail.mockResolvedValue(true);
  });

  // ================================================================
  describe("registerUser — validation", () => {
    it("rejects input that fails the real registerSchema before taking a lock", async () => {
      const err = await registerUser({
        firstName: "A", // min 2
        username: "no",
        email: "not-an-email",
        password: "weak",
      }).catch((e) => e);

      expect(err.status).toBe(400);
      expect(err.message).toBe("Validation failed");
      // details come from the real formatErrors(error.details)
      expect(err.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "firstName" }),
        ]),
      );
      expect(acquireLock).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("rejects a password without the required character mix", async () => {
      const err = await registerUser({
        ...VALID_REGISTRATION,
        password: "alllowercase",
      }).catch((e) => e);

      expect(err.status).toBe(400);
      expect(err.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "password",
            message: "Password must contain uppercase, lowercase, and number",
          }),
        ]),
      );
    });
  });

  // ================================================================
  describe("registerUser — locking", () => {
    it("returns 429 when the registration lock is already held", async () => {
      acquireLock.mockResolvedValue(null);

      const err = await registerUser(VALID_REGISTRATION).catch((e) => e);

      expect(err.status).toBe(429);
      expect(err.message).toBe("Registration in progress. Please wait and try again.");
      expect(acquireLock).toHaveBeenCalledWith(
        "register:ada@example.com:adalovelace",
        10000,
      );
      // no lockId → nothing to release, and no transaction was ever opened
      expect(releaseLock).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("releases the lock even when registration fails", async () => {
      const transaction = makeTransaction();
      db.transaction.mockResolvedValue(transaction);
      Users.findOne.mockResolvedValue({ id: "existing" });

      await registerUser(VALID_REGISTRATION).catch(() => {});

      expect(releaseLock).toHaveBeenCalledWith(
        "register:ada@example.com:adalovelace",
        "lock-id",
      );
    });

    it("swallows a releaseLock failure rather than masking the result", async () => {
      const transaction = makeTransaction();
      db.transaction.mockResolvedValue(transaction);
      Users.findOne.mockResolvedValue(null);
      Users.create.mockResolvedValue({ id: "user-1" });
      releaseLock.mockRejectedValue(new Error("redis down"));

      const result = await registerUser(VALID_REGISTRATION, "https://app.test");

      expect(result).toEqual({
        success: true,
        status: 201,
        message: "Registration successful",
      });
    });
  });

  // ================================================================
  describe("registerUser — duplicates", () => {
    it("rejects a duplicate email and rolls the transaction back", async () => {
      const transaction = makeTransaction();
      db.transaction.mockResolvedValue(transaction);
      Users.findOne.mockResolvedValue({ id: "existing", email: "ada@example.com" });

      const err = await registerUser(VALID_REGISTRATION).catch((e) => e);

      expect(err.status).toBe(409);
      expect(err.message).toBe("Email already registered");
      expect(transaction.rollback).toHaveBeenCalledTimes(1);
      expect(Users.create).not.toHaveBeenCalled();
      expect(Users.findOne).toHaveBeenNthCalledWith(1, {
        where: { email: "ada@example.com" },
        transaction,
        lock: "UPDATE",
      });
    });

    it("rejects a duplicate username and rolls the transaction back", async () => {
      const transaction = makeTransaction();
      db.transaction.mockResolvedValue(transaction);
      Users.findOne
        .mockResolvedValueOnce(null) // email is free
        .mockResolvedValueOnce({ id: "existing", username: "adalovelace" });

      const err = await registerUser(VALID_REGISTRATION).catch((e) => e);

      expect(err.status).toBe(409);
      expect(err.message).toBe("Username already used");
      expect(transaction.rollback).toHaveBeenCalledTimes(1);
      expect(Users.create).not.toHaveBeenCalled();
      expect(Users.findOne).toHaveBeenNthCalledWith(2, {
        where: { username: "adalovelace" },
        transaction,
        lock: "UPDATE",
      });
    });
  });

  // ================================================================
  describe("registerUser — success path", () => {
    it("creates the user, caches the lookups and issues an activation token", async () => {
      const transaction = makeTransaction();
      db.transaction.mockResolvedValue(transaction);
      Users.findOne.mockResolvedValue(null);
      Users.create.mockResolvedValue({ id: "user-1" });

      const result = await registerUser(VALID_REGISTRATION, "https://app.test");

      expect(result).toEqual({
        success: true,
        status: 201,
        message: "Registration successful",
      });
      expect(Users.create).toHaveBeenCalledWith(
        {
          firstName: "Ada",
          lastName: "Lovelace",
          username: "adalovelace",
          email: "ada@example.com",
          password: "hashed",
          roleId: ROLE_IDS.USER,
          isEmailVerified: false,
        },
        { transaction },
      );
      expect(transaction.commit).toHaveBeenCalledTimes(1);
      expect(transaction.rollback).not.toHaveBeenCalled();
      expect(set).toHaveBeenCalledWith(
        cacheKeys.userByEmail("ada@example.com"),
        "user-1",
        86400,
      );
      expect(set).toHaveBeenCalledWith(
        cacheKeys.userByUsername("adalovelace"),
        "user-1",
        86400,
      );
      expect(generateAccessToken).toHaveBeenCalledWith({ id: "user-1" });
      expect(logger.info).toHaveBeenCalledWith("User registered", {
        userId: "user-1",
        email: "ada@example.com",
      });
    });

    it("still registers when no origin is supplied", async () => {
      const transaction = makeTransaction();
      db.transaction.mockResolvedValue(transaction);
      Users.findOne.mockResolvedValue(null);
      Users.create.mockResolvedValue({ id: "user-1" });

      const result = await registerUser(VALID_REGISTRATION);

      expect(result.status).toBe(201);
      expect(transaction.commit).toHaveBeenCalled();
    });

    it("does not fail registration when queueing the activation email throws", async () => {
      const transaction = makeTransaction();
      db.transaction.mockResolvedValue(transaction);
      Users.findOne.mockResolvedValue(null);
      Users.create.mockResolvedValue({ id: "user-1" });
      // NOTE: the real queueActivationEmail is `async`, so it can only ever
      // reject — never throw synchronously. This exercises auth.service's own
      // guard; the args it passes are deliberately NOT asserted here (see the
      // reported signature-mismatch defect at auth.service.js:126).
      queueActivationEmail.mockImplementation(() => {
        throw new Error("rabbitmq unreachable");
      });

      const result = await registerUser(VALID_REGISTRATION, "https://app.test");

      expect(result.status).toBe(201);
      expect(transaction.commit).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith("queueActivationEmail failed", {
        err: "rabbitmq unreachable",
      });
    });
  });

  // ================================================================
  describe("registerUser — rollback on failure", () => {
    it("rolls back an unfinished transaction and rethrows the original error", async () => {
      const transaction = makeTransaction({ finished: undefined });
      db.transaction.mockResolvedValue(transaction);
      Users.findOne.mockResolvedValue(null);
      Users.create.mockRejectedValue(new Error("insert failed"));

      const err = await registerUser(VALID_REGISTRATION).catch((e) => e);

      expect(err.message).toBe("insert failed");
      expect(transaction.rollback).toHaveBeenCalledTimes(1);
      expect(transaction.commit).not.toHaveBeenCalled();
    });

    it("does not roll back once the transaction has already committed", async () => {
      const transaction = makeTransaction();
      db.transaction.mockResolvedValue(transaction);
      Users.findOne.mockResolvedValue(null);
      Users.create.mockResolvedValue({ id: "user-1" });
      set.mockRejectedValue(new Error("redis write failed")); // fails after commit

      const err = await registerUser(VALID_REGISTRATION).catch((e) => e);

      expect(err.message).toBe("redis write failed");
      expect(transaction.commit).toHaveBeenCalled();
      expect(transaction.finished).toBe("commit");
      expect(transaction.rollback).not.toHaveBeenCalled();
    });

    it("rethrows when opening the transaction itself fails", async () => {
      db.transaction.mockRejectedValue(new Error("no connection"));

      const err = await registerUser(VALID_REGISTRATION).catch((e) => e);

      expect(err.message).toBe("no connection");
      expect(releaseLock).toHaveBeenCalled();
    });
  });

  // ================================================================
  describe("loginUser — identifier resolution", () => {
    const activeUser = (overrides = {}) => ({
      id: "user-1",
      username: "adalovelace",
      email: "ada@example.com",
      password: "hashed",
      isActive: true,
      tenantId: "tenant-1",
      failedLoginAttempts: 0,
      lockedUntil: null,
      role: null,
      update: jest.fn().mockResolvedValue({}),
      ...overrides,
    });

    it("looks the user up by either username or email", async () => {
      const user = activeUser();
      Users.findOne.mockResolvedValue(user);
      comparePassword.mockResolvedValue(true);

      const result = await loginUser({
        user: "ada@example.com",
        password: "Str0ngPassw0rd",
      });

      expect(result.status).toBe(200);
      const where = Users.findOne.mock.calls[0][0].where;
      const orClauses = where[Object.getOwnPropertySymbols(where)[0]];
      expect(orClauses).toEqual([
        { username: "ada@example.com" },
        { email: "ada@example.com" },
      ]);
    });

    it("throws 401 when the resolved identifier is not a string", async () => {
      // Defensive guard: the real loginSchema requires one of user/username/email
      // and types them all as strings, so this state is unreachable through it.
      // `validate` is overridden for this single call to exercise the guard.
      validateInput.mockReturnValueOnce({
        error: null,
        value: { password: "Str0ngPassw0rd" },
      });

      const err = await loginUser({ password: "Str0ngPassw0rd" }).catch((e) => e);

      expect(err.status).toBe(401);
      expect(err.message).toBe("Invalid credentials");
      expect(Users.findOne).not.toHaveBeenCalled();
    });

    it("throws 401 when no user matches", async () => {
      Users.findOne.mockResolvedValue(null);

      const err = await loginUser({
        username: "ghost",
        password: "Str0ngPassw0rd",
      }).catch((e) => e);

      expect(err.status).toBe(401);
      expect(err.message).toBe("Invalid credentials");
      expect(comparePassword).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  describe("loginUser — lockout", () => {
    const lockableUser = (overrides = {}) => ({
      id: "user-1",
      username: "adalovelace",
      email: "ada@example.com",
      password: "hashed",
      isActive: true,
      tenantId: "tenant-1",
      failedLoginAttempts: 0,
      lockedUntil: null,
      role: null,
      update: jest.fn().mockResolvedValue({}),
      ...overrides,
    });

    it("throws 423 while the account is still locked", async () => {
      const user = lockableUser({
        lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
      });
      Users.findOne.mockResolvedValue(user);

      const err = await loginUser({
        username: "adalovelace",
        password: "Str0ngPassw0rd",
      }).catch((e) => e);

      expect(err.status).toBe(423);
      expect(err.message).toBe("Account temporarily locked");
      expect(comparePassword).not.toHaveBeenCalled();
    });

    it("allows login once the lock has expired", async () => {
      const user = lockableUser({
        lockedUntil: new Date(Date.now() - 1000),
        failedLoginAttempts: 2,
      });
      Users.findOne.mockResolvedValue(user);
      comparePassword.mockResolvedValue(true);

      const result = await loginUser({
        username: "adalovelace",
        password: "Str0ngPassw0rd",
      });

      expect(result.status).toBe(200);
      expect(user.update).toHaveBeenCalledWith({
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
    });

    it("locks the account for 15 minutes on the fifth failed attempt", async () => {
      const user = lockableUser({ failedLoginAttempts: 4 });
      Users.findOne.mockResolvedValue(user);
      comparePassword.mockResolvedValue(false);
      const nowSpy = jest
        .spyOn(Date, "now")
        .mockReturnValue(new Date("2026-01-01T00:00:00Z").getTime());

      try {
        const err = await loginUser({
          username: "adalovelace",
          password: "wrong",
        }).catch((e) => e);

        expect(err.status).toBe(423);
        expect(err.message).toBe("Account locked due to too many failed attempts");
        expect(user.update).toHaveBeenNthCalledWith(1, { failedLoginAttempts: 5 });
        expect(user.update).toHaveBeenNthCalledWith(2, {
          lockedUntil: new Date("2026-01-01T00:15:00Z"),
        });
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("counts a first failed attempt from a null attempt counter", async () => {
      const user = lockableUser({ failedLoginAttempts: null });
      Users.findOne.mockResolvedValue(user);
      comparePassword.mockResolvedValue(false);

      const err = await loginUser({
        username: "adalovelace",
        password: "wrong",
      }).catch((e) => e);

      expect(err.status).toBe(401);
      expect(user.update).toHaveBeenCalledWith({ failedLoginAttempts: 1 });
      expect(user.update).toHaveBeenCalledTimes(1); // not locked yet
    });
  });

  // ================================================================
  describe("loginUser — success shape", () => {
    it("returns MFA-required (202) with a short-lived token and no refresh token", async () => {
      const user = {
        id: "user-1",
        username: "adalovelace",
        email: "ada@example.com",
        password: "hashed",
        isActive: true,
        tenantId: "tenant-1",
        failedLoginAttempts: 0,
        lockedUntil: null,
        mfaEnabled: true,
        role: null,
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findOne.mockResolvedValue(user);
      comparePassword.mockResolvedValue(true);
      generateAccessToken
        .mockReturnValueOnce("access-token")
        .mockReturnValueOnce("mfa-token");

      const result = await loginUser({
        username: "adalovelace",
        password: "Str0ngPassw0rd",
      });

      expect(result).toEqual({
        success: true,
        status: 202,
        message: "MFA required",
        data: {
          id: "user-1",
          username: "adalovelace",
          email: "ada@example.com",
          mfaRequired: true,
        },
        token: "mfa-token",
        refreshToken: null,
      });
      expect(generateAccessToken).toHaveBeenNthCalledWith(
        2,
        { id: "user-1", email: "ada@example.com", mfaRequired: true },
        { expiresIn: "5m" },
      );
      // a session is still created before the second factor is checked
      expect(createSession).toHaveBeenCalled();
    });

    it("defaults ip/userAgent to empty strings and maps the role association", async () => {
      const user = {
        id: "user-1",
        username: "adalovelace",
        email: "ada@example.com",
        password: "hashed",
        isActive: true,
        tenantId: "tenant-1",
        roleId: "role-1",
        failedLoginAttempts: 0,
        lockedUntil: null,
        role: { id: "role-1", name: "USER", description: "ignored" },
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findOne.mockResolvedValue(user);
      comparePassword.mockResolvedValue(true);

      const result = await loginUser({
        username: "adalovelace",
        password: "Str0ngPassw0rd",
      });

      expect(result.data.role).toEqual({ id: "role-1", name: "USER" });
      expect(result.data.mfaEnabled).toBe(false);
      expect(result.refreshToken).toBe("opaque-refresh");
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({ ipAddress: "", userAgent: "" }),
      );
    });

    it("returns a null role when the association is not loaded", async () => {
      const user = {
        id: "user-1",
        username: "adalovelace",
        email: "ada@example.com",
        password: "hashed",
        isActive: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        role: null,
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findOne.mockResolvedValue(user);
      comparePassword.mockResolvedValue(true);

      const result = await loginUser({
        username: "adalovelace",
        password: "Str0ngPassw0rd",
        ip: "10.0.0.1",
        userAgent: "jest",
      });

      expect(result.data.role).toBeNull();
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({ ipAddress: "10.0.0.1", userAgent: "jest" }),
      );
    });
  });

  // ================================================================
  describe("requestOTP", () => {
    const otpUser = (overrides = {}) => ({
      id: "user-1",
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      otpRequestCount: 2,
      update: jest.fn().mockResolvedValue({}),
      ...overrides,
    });

    it("increments the OTP request counter and stores a hashed code", async () => {
      const user = otpUser();
      Users.findOne.mockResolvedValue(user);

      const result = await requestOTP({ email: "ada@example.com" });

      expect(result).toEqual({ success: true, status: 200, message: "OTP sent" });
      const patch = user.update.mock.calls[0][0];
      expect(patch.otpRequestCount).toBe(3);
      // the raw OTP must never be persisted — only its sha256 digest
      expect(patch.otpCode).toMatch(/^[a-f0-9]{64}$/);
      expect(patch.otpExpiredAt).toBeInstanceOf(Date);
      expect(patch.otpLastRequestedAt).toBeInstanceOf(Date);
    });

    it("starts the OTP counter at 1 when it has never been set", async () => {
      const user = otpUser({ otpRequestCount: null });
      Users.findOne.mockResolvedValue(user);

      await requestOTP({ email: "ada@example.com" });

      expect(user.update.mock.calls[0][0].otpRequestCount).toBe(1);
    });

    it("does not leak account existence when the email is unknown", async () => {
      Users.findOne.mockResolvedValue(null);

      const result = await requestOTP({ email: "nobody@example.com" });

      expect(result).toEqual({
        success: true,
        status: 200,
        message: "If the account exists, OTP has been sent",
      });
      expect(queueOtpEmail).not.toHaveBeenCalled();
    });

    it("rejects an email that fails the real forgotPasswordSchema", async () => {
      const err = await requestOTP({ email: "nope" }).catch((e) => e);

      expect(err.status).toBe(400);
      expect(err.message).toBe("Validation failed");
      expect(Users.findOne).not.toHaveBeenCalled();
    });

    it("still reports success when queueing the OTP email throws", async () => {
      const user = otpUser();
      Users.findOne.mockResolvedValue(user);
      // As with the activation email, the real queueOtpEmail is `async` and can
      // only reject. This exercises auth.service's guard; the args are NOT
      // asserted (see the reported signature-mismatch defect at
      // auth.service.js:332).
      queueOtpEmail.mockImplementation(() => {
        throw new Error("queue offline");
      });

      const result = await requestOTP({ email: "ada@example.com" });

      expect(result).toEqual({ success: true, status: 200, message: "OTP sent" });
      expect(user.update).toHaveBeenCalled(); // the OTP was still persisted
      expect(logger.warn).toHaveBeenCalledWith("queueOtpEmail failed", {
        err: "queue offline",
      });
    });
  });

  // ================================================================
  describe("verifyUserSession", () => {
    it("returns a null role when the association is not loaded", async () => {
      Users.findByPk.mockResolvedValue({
        id: "user-1",
        username: "adalovelace",
        email: "ada@example.com",
        isActive: true,
        roleId: "role-1",
        tenantId: "tenant-1",
        role: null,
      });

      const result = await verifyUserSession("user-1");

      expect(result.status).toBe(200);
      expect(result.message).toBe("Token valid");
      expect(result.data.role).toBeNull();
      expect(result.data.tenantId).toBe("tenant-1");
    });
  });

  // ================================================================
  describe("loginMfa", () => {
    it("defaults ip/userAgent to empty strings when the caller omits them", async () => {
      const user = {
        id: "user-1",
        username: "adalovelace",
        email: "ada@example.com",
        tenantId: "tenant-1",
        roleId: "role-1",
        mfaEnabled: true,
        mfaSecret: "secret",
        role: { id: "role-1", name: "USER" },
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValue(user);

      const result = await loginMfa("user-1", "123456");

      expect(result.status).toBe(200);
      expect(result.data.mfaEnabled).toBe(true);
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          tenantId: "tenant-1",
          ipAddress: "",
          userAgent: "",
        }),
      );
      expect(user.update).toHaveBeenCalledWith({ lastLoginAt: expect.any(Date) });
    });

    it("returns a null role when the association is not loaded", async () => {
      Users.findByPk.mockResolvedValue({
        id: "user-1",
        username: "adalovelace",
        email: "ada@example.com",
        mfaEnabled: true,
        mfaSecret: "secret",
        role: null,
        update: jest.fn().mockResolvedValue({}),
      });

      const result = await loginMfa("user-1", "123456", "10.0.0.1", "jest");

      expect(result.data.role).toBeNull();
    });
  });

  // ================================================================
  describe("impersonateUser", () => {
    it("returns a null role when the target user has no role loaded", async () => {
      const superAdmin = {
        id: "sa-1",
        email: "root@example.com",
        role: { id: "r0", name: "SUPER_ADMIN" },
      };
      const targetUser = {
        id: "user-2",
        username: "target",
        email: "target@example.com",
        tenantId: "tenant-1",
        roleId: "role-1",
        role: null,
      };
      Users.findByPk.mockResolvedValue(superAdmin);
      Users.findOne.mockResolvedValue(targetUser);

      const result = await impersonateUser("sa-1", "tenant-1", "user-2");

      expect(result.status).toBe(200);
      expect(result.data.role).toBeNull();
      expect(result.data.isImpersonating).toBe(true);
      expect(generateAccessToken).toHaveBeenCalledWith({
        id: "user-2",
        email: "target@example.com",
        impersonatorId: "sa-1",
      });
      // impersonated sessions are attributed back to the super admin
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-2",
          ipAddress: "",
          userAgent: " (Impersonated by root@example.com)",
        }),
      );
    });
  });
});
