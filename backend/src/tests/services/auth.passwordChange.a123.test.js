/**
 * A-123 / A-98 (F-12) / ADR-051 Q-11 — changing and resetting a password.
 *
 *  - justUpdatePassword (the change-password route) clears
 *    `mustChangePassword`, refuses "changing" to the same password (which
 *    would clear the flag while the administrator still knows it), and writes
 *    an audit row (UPDATE on User, `changes.operation` PASSWORD_CHANGE) inside
 *    the transaction that writes the new hash and revokes the sessions.
 *  - processResetPassword (the e-mail-code reset) marks the address verified
 *    (Q-11), clears the flag, and is audited as PASSWORD_RESET.
 *  - "who am I" (verifyUserSession) and both sign-in steps tell the frontend
 *    about the flag.
 *
 * Fail-before: justUpdatePassword wrote no audit row and left the flag alone;
 * processResetPassword never set isEmailVerified; verifyUserSession and
 * loginUser returned no mustChangePassword.
 *
 * What is faked: the models, the transaction (a double whose callback runs
 * with a recognisable tx object), the password hash, the audit insert and
 * the session revocation.
 */

const mockTx = { id: "tx-a123" };

jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (fn) => fn(mockTx)) },
}));

jest.mock("../../models", () => ({
  Users: { findOne: jest.fn(), findByPk: jest.fn(), update: jest.fn() },
  User: {},
  Role: {},
  Roles: {},
  Tenants: { name: "Tenants" },
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(async (plain) => `hash:${plain}`),
  comparePassword: jest.fn(async (plain, hash) => hash === `hash:${plain}`),
}));

jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

jest.mock("../../services/session.service", () => ({
  createSession: jest.fn(async () => ({ id: "session-1" })),
  revokeAllSessions: jest.fn(async () => [1]),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const crypto = require("crypto");
const { db } = require("../../config");
const { Users } = require("../../models");
const auditService = require("../../services/audit.service");
const { revokeAllSessions } = require("../../services/session.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const authService = require("../../services/auth.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_SET = "Adm1n-Chosen!";
const MINE = "My-0wn-Passw0rd";

const makeUser = (overrides = {}) => {
  const row = {
    id: USER_ID,
    tenantId: TENANT_ID,
    tenant: { id: TENANT_ID, status: "active" },
    username: "ada",
    email: "ada@hospital.example.com",
    password: `hash:${ADMIN_SET}`,
    isActive: true,
    status: "ACTIVE",
    isEmailVerified: false,
    mustChangePassword: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    mfaEnabled: false,
    role: { id: "r1", name: "TECHNICIAN", roleLevel: 5 },
    ...overrides,
  };
  row.update = jest.fn(async (patch) => Object.assign(row, patch));
  return row;
};

beforeEach(() => {
  jest.clearAllMocks();
  auditService.logAction.mockResolvedValue({ id: "audit-1" });
});

describe("A-123 / A-98: justUpdatePassword", () => {
  it("clears the forced-change flag and writes a PASSWORD_CHANGE audit row inside the transaction", async () => {
    const user = makeUser();
    Users.findByPk.mockResolvedValue(user);

    const result = await authService.justUpdatePassword(USER_ID, MINE, ADMIN_SET, {
      ipAddress: "203.0.113.9",
      userAgent: "jest",
    });

    expect(result.status).toBe(200);
    expect(user.mustChangePassword).toBe(false);
    expect(user.password).toBe(`hash:${MINE}`);
    expect(user.update).toHaveBeenCalledWith(
      {
        password: `hash:${MINE}`,
        passwordChangedAt: expect.any(Date),
        mustChangePassword: false,
        // A-215: the holder's own password carries no expiry.
        temporaryPasswordExpiresAt: null,
      },
      { transaction: mockTx },
    );
    expect(revokeAllSessions).toHaveBeenCalledWith(USER_ID, "PASSWORD_CHANGED");
    expect(auditService.logAction).toHaveBeenCalledWith(
      {
        tenantId: TENANT_ID,
        userId: USER_ID,
        action: "UPDATE",
        resourceType: "User",
        resourceId: USER_ID,
        changes: { operation: "PASSWORD_CHANGE", forced: true },
        ipAddress: "203.0.113.9",
        userAgent: "jest",
      },
      { transaction: mockTx },
    );
    // Never a password or a hash in the permanent trail.
    expect(JSON.stringify(auditService.logAction.mock.calls)).not.toMatch(/hash:|Adm1n|My-0wn/);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it("an ordinary (unforced) change is audited as forced: false; no context audits nulls", async () => {
    Users.findByPk.mockResolvedValue(makeUser({ mustChangePassword: false }));

    await authService.justUpdatePassword(USER_ID, MINE, ADMIN_SET);

    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { operation: "PASSWORD_CHANGE", forced: false },
        ipAddress: null,
        userAgent: null,
      }),
      { transaction: mockTx },
    );
  });

  it("a failed audit insert fails the change (the transaction's error propagates)", async () => {
    Users.findByPk.mockResolvedValue(makeUser());
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(authService.justUpdatePassword(USER_ID, MINE, ADMIN_SET)).rejects.toThrow(
      "audit insert failed",
    );
  });

  it("'changing' to the same password is refused and nothing is written — the flag stays", async () => {
    const user = makeUser();
    Users.findByPk.mockResolvedValue(user);

    await expect(
      authService.justUpdatePassword(USER_ID, ADMIN_SET, ADMIN_SET),
    ).rejects.toMatchObject({
      status: 400,
      message: "The new password must be different from the current one",
    });
    expect(user.update).not.toHaveBeenCalled();
    expect(user.mustChangePassword).toBe(true);
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("a tenant-less account (platform super admin) changes its password, with the missing row logged", async () => {
    const user = makeUser({ tenantId: null, tenant: null });
    Users.findByPk.mockResolvedValue(user);

    await authService.justUpdatePassword(USER_ID, MINE, ADMIN_SET);

    expect(user.mustChangePassword).toBe(false);
    expect(auditService.logAction).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Credential change not audited: the user has no tenant",
      { userId: USER_ID, operation: "PASSWORD_CHANGE" },
    );
  });
});

describe("ADR-051 Q-11 / A-123: processResetPassword (e-mail code)", () => {
  const OTP = "123456";
  const otpHash = crypto.createHash("sha256").update(OTP).digest("hex");

  it("marks the address verified, clears the flag, and is audited as PASSWORD_RESET", async () => {
    const user = makeUser({ otpCode: otpHash, otpExpiredAt: new Date(Date.now() + 60_000) });
    Users.findOne.mockResolvedValue(user);

    await authService.processResetPassword({
      email: user.email,
      otp: OTP,
      password: MINE,
    });

    expect(user.isEmailVerified).toBe(true);
    expect(user.mustChangePassword).toBe(false);
    expect(user.otpCode).toBeNull();
    expect(user.update).toHaveBeenCalledWith(
      expect.objectContaining({ isEmailVerified: true, mustChangePassword: false }),
      { transaction: mockTx },
    );
    expect(revokeAllSessions).toHaveBeenCalledWith(USER_ID, "PASSWORD_RESET");
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        userId: USER_ID,
        action: "UPDATE",
        resourceType: "User",
        resourceId: USER_ID,
        changes: { operation: "PASSWORD_RESET", method: "email_otp" },
      }),
      { transaction: mockTx },
    );
    expect(JSON.stringify(auditService.logAction.mock.calls)).not.toContain(OTP);
  });

  it("a wrong code verifies nothing", async () => {
    const user = makeUser({ otpCode: otpHash, otpExpiredAt: new Date(Date.now() + 60_000) });
    Users.findOne.mockResolvedValue(user);

    await expect(
      authService.processResetPassword({ email: user.email, otp: "654321", password: MINE }),
    ).rejects.toMatchObject({ status: 400 });
    expect(user.isEmailVerified).toBe(false);
    expect(user.mustChangePassword).toBe(true);
  });
});

describe("A-123: the frontend learns about the flag", () => {
  it("'who am I' (verifyUserSession) returns mustChangePassword, mfaEnabled and a recovery-code count", async () => {
    Users.findByPk.mockResolvedValue(
      makeUser({ mfaEnabled: true, mfaRecoveryCodes: ["h1", "h2", "h3"] }),
    );

    const result = await authService.verifyUserSession(USER_ID);

    expect(result.data).toMatchObject({
      mustChangePassword: true,
      mfaEnabled: true,
      mfaRecoveryCodesRemaining: 3,
    });
    // A count, never the hashes.
    expect(JSON.stringify(result)).not.toContain("h1");
  });

  it("an account with no recovery codes reports zero, and an unflagged one false", async () => {
    Users.findByPk.mockResolvedValue(makeUser({ mustChangePassword: false, mfaRecoveryCodes: null }));

    const result = await authService.verifyUserSession(USER_ID);

    expect(result.data).toMatchObject({
      mustChangePassword: false,
      mfaEnabled: false,
      mfaRecoveryCodesRemaining: 0,
    });
  });

  it("a password sign-in of a flagged account says so", async () => {
    Users.findOne.mockResolvedValue(makeUser());

    const result = await authService.loginUser({ user: "ada", password: ADMIN_SET });

    expect(result.status).toBe(200);
    expect(result.data.mustChangePassword).toBe(true);
  });
});
