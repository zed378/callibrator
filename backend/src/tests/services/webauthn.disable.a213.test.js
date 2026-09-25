/**
 * A-213 — removing a passkey needs fresh re-authentication and is audited
 * in its transaction.
 *
 * Before: `POST /webauthn/disable` cleared the credential for whoever held
 * the session — no password, no second factor — and wrote no audit row.
 *
 * Now (the A-114 rule, auth.service#reauthenticate): the current password,
 * and on an MFA account a current TOTP code or a recovery code, spent in the
 * same transaction as the change and its audit row (UPDATE on User,
 * `changes.operation` WEBAUTHN_DISABLE). A wrong password or code is one
 * combined 400; nothing enrolled is a 409; another tenant's user is a 404.
 *
 * What is real: webauthn.service#disable, auth.service#reauthenticate and
 * #auditCredentialChange, audit.service#logAction with the audit schema
 * enforced by the auditLedger fixture. Faked: the user row (its update()
 * writes into the ledger), bcrypt and the TOTP/recovery-code checks.
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

jest.mock("../../services/redis.service", () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn() }));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(async (plain, hash) => plain === "Right-password-1" && hash === "hash"),
}));

// The spend is faked here; that a code is accepted once is mfa.service's
// contract (mfa.realOtplib.a99, A-115). The ledger records the spend so a
// rolled-back removal can be seen not to burn it.
jest.mock("../../services/mfa.service", () => ({
  consumeCode: jest.fn(async (user, code, options) => {
    if (code !== "123456") {
      return false;
    }
    mockRef.ledger.write("mfa_spend", { code }, options);
    return true;
  }),
  consumeRecoveryCode: jest.fn(async (user, code, options) => {
    if (code !== "RECOVERYCODE0001") {
      return false;
    }
    mockRef.ledger.write("mfa_spend", { recovery: code }, options);
    return true;
  }),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { Users } = require("../../models");
const webauthn = require("../../services/webauthn.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";

const userRow = (overrides = {}) => ({
  id: USER_ID,
  tenantId: TENANT_ID,
  password: "hash",
  mfaEnabled: false,
  webauthnEnabled: true,
  webauthnCredentialId: "cred-1",
  webauthnPublicKey: "pk",
  webauthnSignCount: 7,
  update: jest.fn(async (values, options) => mockRef.ledger.write("users", values, options)),
  ...overrides,
});

let account;

beforeEach(() => {
  jest.clearAllMocks();
  mockRef.ledger = createLedger();
  account = userRow();
  // The row exists only in its own tenant.
  Users.findOne.mockImplementation(async ({ where }) =>
    where.id === account.id && where.tenantId === account.tenantId ? account : null,
  );
});

const cleared = () =>
  mockRef.ledger.committed("users").filter((row) => row.webauthnEnabled === false && row.webauthnCredentialId === null);
const auditRows = () => mockRef.ledger.auditRows();
const context = { ipAddress: "198.51.100.4", userAgent: "ua" };

describe("A-213: removing a passkey re-authenticates", () => {
  it("with the session alone (no password) it is a 400 and nothing changes", async () => {
    await expect(webauthn.disable(TENANT_ID, USER_ID, {}, context)).rejects.toMatchObject({
      status: 400,
      message: "Removing a passkey requires your current password",
    });
    // The old call shape — the session and nothing else.
    await expect(webauthn.disable(TENANT_ID, USER_ID)).rejects.toMatchObject({ status: 400 });

    expect(cleared()).toEqual([]);
    expect(auditRows()).toEqual([]);
  });

  it("a wrong password is a 400 and nothing changes", async () => {
    await expect(
      webauthn.disable(TENANT_ID, USER_ID, { currentPassword: "Wrong-password-1" }, context),
    ).rejects.toMatchObject({ status: 400, message: "Current password is incorrect" });

    expect(cleared()).toEqual([]);
    expect(auditRows()).toEqual([]);
  });

  it("the right password removes it, and the audit row commits with the change", async () => {
    const result = await webauthn.disable(TENANT_ID, USER_ID, { currentPassword: "Right-password-1" }, context);

    expect(result).toEqual({ success: true });
    expect(cleared()).toEqual([
      { webauthnEnabled: false, webauthnCredentialId: null, webauthnPublicKey: null, webauthnSignCount: 0 },
    ]);
    const [row] = auditRows();
    expect(auditRows()).toHaveLength(1);
    expect(row).toMatchObject({
      tenantId: TENANT_ID,
      userId: USER_ID,
      action: "UPDATE",
      resourceType: "User",
      resourceId: USER_ID,
      changes: { operation: "WEBAUTHN_DISABLE", reauthenticatedWith: "password" },
      ipAddress: "198.51.100.4",
      userAgent: "ua",
    });
    // Never the credential or its key.
    expect(JSON.stringify(row)).not.toMatch(/cred-1|"pk"/);
  });

  describe("on an account with MFA", () => {
    beforeEach(() => {
      account = userRow({ mfaEnabled: true, mfaSecret: "S" });
    });

    it("the password alone is a 400 naming what else is needed", async () => {
      await expect(
        webauthn.disable(TENANT_ID, USER_ID, { currentPassword: "Right-password-1" }, context),
      ).rejects.toMatchObject({
        status: 400,
        message: "Removing a passkey requires your current password and a current MFA or recovery code",
      });
      expect(cleared()).toEqual([]);
    });

    it("a wrong code is the same combined 400 as a wrong password", async () => {
      const wrongCode = await webauthn
        .disable(TENANT_ID, USER_ID, { currentPassword: "Right-password-1", code: "000000" }, context)
        .catch((e) => e);
      const wrongPassword = await webauthn
        .disable(TENANT_ID, USER_ID, { currentPassword: "Wrong-password-1", code: "123456" }, context)
        .catch((e) => e);

      expect(wrongCode).toMatchObject({ status: 400, message: "Current password or MFA code is incorrect" });
      expect(wrongPassword).toMatchObject({ status: wrongCode.status, message: wrongCode.message });
      expect(cleared()).toEqual([]);
      // The wrong password was refused before the code could be spent.
      expect(mockRef.ledger.committed("mfa_spend")).toEqual([]);
    });

    it("password + current code removes it; the code is spent in the same transaction", async () => {
      await webauthn.disable(TENANT_ID, USER_ID, { currentPassword: "Right-password-1", code: "123456" }, context);

      expect(cleared()).toHaveLength(1);
      expect(mockRef.ledger.committed("mfa_spend")).toEqual([{ code: "123456" }]);
      expect(auditRows()[0].changes).toEqual({ operation: "WEBAUTHN_DISABLE", reauthenticatedWith: "password+totp" });
    });

    it("a wrong recovery code is the same combined 400, and nothing changes", async () => {
      await expect(
        webauthn.disable(TENANT_ID, USER_ID, { currentPassword: "Right-password-1", recoveryCode: "NOTACODE" }, context),
      ).rejects.toMatchObject({ status: 400, message: "Current password or MFA code is incorrect" });
      expect(cleared()).toEqual([]);
    });

    it("password + a recovery code removes it too", async () => {
      await webauthn.disable(
        TENANT_ID,
        USER_ID,
        { currentPassword: "Right-password-1", recoveryCode: "RECOVERYCODE0001" },
        context,
      );

      expect(auditRows()[0].changes.reauthenticatedWith).toBe("password+recovery_code");
    });

    it("if the audit row cannot be written, nothing changes and the code is not burnt", async () => {
      mockRef.ledger.failNext("audit_logs");

      await expect(
        webauthn.disable(TENANT_ID, USER_ID, { currentPassword: "Right-password-1", code: "123456" }, context),
      ).rejects.toThrow();

      expect(cleared()).toEqual([]);
      expect(mockRef.ledger.committed("mfa_spend")).toEqual([]);
      expect(auditRows()).toEqual([]);
    });
  });

  it("with no passkey enrolled it is a 409 that says so, before any re-authentication", async () => {
    account = userRow({ webauthnEnabled: false, webauthnCredentialId: null });

    await expect(webauthn.disable(TENANT_ID, USER_ID, {}, context)).rejects.toMatchObject({
      status: 409,
      message: "No passkey is enrolled on this account, so there is nothing to remove",
    });
  });

  it("a user of another tenant is a 404, not a 403", async () => {
    await expect(
      webauthn.disable(OTHER_TENANT, USER_ID, { currentPassword: "Right-password-1" }, context),
    ).rejects.toMatchObject({ status: 404 });
    expect(cleared()).toEqual([]);
  });
});
