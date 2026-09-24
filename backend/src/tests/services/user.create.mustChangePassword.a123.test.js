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

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async () => [];
  db.transaction = async () => {
    const t = {
      finished: undefined,
      commit: async () => {
        t.finished = "commit";
      },
      rollback: async () => {
        t.finished = "rollback";
      },
    };
    return t;
  };
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn().mockResolvedValue("$2b$hash"),
  comparePassword: jest.fn(),
}));

const models = require("../../models");
const auditService = require("../../services/audit.service");
const userService = require("../../services/user.service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const ROLE = "33333333-3333-4333-8333-333333333333";
const ACTOR = "44444444-4444-4444-8444-444444444444";

describe("A-123: userCreate flags the account for a forced password change", () => {
  let captured;

  beforeEach(() => {
    captured = null;
    jest.spyOn(models.Users, "findOne").mockResolvedValue(null);
    jest.spyOn(models.Roles, "findByPk").mockResolvedValue({
      id: ROLE,
      name: "TECHNICIAN",
      status: "active",
    });
    jest.spyOn(models.Users, "create").mockImplementation(async (values) => {
      captured = values;
      return models.Users.build(values);
    });
    jest.spyOn(models.Users, "findByPk").mockImplementation(async () => ({ id: "u-new" }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const create = () =>
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
    expect(models.Users.rawAttributes.mustChangePassword.field).toBe("must_change_password");
    const built = models.Users.build(captured);
    expect(built.mustChangePassword).toBe(true);
    expect(result.data.mustChangePassword).toBe(true);
  });

  it("the CREATE audit row records the forced change, and still no password", async () => {
    await create();

    const [entry] = auditService.logAction.mock.calls[0];
    expect(entry.changes.after.firstLoginChangeRequired).toBe(true);
    expect(JSON.stringify(entry)).not.toMatch(/Str0ng|\$2b\$hash/);
  });

  it("a self-registered or SSO-provisioned row defaults to unflagged", () => {
    // registerUser, sso.service and scim.service never set it; the default
    // is what they get.
    expect(models.Users.build({}).mustChangePassword).toBe(false);
  });
});
