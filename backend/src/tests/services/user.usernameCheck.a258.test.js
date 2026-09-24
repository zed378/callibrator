/**
 * A-258 — POST /users/username-check answered a different question from the
 * create it serves.
 *
 * It was `Users.findOne({ where: { username: { [Op.like]: input } } })` under
 * the tenant hooks, while `users.username` is unique ACROSS tenants (Q-18):
 *  - a name another tenant holds, or a soft-deleted account holds, was
 *    "available", and the create then failed on the index;
 *  - LIKE is case-sensitive in PostgreSQL: "Alice" held made "alice" available;
 *  - the raw input was a LIKE pattern (the Joi schema happens to refuse `_`
 *    and `%` today; the service did not).
 * It now runs userCreate's own check (assertIdentityFree), and a "taken"
 * answer to a tenant administrator is the A-128 oracle: budgeted and audited.
 *
 * Same harness as user.identityConflict.a128.test.js: the real models barrel
 * (tenant hooks and User defaultScope included) on an unconnected
 * PostgreSQL-dialect Sequelize whose SELECTs are recorded as SQL, the real
 * rate limiter on its in-process store, and the auditLedger for transactions
 * and audit rows.
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, sql: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options = {}) => {
    mockRef.sql.push(String(sql));
    return options.plain ? null : [];
  };
  db.transaction = (...args) => mockRef.ledger.transaction(...args);
  return { db };
});
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const models = require("../../models");
const userService = require("../../services/user.service");
const { clearMemoryStore } = require("../../services/rateLimiter.redis.service");
const { getAuthConfig } = require("../../constants/rateLimitConstants");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const SUPER_ADMIN = "99999999-9999-4999-8999-999999999999";
const BUDGET = getAuthConfig("userIdentityConflict").maxAttempts;

const probe = (username, overrides = {}) =>
  tenantStorage.run({ tenantId: TENANT_A }, () =>
    userService.checkUsernameAvailability({
      username,
      actorId: ADMIN_A,
      actorTenantId: TENANT_A,
      actorIsSuperAdmin: false,
      ipAddress: "192.0.2.10",
      userAgent: "admin-browser",
      ...overrides,
    }),
  );

const conflictRows = () =>
  mockRef.ledger.auditRows().filter((r) => r.changes && r.changes.operation === "IDENTITY_CONFLICT");

/** Makes the lookup find a holder for exactly these (lower-cased) usernames. */
const holding = (...names) =>
  jest.spyOn(models.Users, "findOne").mockImplementation(async (options) => {
    const where = options.where.username;
    const pattern = where[Object.getOwnPropertySymbols(where)[0]];
    return names.includes(pattern.replace(/\\(.)/g, "$1").toLowerCase()) ? { id: "holder" } : null;
  });

beforeEach(() => {
  mockRef.ledger = createLedger();
  mockRef.sql = [];
  clearMemoryStore();
  jest.spyOn(models.AuditLog, "create").mockImplementation((...args) => mockRef.ledger.AuditLog.create(...args));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-258: the probe asks the question the create asks", () => {
  it("the SQL is an exact, case-insensitive match across tenants, soft-deleted accounts included", async () => {
    const result = await probe("  AliCe ");

    expect(result.data).toEqual({ username: "alice", available: true });
    const select = mockRef.sql.find((q) => /FROM "users"/.test(q));
    expect(select).toMatch(/"username" ILIKE 'alice'/);
    // Global: no tenant predicate, although the probe ran inside tenant A's context.
    expect(select).not.toMatch(/tenant_id/);
    expect(select).not.toContain(TENANT_A);
    // A soft-deleted account still holds its name in the unique index.
    expect(select).not.toMatch(/deleted_at" IS NULL/);
    expect(select).not.toMatch(/"is_deleted" = false/);
  });

  it("a LIKE wildcard in the input matches only itself", async () => {
    await userService.checkUsernameAvailability({ username: "a_b%", actorIsSuperAdmin: true });
    const select = mockRef.sql.find((q) => /FROM "users"/.test(q));
    expect(select).toMatch(/ILIKE 'a\\_b\\%'/);
  });

  it("a name held in another tenant, or in another case, is taken — as userCreate would refuse it", async () => {
    holding("nurse");

    const result = await probe("Nurse");
    expect(result.data).toEqual({ username: "nurse", available: false });
    expect(result.message).toBe("Username is already taken");

    await expect(
      tenantStorage.run({ tenantId: TENANT_A }, () =>
        userService.userCreate({
          username: "Nurse",
          firstName: "Nora",
          lastName: "Nurse",
          email: "n@hospital-a.example.com",
          password: "Str0ng!Passw0rd",
          roleId: "33333333-3333-4333-8333-333333333333",
          createdBy: ADMIN_A,
          actorTenantId: TENANT_A,
          actorIsSuperAdmin: false,
        }),
      ),
    ).rejects.toEqual({ status: 409, message: "Username already used" });
  });
});

describe("A-258: a 'taken' answer is the A-128 oracle — budgeted and audited", () => {
  it("each 'taken' is one audit row in the admin's tenant that never names the value", async () => {
    holding("held-name");

    await probe("held-name");

    expect(conflictRows()).toHaveLength(1);
    const [row] = conflictRows();
    expect(row).toMatchObject({
      tenantId: TENANT_A,
      userId: ADMIN_A,
      action: "CREATE",
      resourceType: "User",
      resourceId: null,
      changes: { operation: "IDENTITY_CONFLICT", outcome: "reported_taken", field: "username" },
      ipAddress: "192.0.2.10",
      userAgent: "admin-browser",
    });
    expect(JSON.stringify(row)).not.toContain("held-name");
  });

  it("an available answer is neither counted nor audited", async () => {
    holding();
    for (let i = 0; i < BUDGET + 2; i += 1) {
      expect((await probe(`free${i}`)).data.available).toBe(true);
    }
    expect(conflictRows()).toEqual([]);
  });

  it("past the budget the probe is 429 BEFORE any lookup, so a spent budget learns nothing", async () => {
    const spy = holding("taken");
    for (let i = 0; i < BUDGET; i += 1) {
      await probe("taken");
    }
    spy.mockClear();

    await expect(probe("anything")).rejects.toMatchObject({ status: 429 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("the budget is shared with userCreate's conflicts", async () => {
    holding("taken");
    for (let i = 0; i < BUDGET; i += 1) {
      await probe("taken");
    }
    await expect(
      tenantStorage.run({ tenantId: TENANT_A }, () =>
        userService.userCreate({
          username: "fresh",
          firstName: "Fresh",
          lastName: "Person",
          email: "f@hospital-a.example.com",
          password: "Str0ng!Passw0rd",
          roleId: "33333333-3333-4333-8333-333333333333",
          createdBy: ADMIN_A,
          actorTenantId: TENANT_A,
          actorIsSuperAdmin: false,
        }),
      ),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("a super admin is neither limited nor audited", async () => {
    holding("taken");
    for (let i = 0; i < BUDGET + 1; i += 1) {
      const result = await probe("taken", { actorId: SUPER_ADMIN, actorIsSuperAdmin: true });
      expect(result.data.available).toBe(false);
    }
    expect(conflictRows()).toEqual([]);
  });

  it("a 'taken' whose audit row cannot be written is not answered", async () => {
    holding("taken");
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));
    await expect(probe("taken")).rejects.toMatchObject({ status: 500, message: "audit insert failed" });
  });
});
