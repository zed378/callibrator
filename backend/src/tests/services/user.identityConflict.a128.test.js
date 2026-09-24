/**
 * A-128 (ADR-051 Q-18) — a tenant administrator's identity conflicts are
 * rate-limited and audited: the residual cross-tenant existence oracle.
 *
 * `users.username` and `users.email` are unique ACROSS tenants, and Q-18 keeps
 * that. So a tenant admin creating (or renaming) a user with an identity that
 * another hospital holds must be refused — which tells them it exists
 * somewhere. Before this card:
 *  - the duplicate check ran under the tenant hooks, so another tenant's
 *    holder PASSED it and the insert failed on the unique index: a 500 — the
 *    same oracle, unlimited and unaudited;
 *  - the check was a LIKE on the raw input, so `_` and `%` were wildcards;
 *  - nothing was counted or recorded.
 *
 * What is real: user.service (userCreate, editUser), the Joi schemas, the
 * models barrel on an unconnected PostgreSQL-dialect Sequelize — including the
 * global tenant hooks and the User defaultScope — whose SELECTs are captured
 * as SQL, rateLimiter.redis.service on its in-process store, audit.service and
 * the audit_logs schema through the auditLedger fixture (which also stands in
 * for the transactions). What is faked: which account holds an identity (the
 * lookup's result), and the INSERT.
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, sql: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  // Every SELECT is recorded and finds nothing (a `plain` one — findOne — is null).
  db.query = async (sql, options = {}) => {
    mockRef.sql.push(String(sql));
    return options.plain ? null : [];
  };
  db.transaction = (...args) => mockRef.ledger.transaction(...args);
  return { db };
});
jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn().mockResolvedValue("$2b$hash"),
  comparePassword: jest.fn(),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const models = require("../../models");
const userService = require("../../services/user.service");
const { clearMemoryStore } = require("../../services/rateLimiter.redis.service");
const { getAuthConfig } = require("../../constants/rateLimitConstants");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const { logger } = require("../../middlewares/activityLog.middleware");

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const OTHER_ADMIN_A = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const SUPER_ADMIN = "99999999-9999-4999-8999-999999999999";
const ROLE = "33333333-3333-4333-8333-333333333333";
const TARGET = "44444444-4444-4444-8444-444444444444";
const TAKEN_EMAIL = "nurse@hospital-b.example.com";
const BUDGET = getAuthConfig("userIdentityConflict").maxAttempts;

/** The identities some account — in any tenant — holds. */
let held;
let created;

const findOneImpl = async (options) => {
  const where = options.where || {};
  for (const field of ["username", "email"]) {
    // The operator is a Symbol key ([Op.iLike]).
    const pattern = where[field] && where[field][Object.getOwnPropertySymbols(where[field])[0]];
    if (typeof pattern === "string" && held[field].has(pattern.replace(/\\(.)/g, "$1"))) {
      return { id: "holder" };
    }
  }
  return null;
};

const adminInput = (overrides = {}) => ({
  username: "newnurse",
  firstName: "New",
  lastName: "Nurse",
  email: "new.nurse@hospital-a.example.com",
  password: "Str0ng!Passw0rd",
  roleId: ROLE,
  createdBy: ADMIN_A,
  actorTenantId: TENANT_A,
  actorIsSuperAdmin: false,
  ipAddress: "192.0.2.10",
  userAgent: "admin-browser",
  ...overrides,
});

const createAs = (overrides) =>
  tenantStorage.run({ tenantId: TENANT_A }, () => userService.userCreate(adminInput(overrides)));

const conflictRows = () =>
  mockRef.ledger.auditRows().filter((r) => r.changes && r.changes.operation === "IDENTITY_CONFLICT");

beforeEach(() => {
  mockRef.ledger = createLedger();
  mockRef.sql = [];
  clearMemoryStore();
  held = { username: new Set(), email: new Set() };
  created = [];
  jest.spyOn(models.Users, "findOne").mockImplementation(findOneImpl);
  jest.spyOn(models.Roles, "findByPk").mockResolvedValue({ id: ROLE, name: "TECHNICIAN", status: "active" });
  jest.spyOn(models.Users, "create").mockImplementation(async (values) => {
    created.push(values);
    return models.Users.build({ id: "u-new", ...values });
  });
  jest.spyOn(models.Users, "findByPk").mockImplementation(async () => ({ id: "u-new" }));
  jest.spyOn(models.AuditLog, "create").mockImplementation((...args) => mockRef.ledger.AuditLog.create(...args));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-128: a conflict on create is a 409, audited", () => {
  it("an email another tenant holds answers 409 (was 500), creates nothing, and writes one audit row in the admin's tenant", async () => {
    held.email.add(TAKEN_EMAIL);

    await expect(createAs({ email: TAKEN_EMAIL })).rejects.toEqual({
      status: 409,
      message: "Email already registered",
    });

    expect(created).toEqual([]);
    expect(conflictRows()).toHaveLength(1);
    const [row] = conflictRows();
    expect(row).toMatchObject({
      tenantId: TENANT_A,
      userId: ADMIN_A,
      actorType: "user",
      action: "CREATE",
      resourceType: "User",
      resourceId: null,
      changes: { operation: "IDENTITY_CONFLICT", outcome: "refused", field: "email" },
      ipAddress: "192.0.2.10",
      userAgent: "admin-browser",
    });
    // Never the probed value, never whose it was: this tenant's admins read it.
    expect(JSON.stringify(row)).not.toContain(TAKEN_EMAIL);
    expect(JSON.stringify(row)).not.toMatch(/tenant-b|hospital-b|other tenant/i);
    // The only committed rows: the conflict. The create's own transaction rolled back.
    expect(mockRef.ledger.rows).toHaveLength(1);
  });

  it("a username held anywhere answers 409 with the same message as before", async () => {
    held.username.add("taken");

    await expect(createAs({ username: "taken" })).rejects.toEqual({ status: 409, message: "Username already used" });
    expect(conflictRows()[0].changes.field).toBe("username");
  });

  it("a unique violation that races past the check is the same audited 409, not a 500", async () => {
    const race = new Error("Validation error");
    race.name = "SequelizeUniqueConstraintError";
    race.fields = { email: "x" };
    models.Users.create.mockRejectedValueOnce(race);

    await expect(createAs()).rejects.toEqual({ status: 409, message: "Email already registered" });
    expect(conflictRows()).toHaveLength(1);

    const usernameRace = Object.assign(new Error("Validation error"), {
      name: "SequelizeUniqueConstraintError",
      fields: { username: "x" },
    });
    models.Users.create.mockRejectedValueOnce(usernameRace);
    await expect(createAs()).rejects.toEqual({ status: 409, message: "Username already used" });
  });

  it("a unique violation on anything else is not an identity conflict — no row, a 500", async () => {
    const other = Object.assign(new Error("duplicate key"), {
      name: "SequelizeUniqueConstraintError",
      fields: { webauthn_credential_id: "x" },
    });
    models.Users.create.mockRejectedValueOnce(other);
    await expect(createAs()).rejects.toMatchObject({ status: 500 });
    const bare = Object.assign(new Error("duplicate key"), { name: "SequelizeUniqueConstraintError" });
    models.Users.create.mockRejectedValueOnce(bare);
    await expect(createAs()).rejects.toMatchObject({ status: 500 });

    expect(conflictRows()).toEqual([]);
  });

  it("an audit row that cannot be written is not answered with the 409", async () => {
    held.email.add(TAKEN_EMAIL);
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

    await expect(createAs({ email: TAKEN_EMAIL })).rejects.toThrow("audit insert failed");
  });

  it("a super admin's conflict is a 409, neither counted nor audited — they read every tenant anyway", async () => {
    held.email.add(TAKEN_EMAIL);

    for (let i = 0; i < BUDGET + 1; i += 1) {
      await expect(
        userService.userCreate(
          adminInput({ email: TAKEN_EMAIL, createdBy: SUPER_ADMIN, actorIsSuperAdmin: true, tenantId: TENANT_A }),
        ),
      ).rejects.toEqual({ status: 409, message: "Email already registered" });
    }

    expect(conflictRows()).toEqual([]);
  });
});

describe("A-128: the lookup is global, soft-deleted included, and exact", () => {
  it("inside tenant A's context the SELECT carries no tenant predicate, no soft-delete filter, and escapes `_` and `%`", async () => {
    models.Users.findOne.mockRestore();

    await createAs({ username: "newnurse", email: "a_b%c@hospital-a.example.com" });

    const lookups = mockRef.sql.filter((q) => /^SELECT "id" FROM "users"/.test(q));
    expect(lookups).toHaveLength(2);
    const [byUsername, byEmail] = lookups;
    expect(byUsername).toContain("\"User\".\"username\" ILIKE 'newnurse'");
    expect(byEmail).toContain("\"User\".\"email\" ILIKE 'a\\_b\\%c@hospital-a.example.com'");
    for (const sql of lookups) {
      expect(sql).not.toMatch(/tenant_id/);
      expect(sql).not.toMatch(/deleted_at/);
      expect(sql).toContain("\"User\".\"is_deleted\" IN (true, false)");
    }
    expect(created).toHaveLength(1);
  });

  it("an edit's lookup excludes the user being edited", async () => {
    models.Users.findOne.mockRestore();
    const user = models.Users.build({ id: TARGET, tenantId: TENANT_A, username: "old", email: "old@a.example.com" });
    user.update = jest.fn(async () => user);
    models.Users.findByPk.mockResolvedValue(user);

    await tenantStorage.run({ tenantId: TENANT_A }, () =>
      userService.editUser({ userId: TARGET, email: "fresh@a.example.com", updatedBy: ADMIN_A, actorTenantId: TENANT_A }),
    );

    const [lookup] = mockRef.sql.filter((q) => /^SELECT "id" FROM "users"/.test(q));
    expect(lookup).toContain(`"User"."id" != '${TARGET}'`);
    expect(lookup).not.toMatch(/tenant_id/);
  });
});

describe("A-128: conflicts are rate-limited per administrator", () => {
  it(`after ${BUDGET} conflicts the administrator is refused 429 before anything is looked up`, async () => {
    held.email.add(TAKEN_EMAIL);
    for (let i = 0; i < BUDGET; i += 1) {
      await expect(createAs({ email: TAKEN_EMAIL })).rejects.toMatchObject({ status: 409 });
    }
    models.Users.findOne.mockClear();

    // Even a FREE identity is refused now: a spent budget learns nothing.
    await expect(createAs({ email: "free@hospital-a.example.com" })).rejects.toMatchObject({
      status: 429,
      message: expect.stringMatching(/^Too many usernames or email addresses/),
    });
    expect(models.Users.findOne).not.toHaveBeenCalled();
    expect(conflictRows()).toHaveLength(BUDGET);
    expect(logger.warn).toHaveBeenCalledWith("User identity conflict refused (A-128)", {
      actorId: ADMIN_A,
      tenantId: TENANT_A,
      field: "email",
      action: "CREATE",
    });
  });

  it("the budget is the administrator's own — another admin of the same tenant is unaffected", async () => {
    held.email.add(TAKEN_EMAIL);
    for (let i = 0; i < BUDGET; i += 1) {
      await createAs({ email: TAKEN_EMAIL }).catch(() => {});
    }

    await expect(createAs({ createdBy: OTHER_ADMIN_A })).resolves.toMatchObject({ status: 201 });
  });

  it("successful creates do not spend the budget", async () => {
    for (let i = 0; i < BUDGET + 2; i += 1) {
      await expect(createAs()).resolves.toMatchObject({ status: 201 });
    }
  });
});

describe("A-128: an identity-changing edit is the same probe", () => {
  const target = () => {
    const user = models.Users.build({ id: TARGET, tenantId: TENANT_A, username: "old", email: "old@a.example.com" });
    user.update = jest.fn(async () => user);
    return user;
  };
  const editAs = (fields) =>
    tenantStorage.run({ tenantId: TENANT_A }, () =>
      userService.editUser({ userId: TARGET, updatedBy: ADMIN_A, actorTenantId: TENANT_A, ...fields }),
    );

  it("renaming to an email another tenant holds is an audited 409 UPDATE about the target", async () => {
    models.Users.findByPk.mockResolvedValue(target());
    held.email.add(TAKEN_EMAIL);

    await expect(editAs({ email: TAKEN_EMAIL })).rejects.toEqual({ status: 409, message: "Email already registered" });

    expect(conflictRows()).toHaveLength(1);
    expect(conflictRows()[0]).toMatchObject({
      tenantId: TENANT_A,
      userId: ADMIN_A,
      action: "UPDATE",
      resourceId: TARGET,
      changes: { operation: "IDENTITY_CONFLICT", outcome: "refused", field: "email" },
    });
  });

  it("a username rename that races into the index is an audited 409", async () => {
    const user = target();
    user.update = jest.fn(async () => {
      throw Object.assign(new Error("Validation error"), {
        name: "SequelizeUniqueConstraintError",
        fields: { username: "x" },
      });
    });
    models.Users.findByPk.mockResolvedValue(user);

    await expect(editAs({ username: "racer" })).rejects.toEqual({ status: 409, message: "Username already used" });
    expect(conflictRows()[0].changes.field).toBe("username");
  });

  it("an edit that changes no identity is not budgeted — even with the budget spent", async () => {
    held.email.add(TAKEN_EMAIL);
    for (let i = 0; i < BUDGET; i += 1) {
      await createAs({ email: TAKEN_EMAIL }).catch(() => {});
    }
    models.Users.findByPk.mockResolvedValue(target());

    await expect(editAs({ firstName: "Renamed" })).resolves.toMatchObject({ status: 200 });
    await expect(editAs({ email: "fresh@a.example.com" })).rejects.toMatchObject({ status: 429 });
  });
});
