/**
 * P6-07 — the sign-in and the break-glass of a platform operator's MFA.
 *
 *  - A super admin without MFA signs in with the password to an ENROLMENT-ONLY
 *    session (auth.middleware refuses everything else — see
 *    middlewares/auth.superAdminMfa.p607.test.js); the response says so, so
 *    the frontend goes straight to the MFA page. With MFA the password step
 *    answers "MFA required" and issues no session — the existing second step.
 *  - The break-glass (auth.service#breakGlassResetOperatorMfa, run only by
 *    scripts/breakGlassMfaReset.js) clears the operator's enrolment, revokes
 *    every session and writes a `system:break-glass` audit row in one
 *    transaction — it never switches the requirement off.
 *
 * What is real: auth.service, audit.service#logAction against the audit
 * schema (auditLedger fixture), mfaPolicy.util, jwt.util. Faked: the user
 * rows, createSession / revokeAllSessions and bcrypt.
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
  revokeAllSessions: jest.fn(async () => [2]),
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(async () => true),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { Users } = require("../../models");
const { revokeAllSessions } = require("../../services/session.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const authService = require("../../services/auth.service");
const limiter = require("../../services/rateLimiter.redis.service");
const { verifyPurposeToken } = require("../../utils/jwt.util");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");

const OPERATOR_ID = "99999999-9999-4999-8999-999999999999";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

const operator = (overrides = {}) => {
  const row = {
    id: OPERATOR_ID,
    tenantId: TENANT_ID,
    tenant: { id: TENANT_ID, status: "active" },
    username: "sys",
    email: "sys@mail.com",
    password: "hash",
    isActive: true,
    status: "ACTIVE",
    failedLoginAttempts: 0,
    lockedUntil: null,
    mfaEnabled: false,
    mfaSecret: null,
    role: { id: "r-sa", name: "SUPERADMIN", roleLevel: 10 },
    ...overrides,
  };
  row.update = jest.fn(async (values, options) => {
    await mockRef.ledger.write("users", values, options);
    Object.assign(row, values);
  });
  return row;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRef.ledger = createLedger();
  limiter.clearMemoryStore();
});

describe("P6-07: a platform operator's password sign-in", () => {
  it("without MFA: a session whose response says enrolment comes first", async () => {
    Users.findOne.mockResolvedValue(operator());

    const result = await authService.loginUser({ user: "sys", password: "123123", ip: "10.0.0.1" });

    expect(result.status).toBe(200);
    expect(result.data.mfaEnrolmentRequired).toBe(true);
  });

  it("with MFA: the password alone opens no session — the code step follows", async () => {
    Users.findOne.mockResolvedValue(operator({ mfaEnabled: true, mfaSecret: "S" }));

    const result = await authService.loginUser({ user: "sys", password: "123123", ip: "10.0.0.1" });

    expect(result.status).toBe(202);
    expect(result.session).toBeUndefined();
    expect(verifyPurposeToken(result.token, "mfa")).toMatchObject({ id: OPERATOR_ID, mfaRequired: true });
  });

  it("a tenant member without MFA is not flagged by the login response (their tenant's policy is /verify's)", async () => {
    Users.findOne.mockResolvedValue(operator({ role: { id: "r-t", name: "TECHNICIAN", roleLevel: 3 } }));

    const result = await authService.loginUser({ user: "sys", password: "123123", ip: "10.0.0.1" });

    expect(result.data.mfaEnrolmentRequired).toBe(false);
  });
});

describe("P6-07: the break-glass reset", () => {
  const breakGlass = (overrides = {}) =>
    authService
      .breakGlassResetOperatorMfa({
        identifier: " sys@mail.com ",
        requestedBy: " Rina (IT on call) ",
        ticket: "INC-4711",
        ...overrides,
      })
      .catch((e) => e);

  it("clears the enrolment, revokes every session and writes one system:break-glass row — in one transaction", async () => {
    const row = operator({ mfaEnabled: true, mfaSecret: "SECRET", mfaRecoveryCodes: ["h1"] });
    Users.findOne.mockResolvedValue(row);

    const result = await breakGlass();

    expect(result).toEqual({ userId: OPERATOR_ID, sessionsRevoked: 2 });
    const [write] = mockRef.ledger.committed("users");
    expect(write).toMatchObject({ mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: null });
    expect(revokeAllSessions).toHaveBeenCalledWith(OPERATOR_ID, "MFA_BREAK_GLASS");
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        tenantId: TENANT_ID,
        userId: null,
        actorType: "system",
        actorName: "system:break-glass",
        action: "UPDATE",
        resourceType: "User",
        resourceId: OPERATOR_ID,
        changes: {
          operation: "MFA_BREAK_GLASS_RESET",
          requestedBy: "Rina (IT on call)",
          ticket: "INC-4711",
          sessionsRevoked: 2,
        },
      }),
    ]);
    expect(logger.warn).toHaveBeenCalledWith("Break-glass: a platform operator's MFA was reset", {
      userId: OPERATOR_ID,
      requestedBy: "Rina (IT on call)",
      ticket: "INC-4711",
    });
    // The lookup crosses tenants on purpose (there is no request context) and
    // matches the address lower-cased.
    expect(Users.findOne).toHaveBeenCalledWith(expect.objectContaining({ skipTenantScope: true }));
  });

  it("after it, the operator is back to the enrolment-only session — the requirement is not off", async () => {
    const row = operator({ mfaEnabled: true, mfaSecret: "SECRET" });
    Users.findOne.mockResolvedValue(row);
    await breakGlass();

    const signIn = await authService.loginUser({ user: "sys", password: "123123", ip: "10.0.0.1" });

    expect(signIn.data.mfaEnrolmentRequired).toBe(true);
  });

  it("a tenant-less operator's row goes in PLATFORM", async () => {
    Users.findOne.mockResolvedValue(operator({ tenantId: null, tenant: null, mfaEnabled: true }));

    await breakGlass();

    expect(mockRef.ledger.auditRows()[0].tenantId).toBe(PLATFORM_TENANT_ID);
  });

  it("if the audit row cannot be written, nothing is reset", async () => {
    Users.findOne.mockResolvedValue(operator({ mfaEnabled: true, mfaSecret: "SECRET" }));
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

    const err = await breakGlass();

    expect(err.message).toBe("audit insert failed");
    expect(mockRef.ledger.committed("users")).toEqual([]);
  });

  it.each([
    ["no identifier", { identifier: "" }],
    ["no name of who is doing it", { requestedBy: "  " }],
    ["no ticket", { ticket: undefined }],
  ])("refuses %s (400), before any lookup", async (_label, overrides) => {
    const err = await breakGlass(overrides);

    expect(err.status).toBe(400);
    expect(Users.findOne).not.toHaveBeenCalled();
  });

  it("refuses an unknown account (404)", async () => {
    Users.findOne.mockResolvedValue(null);

    expect((await breakGlass()).status).toBe(404);
  });

  it("refuses a tenant user (403) — that is their administrator's MFA reset", async () => {
    Users.findOne.mockResolvedValue(
      operator({ mfaEnabled: true, role: { id: "r-ta", name: "TENANT_ADMIN", roleLevel: 9 } }),
    );

    expect((await breakGlass()).status).toBe(403);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("refuses an operator without MFA (409) — there is nothing to reset", async () => {
    Users.findOne.mockResolvedValue(operator({ mfaEnabled: false }));

    expect((await breakGlass()).status).toBe(409);
    expect(revokeAllSessions).not.toHaveBeenCalled();
  });
});
