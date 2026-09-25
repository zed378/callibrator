/**
 * A-214 — a self-service email rectification needs fresh re-authentication.
 *
 * Before: `PUT /gdpr/rectify {field: "email"}` changed the address for
 * whoever held the session. A stolen session could move the address to the
 * attacker's mailbox, request a password reset there, and own the account.
 *
 * Now (the A-114 rule, auth.service#reauthenticate): the current password,
 * and on an MFA account a current TOTP or recovery code, spent in the same
 * transaction as the change and its audit row. A session that signed in
 * through SSO is a 409 naming the identity provider — its address is the
 * IdP's, and the key SSO matches accounts on. Other fields need nothing more.
 * An administrator acting on ANOTHER user does so through the user routes,
 * whose gates and audit are unchanged (user.audit.a77.test.js).
 *
 * What is real: gdpr.service#rectifyData, auth.service#reauthenticate and
 * #passwordManagedBy, audit.service#logAction with the audit schema enforced
 * by the auditLedger fixture. Faked: the rows, bcrypt and the TOTP check.
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, account: null, settings: [] };

jest.mock("archiver", () => jest.fn());
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

jest.mock("../../models", () => ({
  User: {
    findOne: jest.fn(async ({ where }) =>
      mockRef.account && where.id === mockRef.account.id && where.tenantId === mockRef.account.tenantId
        ? mockRef.account
        : null,
    ),
    update: jest.fn(async (values, options) => {
      mockRef.ledger.write("users", values, options);
      return [1];
    }),
    unscoped: jest.fn(() => ({ findOne: jest.fn(async () => null) })),
  },
  Users: { findOne: jest.fn(), findByPk: jest.fn(), update: jest.fn() },
  TenantSettings: { findAll: jest.fn(async () => mockRef.settings) },
  Role: {},
  Tenants: {},
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
}));

jest.mock("../../services/emailQueue.service", () => ({
  queueActivationEmail: jest.fn(async () => true),
  queueNotificationEmail: jest.fn(async () => true),
  queueOtpEmail: jest.fn(),
}));
jest.mock("../../utils/jwt.util", () => ({ generatePurposeToken: jest.fn(() => "tok") }));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(async (plain, hash) => plain === "Right-password-1" && hash === "hash"),
}));

jest.mock("../../services/mfa.service", () => ({
  consumeCode: jest.fn(async (user, code, options) => {
    if (code !== "123456") {
      return false;
    }
    mockRef.ledger.write("mfa_spend", { code }, options);
    return true;
  }),
  consumeRecoveryCode: jest.fn(async () => false),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const emailQueue = require("../../services/emailQueue.service");
const gdpr = require("../../services/gdpr.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";

const userRow = (overrides = {}) => ({
  id: USER_ID,
  tenantId: TENANT_ID,
  email: "jane@hospital.test",
  firstName: "Jane",
  lastName: "Doe",
  password: "hash",
  mfaEnabled: false,
  mustChangePassword: false,
  ...overrides,
});

const actor = { ipAddress: "198.51.100.3", userAgent: "ua" };
const emailWrites = () => mockRef.ledger.committed("users").filter((row) => row.email);
const auditRows = () => mockRef.ledger.auditRows();

const rectifyEmail = (reauth, tenantId = TENANT_ID) =>
  gdpr.rectifyData(tenantId, USER_ID, "email", "attacker@evil.test", actor, reauth);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GDPR_ENABLED = "true";
  mockRef.ledger = createLedger();
  mockRef.account = userRow();
  mockRef.settings = [];
});

afterAll(() => {
  delete process.env.GDPR_ENABLED;
});

describe("A-214: a stolen session cannot move the address", () => {
  it("with the session alone it is a 400: nothing written, nothing mailed", async () => {
    await expect(rectifyEmail({})).rejects.toMatchObject({
      status: 400,
      message: "Changing your email address requires your current password",
    });
    // The pre-A-214 call shape — no re-authentication argument at all.
    await expect(
      gdpr.rectifyData(TENANT_ID, USER_ID, "email", "attacker@evil.test", actor),
    ).rejects.toMatchObject({ status: 400 });

    expect(emailWrites()).toEqual([]);
    expect(auditRows()).toEqual([]);
    expect(emailQueue.queueActivationEmail).not.toHaveBeenCalled();
    expect(emailQueue.queueNotificationEmail).not.toHaveBeenCalled();
  });

  it("a wrong password is a 400 and changes nothing", async () => {
    await expect(rectifyEmail({ currentPassword: "Wrong-password-1" })).rejects.toMatchObject({
      status: 400,
      message: "Current password is incorrect",
    });
    expect(emailWrites()).toEqual([]);
    expect(emailQueue.queueActivationEmail).not.toHaveBeenCalled();
  });

  it("the right password changes it, audited in the transaction with how the caller proved it", async () => {
    const result = await rectifyEmail({ currentPassword: "Right-password-1" });

    expect(result).toEqual({ rectified: true, field: "email", emailVerificationRequired: true });
    expect(emailWrites()).toEqual([{ email: "attacker@evil.test", isEmailVerified: false }]);
    expect(auditRows()).toHaveLength(1);
    expect(auditRows()[0].changes).toEqual({
      operation: "GDPR_RECTIFICATION",
      fields: ["email"],
      emailVerificationReset: true,
      reauthenticatedWith: "password",
    });
    // The previous address is still told (A-180).
    expect(emailQueue.queueNotificationEmail).toHaveBeenCalled();
  });

  describe("on an account with MFA", () => {
    beforeEach(() => {
      mockRef.account = userRow({ mfaEnabled: true, mfaSecret: "S" });
    });

    it("the password alone is not enough", async () => {
      await expect(rectifyEmail({ currentPassword: "Right-password-1" })).rejects.toMatchObject({
        status: 400,
        message: "Changing your email address requires your current password and a current MFA or recovery code",
      });
      expect(emailWrites()).toEqual([]);
    });

    it("a wrong code is the combined 400", async () => {
      await expect(rectifyEmail({ currentPassword: "Right-password-1", code: "000000" })).rejects.toMatchObject({
        status: 400,
        message: "Current password or MFA code is incorrect",
      });
      expect(emailWrites()).toEqual([]);
    });

    it("password + a current code changes it; the code is spent in the same transaction", async () => {
      await rectifyEmail({ currentPassword: "Right-password-1", code: "123456" });

      expect(emailWrites()).toHaveLength(1);
      expect(mockRef.ledger.committed("mfa_spend")).toEqual([{ code: "123456" }]);
      expect(auditRows()[0].changes.reauthenticatedWith).toBe("password+totp");
    });

    it("if the audit row cannot be written, nothing changes and the code is not burnt", async () => {
      mockRef.ledger.failNext("audit_logs");

      await expect(rectifyEmail({ currentPassword: "Right-password-1", code: "123456" })).rejects.toThrow();

      expect(emailWrites()).toEqual([]);
      expect(mockRef.ledger.committed("mfa_spend")).toEqual([]);
      expect(emailQueue.queueActivationEmail).not.toHaveBeenCalled();
    });
  });

  it("a session that signed in through SSO is a 409 naming the identity provider", async () => {
    mockRef.settings = [{ key: "oidc_authority", value: "https://login.microsoftonline.com/tenant-guid/v2.0" }];

    await expect(
      rectifyEmail({ currentPassword: "Right-password-1", signInMethod: "oidc" }),
    ).rejects.toMatchObject({
      status: 409,
      message:
        "You signed in through your organisation's identity provider (OIDC, login.microsoftonline.com). Your email address is managed there: change it with that provider, not here.",
    });
    expect(emailWrites()).toEqual([]);
  });

  it("with no provider configured, the 409 names the protocol alone", async () => {
    await expect(rectifyEmail({ signInMethod: "saml" })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("identity provider (SAML). Your email address is managed there"),
    });
  });

  it("the caller's own row only: another tenant's id is a 404", async () => {
    await expect(rectifyEmail({ currentPassword: "Right-password-1" }, OTHER_TENANT)).rejects.toMatchObject({
      status: 404,
    });
    expect(emailWrites()).toEqual([]);
  });

  it("the other fields need no re-authentication", async () => {
    const result = await gdpr.rectifyData(TENANT_ID, USER_ID, "firstName", "Janet", actor);

    expect(result).toEqual({ rectified: true, field: "firstName" });
    expect(mockRef.ledger.committed("users")).toEqual([{ firstName: "Janet" }]);
    expect(auditRows()[0].changes).toEqual({ operation: "GDPR_RECTIFICATION", fields: ["firstName"] });
  });
});
