/**
 * A-72 — password and MFA login write a LOGIN audit row, in the transaction
 * that creates the session.
 *
 * Since A-60 an SSO sign-in has written `LOGIN / Session` (sso.controller
 * issueSsoTokens). Password and MFA login wrote nothing, so "who accessed the
 * system, when" existed for SSO users only.
 *
 * What is real: auth.service (loginUser, loginMfa), audit.service.logAction —
 * including its closed AUDIT_ACTIONS check — and the Joi login schema.
 * What is faked: the models (AuditLog.create is the row the database would
 * get), the transaction (a stand-in that records which writes ran inside it),
 * createSession, bcrypt and the TOTP check.
 *
 * What it does not prove: that PostgreSQL commits both rows or neither. The
 * transaction wiring is the same one sso.controller's issueSsoTokens uses (CLS
 * for createSession, `{ transaction }` for logAction).
 */

const mockTx = { id: "tx-1", open: false };

jest.mock("../../config", () => ({
  db: {
    transaction: jest.fn(async (fn) => {
      mockTx.open = true;
      try {
        return await fn(mockTx);
      } finally {
        mockTx.open = false;
      }
    }),
  },
}));

jest.mock("../../models", () => ({
  Users: { findOne: jest.fn(), findByPk: jest.fn() },
  Role: {},
  User: {},
  AuditLog: { create: jest.fn() },
}));

jest.mock("../../services/session.service", () => ({
  createSession: jest.fn(),
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
}));

jest.mock("otplib", () => ({ authenticator: { check: jest.fn() } }));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { Users, AuditLog } = require("../../models");
const { createSession } = require("../../services/session.service");
const { comparePassword } = require("../../utils/password.util");
const { authenticator } = require("otplib");
const { logger } = require("../../middlewares/activityLog.middleware");
const authService = require("../../services/auth.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";

const userRow = (overrides = {}) => ({
  id: USER_ID,
  tenantId: TENANT_ID,
  // A-83: every sign-in point loads the tenant and refuses a suspended one.
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
  update: jest.fn().mockResolvedValue({}),
  ...overrides,
});

/** Every write, tagged with whether it ran inside the transaction. */
let writes;

beforeEach(() => {
  jest.clearAllMocks();
  writes = [];
  createSession.mockImplementation(async (params) => {
    writes.push({ what: "session", inTx: mockTx.open, params });
    return { id: SESSION_ID };
  });
  AuditLog.create.mockImplementation(async (row, options) => {
    writes.push({ what: "audit", inTx: mockTx.open, row, options });
    return { toJSON: () => ({ id: "audit-1", ...row }) };
  });
});

const auditRows = () => writes.filter((w) => w.what === "audit");

describe("A-72: a successful login writes one LOGIN audit row", () => {
  it("a successful password login writes one LOGIN audit row", async () => {
    Users.findOne.mockResolvedValue(userRow());
    comparePassword.mockResolvedValue(true);

    const result = await authService.loginUser({
      user: "ada",
      password: "Right-password-1",
      ip: "203.0.113.5",
      userAgent: "jest-agent",
    });

    expect(result.status).toBe(200);
    expect(auditRows()).toHaveLength(1);
    const [audit] = auditRows();
    expect(audit.row).toEqual({
      tenantId: TENANT_ID,
      userId: USER_ID,
      action: "LOGIN",
      resourceType: "Session",
      resourceId: SESSION_ID,
      changes: { method: "password" },
      ipAddress: "203.0.113.5",
      userAgent: "jest-agent",
    });
    // Inside the SAME transaction as the session, after it.
    expect(audit.options).toEqual({ transaction: mockTx });
    expect(writes.map((w) => [w.what, w.inTx])).toEqual([
      ["session", true],
      ["audit", true],
    ]);
  });

  it("an MFA login writes one LOGIN audit row", async () => {
    Users.findByPk.mockResolvedValue(
      userRow({ mfaEnabled: true, mfaSecret: "BASE32SECRET" }),
    );
    authenticator.check.mockReturnValue(true);

    const result = await authService.loginMfa(USER_ID, "123456", "203.0.113.6", "jest-agent");

    expect(result.status).toBe(200);
    expect(auditRows()).toHaveLength(1);
    const [audit] = auditRows();
    expect(audit.row).toMatchObject({
      tenantId: TENANT_ID,
      userId: USER_ID,
      action: "LOGIN",
      resourceType: "Session",
      resourceId: SESSION_ID,
      changes: { method: "password+totp" },
      ipAddress: "203.0.113.6",
    });
    expect(audit.options).toEqual({ transaction: mockTx });
    expect(writes.map((w) => [w.what, w.inTx])).toEqual([
      ["session", true],
      ["audit", true],
    ]);
  });

  it("the password step of an MFA account writes no LOGIN row — the login has not happened", async () => {
    Users.findOne.mockResolvedValue(userRow({ mfaEnabled: true, mfaSecret: "S" }));
    comparePassword.mockResolvedValue(true);

    const result = await authService.loginUser({ user: "ada", password: "Right-password-1" });

    expect(result.data.mfaRequired).toBe(true);
    expect(writes).toEqual([]);
  });

  it("a failed audit insert fails the login instead of issuing an unattributed session", async () => {
    Users.findOne.mockResolvedValue(userRow());
    comparePassword.mockResolvedValue(true);
    AuditLog.create.mockRejectedValue(new Error("audit insert failed"));

    await expect(
      authService.loginUser({ user: "ada", password: "Right-password-1" }),
    ).rejects.toThrow("audit insert failed");
  });

  it("a user with no tenant logs in with an error log instead of a row (tenant_id is NOT NULL)", async () => {
    Users.findOne.mockResolvedValue(userRow({ tenantId: null }));
    comparePassword.mockResolvedValue(true);

    const result = await authService.loginUser({ user: "ada", password: "Right-password-1" });

    expect(result.status).toBe(200);
    expect(auditRows()).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(
      "LOGIN not audited: the user has no tenant",
      { userId: USER_ID, sessionId: SESSION_ID, method: "password" },
    );
  });
});

describe("A-72: a refused login writes no session and no LOGIN row", () => {
  it("a failed password login writes nothing", async () => {
    Users.findOne.mockResolvedValue(userRow());
    comparePassword.mockResolvedValue(false);

    await expect(
      authService.loginUser({ user: "ada", password: "Wrong-password-1" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(writes).toEqual([]);
  });

  it.each([
    ["isActive false", { isActive: false }],
    ["status SUSPENDED (SCIM deprovisioning)", { status: "SUSPENDED" }],
    ["status INACTIVE", { status: "INACTIVE" }],
  ])("a password login by a user with %s is refused before any write", async (_label, overrides) => {
    Users.findOne.mockResolvedValue(userRow(overrides));
    comparePassword.mockResolvedValue(true);

    await expect(
      authService.loginUser({ user: "ada", password: "Right-password-1" }),
    ).rejects.toMatchObject({ status: 403, message: "Account is suspended" });
    expect(writes).toEqual([]);
    expect(comparePassword).not.toHaveBeenCalled();
  });

  it.each([
    ["isActive false", { isActive: false }],
    ["status SUSPENDED", { status: "SUSPENDED" }],
  ])("an MFA login by a user with %s is refused before any write", async (_label, overrides) => {
    Users.findByPk.mockResolvedValue(
      userRow({ mfaEnabled: true, mfaSecret: "S", ...overrides }),
    );
    authenticator.check.mockReturnValue(true);

    await expect(authService.loginMfa(USER_ID, "123456")).rejects.toMatchObject({
      status: 403,
      message: "Account is suspended",
    });
    expect(writes).toEqual([]);
  });
});
