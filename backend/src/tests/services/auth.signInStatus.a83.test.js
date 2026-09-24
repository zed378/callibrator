/**
 * A-83 — status checks at the password and MFA sign-in points.
 *
 * - Password login did not check the TENANT's status; only the per-request
 *   middleware did, so a suspended tenant's user got a session and a LOGIN
 *   row for a token no request would accept.
 * - loginMfa ignored users.locked_until.
 *
 * (The third point, the SSO exchange, is sso.exchangeStatus.a83.test.js.)
 *
 * What is real: auth.service (loginUser, loginMfa), audit.service and the Joi
 * login schema. What is faked: the models, the transaction, createSession,
 * bcrypt and the TOTP check — as in auth.loginAudit.a72.test.js.
 */

const mockTx = { id: "tx-a83" };

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
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
}));

jest.mock("otplib", () => ({ authenticator: { check: jest.fn() } }));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { Users, Tenants, AuditLog } = require("../../models");
const { createSession } = require("../../services/session.service");
const { comparePassword } = require("../../utils/password.util");
const { authenticator } = require("otplib");
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

const passwordLogin = (password = "Right-password-1") =>
  authService.loginUser({ user: "ada", password, ip: "203.0.113.5" });

beforeEach(() => {
  jest.clearAllMocks();
  createSession.mockResolvedValue({ id: "session-1" });
  AuditLog.create.mockImplementation(async (row) => ({ toJSON: () => row }));
});

const nothingWritten = () => {
  expect(createSession).not.toHaveBeenCalled();
  expect(AuditLog.create).not.toHaveBeenCalled();
};

describe("A-83: password login checks the tenant", () => {
  it.each([
    ["suspended", { id: TENANT_ID, status: "suspended" }, "Tenant account is suspended"],
    ["SUSPENDED (upper case)", { id: TENANT_ID, status: "SUSPENDED" }, "Tenant account is suspended"],
    ["deleted", { id: TENANT_ID, status: "deleted" }, "Tenant account is deleted"],
    // Soft-deleted: the Tenant default scope hides it, so the include is null.
    ["gone (soft-deleted, include is null)", null, "Tenant account is deleted"],
  ])("password login refuses a %s tenant: no session, no LOGIN row", async (_label, tenant, message) => {
    const user = userRow({ tenant });
    Users.findOne.mockResolvedValue(user);
    comparePassword.mockResolvedValue(true);

    await expect(passwordLogin()).rejects.toMatchObject({ status: 403, message });
    nothingWritten();
    // Refused before the failure counters are reset or lastLoginAt is written.
    expect(user.update).not.toHaveBeenCalled();
  });

  it("an MFA account in a suspended tenant gets no MFA token either", async () => {
    Users.findOne.mockResolvedValue(
      userRow({ mfaEnabled: true, mfaSecret: "S", tenant: { id: TENANT_ID, status: "suspended" } }),
    );
    comparePassword.mockResolvedValue(true);

    await expect(passwordLogin()).rejects.toMatchObject({ status: 403 });
  });

  it("the tenant is disclosed only after the password: a wrong one is still 401", async () => {
    Users.findOne.mockResolvedValue(userRow({ tenant: { id: TENANT_ID, status: "suspended" } }));
    comparePassword.mockResolvedValue(false);

    await expect(passwordLogin("Wrong-password-1")).rejects.toMatchObject({
      status: 401,
      message: "Invalid credentials",
    });
  });

  it("loads the tenant with the user, as an OUTER join", async () => {
    Users.findOne.mockResolvedValue(userRow());
    comparePassword.mockResolvedValue(true);

    const result = await passwordLogin();

    expect(result.status).toBe(200);
    expect(Users.findOne.mock.calls[0][0].include).toEqual(
      expect.arrayContaining([
        { model: Tenants, as: "tenant", attributes: ["id", "status"], required: false },
      ]),
    );
  });

  it("an active tenant and a tenant-less user both sign in", async () => {
    Users.findOne.mockResolvedValue(userRow());
    comparePassword.mockResolvedValue(true);
    expect((await passwordLogin()).status).toBe(200);

    Users.findOne.mockResolvedValue(userRow({ tenantId: null, tenant: null }));
    expect((await passwordLogin()).status).toBe(200);
  });
});

describe("A-83: loginMfa honours lockedUntil and the tenant", () => {
  const mfaRow = (overrides = {}) =>
    userRow({ mfaEnabled: true, mfaSecret: "BASE32SECRET", ...overrides });

  it("loginMfa refuses a locked account, before the code is checked", async () => {
    Users.findByPk.mockResolvedValue(
      mfaRow({ lockedUntil: new Date(Date.now() + 10 * 60 * 1000) }),
    );
    authenticator.check.mockReturnValue(true);

    await expect(authService.loginMfa(USER_ID, "123456", "203.0.113.6")).rejects.toMatchObject({
      status: 423,
      message: "Account temporarily locked",
    });
    expect(authenticator.check).not.toHaveBeenCalled();
    nothingWritten();
  });

  it("a lock that has expired does not refuse", async () => {
    Users.findByPk.mockResolvedValue(mfaRow({ lockedUntil: new Date(Date.now() - 1000) }));
    authenticator.check.mockReturnValue(true);

    const result = await authService.loginMfa(USER_ID, "123456", "203.0.113.6");

    expect(result.status).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("loginMfa refuses a tenant suspended since the password step", async () => {
    Users.findByPk.mockResolvedValue(mfaRow({ tenant: { id: TENANT_ID, status: "suspended" } }));
    authenticator.check.mockReturnValue(true);

    await expect(authService.loginMfa(USER_ID, "123456")).rejects.toMatchObject({
      status: 403,
      message: "Tenant account is suspended",
    });
    nothingWritten();
  });

  it("loginMfa loads the tenant with the user", async () => {
    Users.findByPk.mockResolvedValue(mfaRow());
    authenticator.check.mockReturnValue(true);

    await authService.loginMfa(USER_ID, "123456");

    expect(Users.findByPk.mock.calls[0][1].include).toEqual(
      expect.arrayContaining([expect.objectContaining({ as: "tenant", required: false })]),
    );
  });
});
