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
        build: (values: Record<string, unknown>) => { isEmailVerified: boolean };
        getAttributes: () => Record<string, unknown>;
    };
    Roles: { findByPk: (...args: unknown[]) => Promise<unknown> };
};
const userService = require("../../services/user.service") as {
    userCreate: (input: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }>;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT = "11111111-1111-4111-8111-111111111111";
const ROLE = "33333333-3333-4333-8333-333333333333";
const ACTOR = "44444444-4444-4444-8444-444444444444";

describe("userCreate writes only real User attributes", () => {
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

  it("every key passed to Users.create is an attribute of the User model", async () => {
    await create();

    expect(captured).not.toBeNull();
    const attributes = Object.keys(models.Users.getAttributes());
    const unknown = Object.keys(captured ?? {}).filter((key) => !attributes.includes(key));
    expect(unknown).toEqual([]);
  });

  it("an admin-created user is stored email-verified", async () => {
    const result = await create();

    const built = models.Users.build(captured ?? {});
    expect(built.isEmailVerified).toBe(true);
    expect(result.data["isEmailVerified"]).toBe(true);
  });
});
