/**
 * A-180 — an erased account is refused by status, at sign-in and at refresh.
 *
 * gdpr.service's anonymisation writes `status: "erased"` (lower case — the
 * value tenantBackup.service and the e-signature signer check read). The
 * refused-status list was `["INACTIVE", "SUSPENDED"]`, so the status alone
 * refused nothing: only `isActive: false`, set in the same UPDATE, stood
 * between an erased account and a session. One flag written by one code path
 * is not a refusal rule; the status is now in the list every sign-in point
 * reads (auth.middleware and config/socket.js carry the same literal — their
 * suites assert it).
 *
 * And a refresh did not ask at all: `refreshUserToken` loaded the user and
 * issued a new session whatever its status — suspended, deactivated or erased.
 *
 * What is real: auth.service. What is faked: the models, the transaction, the
 * session store and bcrypt — as in auth.signInStatus.a83.test.js.
 */

const mockTx = { id: "tx-a180" };

jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (fn) => fn(mockTx)) },
}));

jest.mock("../../models", () => ({
  Users: { findOne: jest.fn(), findByPk: jest.fn() },
  Role: {},
  Tenants: { name: "Tenants" },
  AuditLog: { create: jest.fn() },
}));

jest.mock("../../services/session.service", () => ({
  createSession: jest.fn(),
  validateSession: jest.fn(),
  revokeSession: jest.fn(),
  revokeAllSessions: jest.fn(),
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
}));

jest.mock("../../services/mfa.service", () => ({ consumeCode: jest.fn() }));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { Users, AuditLog } = require("../../models");
const sessionService = require("../../services/session.service");
const { comparePassword } = require("../../utils/password.util");
const authService = require("../../services/auth.service");

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
  update: jest.fn().mockResolvedValue({}),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  sessionService.createSession.mockResolvedValue({ id: "session-2" });
  sessionService.validateSession.mockResolvedValue({
    id: "session-1",
    user_id: USER_ID,
    tenant_id: TENANT_ID,
    impersonator_id: null,
  });
  AuditLog.create.mockImplementation(async (row) => ({ toJSON: () => row }));
  comparePassword.mockResolvedValue(true);
});

describe("A-180 — password sign-in refuses an erased account by its status", () => {
  it("status 'erased' is refused even where isActive was left true: no session, no LOGIN row", async () => {
    Users.findOne.mockResolvedValue(userRow({ status: "erased" }));

    await expect(
      authService.loginUser({ user: "ada", password: "Right-password-1", ip: "203.0.113.5" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(sessionService.createSession).not.toHaveBeenCalled();
    expect(AuditLog.create).not.toHaveBeenCalled();
  });
});

describe("A-180 — a refresh refuses what a sign-in refuses", () => {
  it.each([
    ["erased", { status: "erased" }],
    ["SUSPENDED", { status: "SUSPENDED" }],
    ["INACTIVE", { status: "INACTIVE" }],
    ["deactivated (isActive false)", { isActive: false }],
  ])("%s: no new session, and the presented one is revoked", async (_label, overrides) => {
    Users.findByPk.mockResolvedValue(userRow(overrides));

    await expect(authService.refreshUserToken("refresh-token-1")).rejects.toMatchObject({
      status: 403,
      message: "Account is suspended",
    });
    expect(sessionService.revokeSession).toHaveBeenCalledWith("refresh-token-1", "ACCOUNT_REFUSED");
    expect(sessionService.createSession).not.toHaveBeenCalled();
  });

  it("an active account still refreshes", async () => {
    Users.findByPk.mockResolvedValue(userRow());

    const result = await authService.refreshUserToken("refresh-token-1");

    expect(sessionService.createSession).toHaveBeenCalledTimes(1);
    expect(sessionService.revokeSession).toHaveBeenCalledWith("refresh-token-1", "TOKEN_ROTATION");
    expect(result).toBeDefined();
  });
});
