/**
 * A-60 item 3 (ADR-075, upholding ADR-051 Q-11) — sign-in does not wait on
 * email verification, and that is now a decision pinned by a test rather than
 * an accident nobody had looked at.
 *
 * Why (ADR-075): every account that can reach data was vouched for by someone
 * other than the mailbox — an administrator (who set a temporary password the
 * holder must change, A-123/A-215), SCIM or an SSO identity provider (both
 * store `isEmailVerified: true`). The only never-vouched accounts are
 * self-registrations, which carry no tenant and so match NO_TENANT_UUID and
 * see nothing. Gating sign-in would lock out exactly the people with a valid
 * reason to be in: every admin-created account from before F-2, every account
 * whose address was rectified (A-180 resets the flag), and — because the
 * emailed link landed on a page that did not exist until ADR-075 — every
 * self-registration there has ever been. Verification proves the RECOVERY
 * channel; a completed email-code reset also proves it (ADR-051 Q-11).
 *
 * If this policy changes, these tests are the ones that must change with it.
 *
 * Harness: the A-83 one — real auth.service, audit.service and the login
 * schema; faked models, transaction, createSession and bcrypt.
 */

const mockTx = { id: "tx-a60" };

// A-288 (ADR-100): the network policy has its own suites (signInPolicy.*.a288); here it permits.
jest.mock("../../services/signInPolicy.service", () => ({ assertSignInPermitted: jest.fn(async () => undefined) }));
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

jest.mock("../../services/mfa.service", () => ({ consumeCode: jest.fn() }));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { Users, AuditLog } = require("../../models");
const { createSession } = require("../../services/session.service");
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
  isEmailVerified: false,
  failedLoginAttempts: 0,
  lockedUntil: null,
  mfaEnabled: false,
  role: { id: "r", name: "TECHNICIAN", roleLevel: 3 },
  update: jest.fn().mockResolvedValue({}),
  ...overrides,
});

const passwordLogin = () => authService.loginUser({ user: "ada", password: "Right-password-1", ip: "203.0.113.5" });

beforeEach(() => {
  jest.clearAllMocks();
  createSession.mockResolvedValue({ id: "session-1" });
  AuditLog.create.mockImplementation(async (row) => ({ toJSON: () => row }));
  comparePassword.mockResolvedValue(true);
});

describe("A-60 / Q-11 — an unverified address does not gate sign-in (ADR-075)", () => {
  it("a tenant member whose address is unverified (e.g. rectified, A-180) signs in with a session and a LOGIN row", async () => {
    Users.findOne.mockResolvedValue(userRow());

    const result = await passwordLogin();

    expect(result.status).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(AuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "LOGIN", tenantId: TENANT_ID, userId: USER_ID }),
      expect.anything(),
    );
  });

  it("a self-registered account (no tenant) that never followed its link signs in — into nothing: no tenant, no audit trail to write", async () => {
    Users.findOne.mockResolvedValue(userRow({ tenantId: null, tenant: null, role: { id: "r", name: "USER", roleLevel: 1 } }));

    const result = await passwordLogin();

    expect(result.status).toBe(200);
    expect(result.data.tenantId).toBeNull();
  });

  it("the answer is the same whether or not the address is verified — the flag is not disclosed at sign-in", async () => {
    Users.findOne.mockResolvedValue(userRow({ isEmailVerified: false }));
    const unverified = await passwordLogin();
    Users.findOne.mockResolvedValue(userRow({ isEmailVerified: true }));
    const verified = await passwordLogin();

    expect(Object.keys(unverified.data).sort()).toEqual(Object.keys(verified.data).sort());
    expect(unverified.data).not.toHaveProperty("isEmailVerified");
    expect(unverified.message).toBe(verified.message);
  });
});
