/**
 * user.service#userCreate wrote `is_email_verified: true`.
 *
 * That is the COLUMN name. The User attribute is `isEmailVerified`, and
 * Sequelize drops a key that is no attribute without a word — so every
 * admin-created user was stored UNVERIFIED while the code said otherwise (the
 * `is_deleted` trap in CLAUDE.md, in another column). The coverage test
 * asserted the same wrong key, so it agreed with the bug.
 *
 * Checked against the REAL User model's attributes (the models barrel, with
 * its associations, on an unconnected PostgreSQL-dialect Sequelize), not
 * against a list restated here:
 *   - every key userCreate hands Users.create is an attribute of the model;
 *   - the account is built verified.
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
const userService = require("../../services/user.service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const ROLE = "33333333-3333-4333-8333-333333333333";
const ACTOR = "44444444-4444-4444-8444-444444444444";

describe("userCreate writes only real User attributes", () => {
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

  it("every key passed to Users.create is an attribute of the User model", async () => {
    await create();

    expect(captured).not.toBeNull();
    const attributes = Object.keys(models.Users.rawAttributes);
    const unknown = Object.keys(captured).filter((key) => !attributes.includes(key));
    expect(unknown).toEqual([]);
  });

  it("an admin-created user is stored email-verified", async () => {
    const result = await create();

    const built = models.Users.build(captured);
    expect(built.isEmailVerified).toBe(true);
    expect(result.data.isEmailVerified).toBe(true);
  });
});
