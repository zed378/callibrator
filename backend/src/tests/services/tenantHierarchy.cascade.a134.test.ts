/* eslint-disable no-restricted-properties -- the service reads HIERARCHY_* through config/env at module load; the test switches the flags */
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
import type * as SequelizeModule from "sequelize";
import type TenantHierarchyService from "../../services/tenantHierarchy.service";
import type * as ActivityLogModule from "../../middlewares/activityLog.middleware";
import type { TenantId } from "../../types/ids";

// Read at module load by the service, so set before anything is required.
process.env["HIERARCHY_ENABLED"] = "true";
process.env["HIERARCHY_CASCADE_ROLES"] = "true";

const mockDb: { statements: string[] } = { statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual<typeof SequelizeModule>("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  (db as unknown as { query: unknown }).query = (sql: string | { query: string }, options: { plain?: boolean } = {}) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockDb.statements.push(text);
    if (/^SELECT count\(/i.test(text)) { return Promise.resolve({ count: 0 }); }
    if (/^INSERT /i.test(text)) { return Promise.resolve([(options as { instance?: unknown }).instance, 1]); }
    if (text.includes('FROM "tenants"') && options.plain) {
      return Promise.resolve({
        id: "11111111-1111-4111-8111-111111111111",
        code: "PARENT",
        email: "admin@parent.example",
        status: "active",
        plan: "free",
      });
    }
    return Promise.resolve(options.plain ? null : []);
  };
  // A-187: createSubOrganization now writes in a managed transaction.
  (db as unknown as { transaction: unknown }).transaction = (cb: (tx: unknown) => Promise<unknown>) =>
    Promise.resolve(cb({ id: "tx" }));
  return { db };
});
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  cacheKeys: { userPermissions: (id: string): string => `user-perms:${id}` },
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as tenantHierarchy.userRoles.a110 does */
require("../../models");
const models = require("../../models") as {
    Role: {
        rawAttributes: Record<string, unknown>;
        findAll: jest.Mock;
        findByPk: jest.Mock;
        findOne: jest.Mock;
        create: jest.Mock;
    };
    User: { findAll: jest.Mock };
    RoleMenuPermission: {
        rawAttributes: Record<string, unknown>;
        findAll: jest.Mock;
        findOrCreate: jest.Mock;
    };
};
const { tenantStorage } = require("../../middlewares/tenantContext.middleware") as { tenantStorage: { run<T>(store: object, fn: () => T): T } };
const { logger } = require("../../middlewares/activityLog.middleware") as typeof ActivityLogModule;
const svc = require("../../services/tenantHierarchy.service") as typeof TenantHierarchyService;
/* eslint-enable @typescript-eslint/no-require-imports */

const PARENT = "11111111-1111-4111-8111-111111111111" as TenantId;

beforeEach(() => {
  mockDb.statements = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  delete process.env["HIERARCHY_ENABLED"];
  delete process.env["HIERARCHY_CASCADE_ROLES"];
});

describe("A-134 — why the role cascade was removed, read from the real models", () => {
  it("roles are global: Role has no tenantId, no `level`, and a platform-unique name", () => {
    const attrs = models.Role.rawAttributes;

    expect(attrs).not.toHaveProperty("tenantId");
    expect(attrs).not.toHaveProperty("level");
    expect((attrs["roleLevel"] as { field?: string } | undefined)?.field).toBe("role_level");
    expect((attrs["name"] as { unique?: boolean } | undefined)?.unique).toBe(true);
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
    // No stub: A-187 made Tenant.create pass the real model's validation
    // (subdomain and email were NOT NULL and unset — the defect reported with
    // A-134).
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
      svc.createSubOrganization(PARENT, { name: "Branch A" }, { userId: "44444444-4444-4444-8444-444444444444" }),
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
