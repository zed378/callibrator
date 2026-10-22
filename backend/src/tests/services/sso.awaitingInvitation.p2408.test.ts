/**
 * P24-08 (ADR-139 § 2) — single sign-on does not open an imported account awaiting its invitation.
 *
 * Fail-before: `provisionUser` found the account by `{ email, tenantId }` and signed it in, so an
 * identity provider configured on the provider tenant was a way in before the pre-invitation gate.
 * Now: a 403 that says why (the IdP has authenticated the person, so the reason is no oracle), and
 * no JIT account is created beside it.
 *
 * Real: sso.service#provisionUser. Doubled: the models, the audit service, bcrypt.
 */
import type * as SsoService from "../../services/sso.service";

jest.mock("../../models", () => ({
  Users: {
    findOne: jest.fn(),
    create: jest.fn(),
    findByPk: jest.fn(),
    sequelize: { transaction: jest.fn(() => ({ commit: jest.fn(), rollback: jest.fn() })) },
  },
  Role: { findOne: jest.fn() },
  ClientFacility: { count: jest.fn(() => Promise.resolve(0)) },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../utils/password.util", () => ({ hashPassword: jest.fn(() => Promise.resolve("hashed")) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the doubled models, loaded after the mocks
const { Users } = require("../../models") as { Users: { findOne: jest.Mock; create: jest.Mock } };
const sso = jest.requireActual<typeof SsoService>("../../services/sso.service");

const TENANT = "f1f1f1f1-0000-4000-8000-0000000000f1" as Parameters<typeof sso.provisionUser>[0];
const account = (awaitingInvitation: boolean): Record<string, unknown> => ({
  id: "f2f2f2f2-0000-4000-8000-0000000000f2",
  email: "rs1a@example.test",
  isActive: true,
  status: "ACTIVE",
  role: { id: "r", name: "HEALTHCARE ADMIN", roleLevel: 5 },
  awaitingInvitation,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("P24-08: SSO and an account awaiting its invitation", () => {
  it("refuses to sign it in, says why, and creates no account beside it", async () => {
    Users.findOne.mockResolvedValueOnce(account(true));
    await expect(sso.provisionUser(TENANT, { email: "rs1a@example.test", firstName: "R", lastName: "S" })).rejects.toMatchObject({
      status: 403,
      message: "This account is waiting for its invitation. Use the link in the invitation e-mail.",
    });
    expect(Users.create).not.toHaveBeenCalled();
  });

  it("signs in the same account once it no longer awaits its invitation (the branch is the marker)", async () => {
    const accepted = account(false);
    Users.findOne.mockResolvedValueOnce(accepted);
    await expect(sso.provisionUser(TENANT, { email: "rs1a@example.test", firstName: "R", lastName: "S" })).resolves.toBe(accepted);
  });
});
