/**
 * A-123 (ADR-051 Q-11) — an account an administrator creates is flagged to
 * change its password at first sign-in.
 *
 * Fail-before: userCreate handed Users.create no `mustChangePassword` (the
 * attribute did not exist), so the built row read `undefined` and nothing
 * forced the change.
 *
 * Checked against the REAL User model (the models barrel on an unconnected
 * PostgreSQL-dialect Sequelize), as user.create.attributes.test.js does: the
 * key must be an ATTRIBUTE — a column name would be dropped without a word
 * (the `is_email_verified` trap).
 */
import type * as SequelizeModule from "sequelize";

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual<typeof SequelizeModule>("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  (db as unknown as { query: unknown }).query = () => Promise.resolve([]);
  (db as unknown as { transaction: unknown }).transaction = () => {
    const t = {
      finished: undefined as string | undefined,
      commit: () => {
        t.finished = "commit";
        return Promise.resolve();
      },
      rollback: () => {
        t.finished = "rollback";
        return Promise.resolve();
      },
    };
    return Promise.resolve(t);
  };
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn().mockResolvedValue("$2b$hash"),
  comparePassword: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as includes.a90 does */
require("../../models");
const models = require("../../models") as {
    Users: {
        findOne: (...args: unknown[]) => Promise<unknown>;
        findByPk: (...args: unknown[]) => Promise<unknown>;
        create: (...args: unknown[]) => Promise<unknown>;
        build: (values?: Record<string, unknown> | null) => { mustChangePassword: boolean };
        rawAttributes: Record<string, { field?: string } | undefined>;
    };
    Roles: { findByPk: (...args: unknown[]) => Promise<unknown> };
};
const auditService = require("../../services/audit.service") as {
    logAction: jest.Mock;
};
const userService = require("../../services/user.service") as {
    userCreate: (input: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }>;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT = "11111111-1111-4111-8111-111111111111";
const ROLE = "33333333-3333-4333-8333-333333333333";
const ACTOR = "44444444-4444-4444-8444-444444444444";

describe("A-123: userCreate flags the account for a forced password change", () => {
  let captured: Record<string, unknown> | null;

  beforeEach(() => {
    captured = null;
    jest.spyOn(models.Users, "findOne").mockResolvedValue(null);
    jest.spyOn(models.Roles, "findByPk").mockResolvedValue({
      id: ROLE,
      name: "TECHNICIAN",
      status: "active",
    });
    jest.spyOn(models.Users, "create").mockImplementation((values: unknown) => {
      captured = values as Record<string, unknown>;
      return Promise.resolve(models.Users.build(captured));
    });
    jest.spyOn(models.Users, "findByPk").mockImplementation(() => Promise.resolve({ id: "u-new" }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const create = (): Promise<{ data: Record<string, unknown> }> =>
    userService.userCreate({
      tenantId: TENANT,
      username: "ada",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@hospital.example.com",
      password: "Str0ng!Passw0rd",
      roleId: ROLE,
      createdBy: ACTOR,
      actorTenantId: TENANT,
    });

  it("the created row carries mustChangePassword = true, as a real model attribute", async () => {
    const result = await create();

    expect(Object.keys(models.Users.rawAttributes)).toContain("mustChangePassword");
    expect(models.Users.rawAttributes["mustChangePassword"]?.field).toBe("must_change_password");
    const built = models.Users.build(captured);
    expect(built.mustChangePassword).toBe(true);
    expect(result.data["mustChangePassword"]).toBe(true);
  });

  it("the CREATE audit row records the forced change, and still no password", async () => {
    await create();

    const [entry] = auditService.logAction.mock.calls[0] as [
            { changes: { after: { firstLoginChangeRequired: boolean } } },
        ];
    expect(entry.changes.after.firstLoginChangeRequired).toBe(true);
    expect(JSON.stringify(entry)).not.toMatch(/Str0ng|\$2b\$hash/);
  });

  it("a self-registered or SSO-provisioned row defaults to unflagged", () => {
    // registerUser, sso.service and scim.service never set it; the default
    // is what they get.
    expect(models.Users.build({}).mustChangePassword).toBe(false);
  });
});
