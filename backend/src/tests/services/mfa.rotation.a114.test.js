/**
 * A-114 — setupMfa replaced the LIVE second factor with no re-authentication.
 *
 * `setupMfa` wrote the new secret straight into `mfaSecret`. On an account
 * with MFA enabled, that replaced the authenticator the moment setup was
 * called — nothing asked for the password or a current code — so anyone
 * holding the session could swap the victim's second factor for their own.
 *
 * Now, on an MFA-enabled account, setup needs the current password AND a
 * current code (409 without them, one combined 400 when either is wrong); the
 * new secret is held PENDING and replaces nothing until a code from it is
 * verified; the promotion is audited in its transaction.
 *
 * A-115 (login level) — a TOTP code is accepted once.
 *
 * Nothing here mocks otplib: codes are generated from the secrets with the
 * real library. The models, the transaction, the password hash comparison,
 * createSession and the audit insert are faked. `Users.update` (consumeCode's
 * conditional stamp) APPLIES its WHERE to the in-memory row.
 */

const mockTx = { id: "tx-a114" };

jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (fn) => fn(mockTx)) },
}));

const mockTable = { row: null };
jest.mock("../../models", () => {
  const { Op } = jest.requireActual("sequelize");
  return {
    Users: {
      findOne: jest.fn(),
      findByPk: jest.fn(async () => mockTable.row),
      update: jest.fn(async (values, { where }) => {
        const row = mockTable.row;
        const last = row.mfaLastUsedStep;
        const step = where[Op.or][1].mfaLastUsedStep[Op.lt];
        if (row.id !== where.id || (last !== null && !(last < step))) {
          return [0];
        }
        Object.assign(row, values);
        return [1];
      }),
    },
    User: {},
    Role: {},
    Tenants: { name: "Tenants" },
    AuditLog: { create: jest.fn() },
  };
});

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(async (plain, hash) => hash === `hash:${plain}`),
}));

jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

jest.mock("../../services/session.service", () => ({
  createSession: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const otplib = require("otplib");
const auditService = require("../../services/audit.service");
const { createSession } = require("../../services/session.service");
const { Users } = require("../../models");
const authService = require("../../services/auth.service");
const mfaService = require("../../services/mfa.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "correct horse battery staple";
// Mid-step (xx:00:15), so ±1 step is unambiguous.
const NOW_S = Date.parse("2026-09-24T10:00:15Z") / 1000;
const LIVE = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

const codeAt = (secret, epoch = NOW_S) => otplib.generateSync({ secret, epoch });
const setNow = (epochSeconds) => jest.spyOn(Date, "now").mockReturnValue(epochSeconds * 1000);

const makeUser = (overrides = {}) => {
  const row = {
    id: USER_ID,
    tenantId: TENANT_ID,
    tenant: { id: TENANT_ID, status: "active" },
    username: "ada",
    email: "ada@hospital.example.com",
    password: `hash:${PASSWORD}`,
    isActive: true,
    status: "ACTIVE",
    lockedUntil: null,
    mfaEnabled: true,
    mfaSecret: LIVE,
    mfaPendingSecret: null,
    mfaPendingCreatedAt: null,
    mfaLastUsedStep: null,
    role: null,
    ...overrides,
  };
  row.update = jest.fn(async (patch) => Object.assign(row, patch));
  mockTable.row = row;
  return row;
};

beforeEach(() => {
  jest.clearAllMocks();
  setNow(NOW_S);
  createSession.mockResolvedValue({ id: "session-a114" });
  auditService.logAction.mockResolvedValue({ id: "audit-1" });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-114 — rotating an enabled second factor needs re-authentication", () => {
  it("setupMfa on an MFA-enabled account without re-authentication is refused", async () => {
    const user = makeUser();

    await expect(authService.setupMfa(USER_ID)).rejects.toMatchObject({
      status: 409,
      message: "MFA is already enabled; disable or rotate with your current code",
    });
    // A password alone, or a code alone, is not enough either.
    await expect(
      authService.setupMfa(USER_ID, { currentPassword: PASSWORD }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      authService.setupMfa(USER_ID, { code: codeAt(LIVE) }),
    ).rejects.toMatchObject({ status: 409 });

    expect(user.update).not.toHaveBeenCalled();
    expect(user.mfaSecret).toBe(LIVE);
    expect(user.mfaPendingSecret).toBeNull();
  });

  it("a wrong password or a wrong current code is one combined 400; nothing is written", async () => {
    const user = makeUser();
    const good = codeAt(LIVE);
    const wrong = String((Number(good) + 1) % 1000000).padStart(6, "0");

    await expect(
      authService.setupMfa(USER_ID, { currentPassword: "guess", code: good }),
    ).rejects.toMatchObject({ status: 400, message: "Current password or MFA code is incorrect" });
    // The wrong password did not burn the code.
    expect(user.mfaLastUsedStep).toBeNull();

    await expect(
      authService.setupMfa(USER_ID, { currentPassword: PASSWORD, code: wrong }),
    ).rejects.toMatchObject({ status: 400, message: "Current password or MFA code is incorrect" });

    expect(user.update).not.toHaveBeenCalled();
    expect(user.mfaSecret).toBe(LIVE);
  });

  it("the live secret is unchanged until the new one is verified", async () => {
    const user = makeUser();

    // Rotation starts, with the current password and a current code.
    const setup = await authService.setupMfa(USER_ID, {
      currentPassword: PASSWORD,
      code: codeAt(LIVE),
    });
    expect(setup.rotation).toBe(true);
    expect(setup.secret).not.toBe(LIVE);
    expect(user.mfaSecret).toBe(LIVE);
    expect(user.mfaPendingSecret).toBe(setup.secret);

    // While pending, the OLD authenticator still signs in, and the new one
    // does not (next step: the rotation consumed this step's code).
    setNow(NOW_S + 30);
    await expect(
      authService.loginMfa(USER_ID, codeAt(setup.secret, NOW_S + 30)),
    ).rejects.toMatchObject({ status: 401 });
    await expect(authService.loginMfa(USER_ID, codeAt(LIVE, NOW_S + 30))).resolves.toMatchObject({
      status: 200,
    });

    // A code from the OLD secret does not complete the rotation.
    setNow(NOW_S + 60);
    await expect(
      authService.verifyMfaSetup(USER_ID, codeAt(LIVE, NOW_S + 60)),
    ).rejects.toMatchObject({ status: 400, message: "Invalid MFA code" });
    expect(user.mfaSecret).toBe(LIVE);
    // (The sign-in above wrote its LOGIN row; no MFA change was recorded.)
    expect(auditService.logAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: "User" }),
      expect.anything(),
    );

    // A code from the NEW secret does — and is audited in the transaction.
    const done = await authService.verifyMfaSetup(USER_ID, codeAt(setup.secret, NOW_S + 60), {
      ipAddress: "203.0.113.9",
      userAgent: "jest",
    });
    expect(done).toEqual({ success: true, message: "MFA authenticator replaced successfully" });
    expect(user.mfaSecret).toBe(setup.secret);
    expect(user.mfaPendingSecret).toBeNull();
    expect(user.update).toHaveBeenLastCalledWith(
      {
        mfaSecret: setup.secret,
        mfaEnabled: true,
        mfaPendingSecret: null,
        mfaPendingCreatedAt: null,
      },
      { transaction: mockTx },
    );
    expect(auditService.logAction).toHaveBeenCalledWith(
      {
        tenantId: TENANT_ID,
        userId: USER_ID,
        action: "UPDATE",
        resourceType: "User",
        resourceId: USER_ID,
        changes: { operation: "MFA_ROTATE" },
        ipAddress: "203.0.113.9",
        userAgent: "jest",
      },
      { transaction: mockTx },
    );
    // Never the secret in the permanent trail.
    expect(JSON.stringify(auditService.logAction.mock.calls)).not.toContain(setup.secret);

    // From now on the OLD authenticator is refused.
    setNow(NOW_S + 90);
    await expect(authService.loginMfa(USER_ID, codeAt(LIVE, NOW_S + 90))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("first enrolment needs no re-authentication, stays pending, and is audited as MFA_ENABLE", async () => {
    const user = makeUser({ mfaEnabled: false, mfaSecret: null });

    const setup = await authService.setupMfa(USER_ID);
    expect(setup.rotation).toBe(false);
    expect(user.mfaSecret).toBeNull();
    expect(user.mfaEnabled).toBe(false);

    await authService.verifyMfaSetup(USER_ID, codeAt(setup.secret));

    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaSecret).toBe(setup.secret);
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "UPDATE", changes: { operation: "MFA_ENABLE" } }),
      { transaction: mockTx },
    );
  });

  it("a failed audit insert fails the promotion (the transaction's error propagates)", async () => {
    makeUser({ mfaEnabled: false, mfaSecret: null });
    const setup = await authService.setupMfa(USER_ID);
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(authService.verifyMfaSetup(USER_ID, codeAt(setup.secret))).rejects.toThrow(
      "audit insert failed",
    );
  });

  it("a pending secret older than the TTL is refused and cleared", async () => {
    const user = makeUser({ mfaEnabled: false, mfaSecret: null });
    const setup = await authService.setupMfa(USER_ID);

    const later = NOW_S + authService.MFA_PENDING_TTL_MS / 1000 + 1;
    setNow(later);
    await expect(
      authService.verifyMfaSetup(USER_ID, codeAt(setup.secret, later)),
    ).rejects.toMatchObject({ status: 400, message: "MFA setup has expired; start it again" });
    expect(user.mfaPendingSecret).toBeNull();
    expect(user.mfaEnabled).toBe(false);
  });

  it("a user with no tenant (platform super admin) is enabled, with the missing audit row logged", async () => {
    const { logger } = require("../../middlewares/activityLog.middleware");
    const user = makeUser({ mfaEnabled: false, mfaSecret: null, tenantId: null });
    const setup = await authService.setupMfa(USER_ID);

    await authService.verifyMfaSetup(USER_ID, codeAt(setup.secret));

    expect(user.mfaEnabled).toBe(true);
    expect(auditService.logAction).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("MFA change not audited: the user has no tenant", {
      userId: USER_ID,
      operation: "MFA_ENABLE",
    });
  });
});

describe("A-114 — edge cases", () => {
  it("a pending secret with no issue time is treated as expired", async () => {
    const user = makeUser({
      mfaEnabled: false,
      mfaSecret: null,
      mfaPendingSecret: LIVE,
      mfaPendingCreatedAt: null,
    });

    await expect(authService.verifyMfaSetup(USER_ID, codeAt(LIVE))).rejects.toMatchObject({
      status: 400,
      message: "MFA setup has expired; start it again",
    });
    expect(user.mfaPendingSecret).toBeNull();
  });

  it("a tenantless ROTATION is logged as MFA_ROTATE", async () => {
    const { logger } = require("../../middlewares/activityLog.middleware");
    makeUser({ tenantId: null });
    const setup = await authService.setupMfa(USER_ID, {
      currentPassword: PASSWORD,
      code: codeAt(LIVE),
    });

    setNow(NOW_S + 30);
    await authService.verifyMfaSetup(USER_ID, codeAt(setup.secret, NOW_S + 30));

    expect(logger.error).toHaveBeenCalledWith("MFA change not audited: the user has no tenant", {
      userId: USER_ID,
      operation: "MFA_ROTATE",
    });
  });
});

describe("A-115 — a TOTP code is accepted once at sign-in", () => {
  it("a TOTP code cannot be used twice to sign in", async () => {
    makeUser();
    const code = codeAt(LIVE);

    await expect(authService.loginMfa(USER_ID, code, "203.0.113.9", "jest")).resolves.toMatchObject({
      status: 200,
    });
    await expect(authService.loginMfa(USER_ID, code, "203.0.113.9", "jest")).rejects.toMatchObject({
      status: 401,
      message: "Invalid MFA code",
    });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(Users.update).toHaveBeenCalledTimes(1);
  });

  it("a code used to sign a record cannot then sign in (verifyLogin consumes it)", async () => {
    const user = makeUser();
    const code = codeAt(LIVE);

    await expect(mfaService.verifyLogin(user, code)).resolves.toBe(true);
    await expect(authService.loginMfa(USER_ID, code)).rejects.toMatchObject({ status: 401 });
  });
});
