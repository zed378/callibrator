/**
 * A-134 — `tenantHierarchy#cascadeRoles` never worked, and is removed.
 *
 * With HIERARCHY_CASCADE_ROLES=true, createSubOrganization called
 * `User.findAll({ include: [Role] })` — alias-less, while the association is
 * `role` — so Sequelize threw before any SQL, and the catch logged
 * "Role cascade failed (non-fatal)". Had it got further it would have written
 * `Role.level` and `Role.tenantId`, neither of which exists: roles are global
 * (no tenantId, `name` unique platform-wide), so every role and its menu
 * permissions already apply in a child tenant. There is nothing to cascade.
 *
 * The earlier unit tests mocked User/Role and so asserted the broken call
 * shape as correct (CLAUDE.md: a mock proves the client, not the contract).
 * These run against the REAL models barrel — real models, real associations,
 * real global tenant hooks — on an UNCONNECTED PostgreSQL-dialect Sequelize
 * whose `query` records the SQL (technique of tenantHierarchy.userRoles.a110).
 */

// Read at module load by the service, so set before anything is required.
process.env.HIERARCHY_ENABLED = "true";
process.env.HIERARCHY_CASCADE_ROLES = "true";

const mockDb = { statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options = {}) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockDb.statements.push(text);
    if (/^SELECT count\(/i.test(text)) {return { count: 0 };}
    if (/^INSERT /i.test(text)) {return [options.instance, 1];}
    if (/FROM "tenants"/.test(text) && options.plain) {
      return {
        id: "11111111-1111-4111-8111-111111111111",
        code: "PARENT",
        status: "active",
        plan: "free",
      };
    }
    return options.plain ? null : [];
  };
  return { db };
});
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  cacheKeys: { userPermissions: (id) => `user-perms:${id}` },
}));

const models = require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const { logger } = require("../../middlewares/activityLog.middleware");

const svc = require("../../services/tenantHierarchy.service");

const PARENT = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  mockDb.statements = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  delete process.env.HIERARCHY_ENABLED;
  delete process.env.HIERARCHY_CASCADE_ROLES;
});

describe("A-134 — why the role cascade was removed, read from the real models", () => {
  it("roles are global: Role has no tenantId, no `level`, and a platform-unique name", () => {
    const attrs = models.Role.rawAttributes;

    expect(attrs).not.toHaveProperty("tenantId");
    expect(attrs).not.toHaveProperty("level");
    expect(attrs.roleLevel.field).toBe("role_level");
    expect(attrs.name.unique).toBe(true);
    // RoleMenuPermission hangs off roleId alone — no tenant column either.
    expect(models.RoleMenuPermission.rawAttributes).not.toHaveProperty("tenantId");
  });

  it("the former call `User.findAll({ include: [Role] })` throws before any SQL (alias `role`)", async () => {
    await expect(
      tenantStorage.run({ tenantId: PARENT }, () =>
        models.User.findAll({ where: { tenantId: PARENT }, include: [models.Role] }),
      ),
    ).rejects.toThrow(/alias/i);
    expect(mockDb.statements).toHaveLength(0);
  });
});

describe("A-134 — createSubOrganization with HIERARCHY_CASCADE_ROLES=true", () => {
  it("creates the child tenant and reads or writes no role, user or permission row", async () => {
    // Tenant.create is the one stub. On the real model it fails validation
    // (subdomain and email are NOT NULL and createSubOrganization sets
    // neither) — a separate defect, reported with A-134, not fixed here.
    jest
      .spyOn(models.Tenant, "create")
      .mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333" });
    const warn = jest.spyOn(logger, "warn");
    const spies = [
      jest.spyOn(models.User, "findAll"),
      jest.spyOn(models.Role, "findByPk"),
      jest.spyOn(models.Role, "findOne"),
      jest.spyOn(models.Role, "create"),
      jest.spyOn(models.RoleMenuPermission, "findAll"),
      jest.spyOn(models.RoleMenuPermission, "findOrCreate"),
    ];
    const result = await tenantStorage.run({ tenantId: PARENT }, () =>
      svc.createSubOrganization(PARENT, { name: "Branch A" }),
    );

    expect(result).toMatchObject({ code: "PARENT_001", depth: 1 });
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(warn).not.toHaveBeenCalledWith("Role cascade failed (non-fatal)", expect.anything());
    const touched = mockDb.statements.filter((sql) =>
      /"(roles|role_menu_permissions|users)"/.test(sql),
    );
    expect(touched).toEqual([]);
  });

  it("getStatus no longer reports a cascade flag", () => {
    expect(svc.getStatus()).toEqual({ enabled: true, maxDepth: 5 });
  });
});
