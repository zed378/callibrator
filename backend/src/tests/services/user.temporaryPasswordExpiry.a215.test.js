/**
 * A-215 — the password an administrator chooses at creation, or issues by
 * the admin reset, expires 72 hours after it is issued.
 *
 * Fail-before: userCreate and resetUserPassword set only
 * `mustChangePassword`; nothing bounded how long the administrator's password
 * signed in.
 *
 * Checked against the REAL User model (the models barrel on an unconnected
 * PostgreSQL-dialect Sequelize): the key must be an ATTRIBUTE mapped to the
 * column migration 0078 adds, or Sequelize would drop it without a word.
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
jest.mock("../../services/session.service", () => ({ revokeOtherSessions: jest.fn(async () => 1) }));
jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn().mockResolvedValue("$2b$hash"),
  comparePassword: jest.fn(),
}));

const models = require("../../models");
const auditService = require("../../services/audit.service");
const userService = require("../../services/user.service");
const migration0078 = require("../../migrations/0078-user-temporary-password-expiry");

const TENANT = "11111111-1111-4111-8111-111111111111";
const ROLE = "33333333-3333-4333-8333-333333333333";
const ACTOR = "44444444-4444-4444-8444-444444444444";
const TARGET = "55555555-5555-4555-8555-555555555555";
const HOUR = 60 * 60 * 1000;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-215: the TTL", () => {
  it("is 72 hours, and the migration's backfill uses the same", () => {
    expect(userService.TEMPORARY_PASSWORD_TTL_MS).toBe(72 * HOUR);
    expect(migration0078.TTL_HOURS * HOUR).toBe(userService.TEMPORARY_PASSWORD_TTL_MS);
  });

  it("temporaryPasswordExpiresAt is a real attribute on the column 0078 adds", () => {
    const attribute = models.Users.rawAttributes.temporaryPasswordExpiresAt;
    expect(attribute.field).toBe(migration0078.COLUMN);
    expect(attribute.allowNull).toBe(true);
    // Self-registration, SSO and SCIM never set it: their password is not an
    // administrator's.
    expect(models.Users.build({}).temporaryPasswordExpiresAt).toBeUndefined();
  });
});

describe("A-215: userCreate", () => {
  let captured;

  beforeEach(() => {
    captured = null;
    jest.spyOn(models.Users, "findOne").mockResolvedValue(null);
    jest.spyOn(models.Roles, "findByPk").mockResolvedValue({ id: ROLE, name: "TECHNICIAN", status: "active" });
    jest.spyOn(models.Users, "create").mockImplementation(async (values) => {
      captured = values;
      return models.Users.build(values);
    });
    jest.spyOn(models.Users, "findByPk").mockImplementation(async () => ({ id: "u-new" }));
  });

  it("stamps an expiry 72 hours ahead, returns it, and audits the deadline", async () => {
    const before = Date.now();
    const result = await userService.userCreate({
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
    const after = Date.now();

    const expiresAt = models.Users.build(captured).temporaryPasswordExpiresAt.getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 72 * HOUR);
    expect(expiresAt).toBeLessThanOrEqual(after + 72 * HOUR);
    expect(result.data.temporaryPasswordExpiresAt.getTime()).toBe(expiresAt);
    const [entry] = auditService.logAction.mock.calls[0];
    expect(entry.changes.after.firstLoginChangeDeadline).toBe(new Date(expiresAt).toISOString());
    // Still no password in the trail.
    expect(JSON.stringify(entry)).not.toMatch(/Str0ng|\$2b\$hash/);
  });
});

describe("A-215: resetUserPassword", () => {
  it("stamps a fresh 72-hour expiry on the target, returns it, and audits the deadline", async () => {
    const target = {
      id: TARGET,
      tenantId: TENANT,
      role: { roleLevel: 1 },
      update: jest.fn(async () => undefined),
    };
    jest.spyOn(models.Users, "findOne").mockResolvedValue(target);
    jest.spyOn(models.Users, "findByPk").mockResolvedValue(target);

    const before = Date.now();
    const result = await userService.resetUserPassword({
      userId: TARGET,
      resetBy: ACTOR,
      actorTenantId: TENANT,
      actorRoleLevel: 5,
    });

    const [values] = target.update.mock.calls[0];
    expect(values.mustChangePassword).toBe(true);
    expect(values.temporaryPasswordExpiresAt.getTime()).toBeGreaterThanOrEqual(before + 72 * HOUR);
    expect(result.data.temporaryPasswordExpiresAt).toBe(values.temporaryPasswordExpiresAt);
    expect(result.message).toMatch(/stops working after 72 hours/);
    const [entry] = auditService.logAction.mock.calls[0];
    expect(entry.changes.firstLoginChangeDeadline).toBe(values.temporaryPasswordExpiresAt.toISOString());
  });
});
