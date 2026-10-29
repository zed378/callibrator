/**
 * A-110 — tenantHierarchy#getUserRolesAcrossTenants included Role and Tenant
 * under the aliases "Role" and "Tenant". The associations are `role` and
 * `tenant` (user.model.js), so Sequelize threw an eager-loading error before
 * any SQL was sent, and the catch-all turned it into `[]`: every user had "no
 * roles", and nothing said why.
 *
 * The existing unit tests mocked `User.findAll` and so could not see this — the
 * mock accepted any alias (CLAUDE.md: a mock proves the client, not the
 * contract).
 *
 * Technique (includes.a90.test.js): the REAL models barrel — real models, real
 * associations, real global tenant hooks — on an UNCONNECTED PostgreSQL-dialect
 * Sequelize whose `query` records the SQL and answers from a script.
 */
import type * as SequelizeModule from "sequelize";
import type * as TenantContextModule from "../../middlewares/tenantContext.middleware";
import type * as ActivityLogModule from "../../middlewares/activityLog.middleware";
import type * as TenantHierarchyModule from "../../services/tenantHierarchy.service";
import type { TenantId, UserId } from "../../types/ids";

const mockDb: { statements: string[]; rows: unknown[] | (() => unknown[]); fail: Error | null } = {
  statements: [],
  rows: [],
  fail: null,
};

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual<typeof SequelizeModule>("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = ((sql: string | { query: string }, options?: { plain?: boolean }) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockDb.statements.push(text);
    if (mockDb.fail) {
      return Promise.reject(mockDb.fail);
    }
    if (/^SELECT count\(/i.test(text)) {
      return Promise.resolve({ count: 0 });
    }
    const rows = typeof mockDb.rows === "function" ? mockDb.rows() : mockDb.rows;
    return Promise.resolve(options?.plain ? null : rows);
  }) as unknown as typeof db.query;
  return { db };
});
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  cacheKeys: { userPermissions: (id: string) => `user-perms:${id}` },
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const models = require("../../models") as {
  User: { build: (values: Record<string, unknown>, options?: Record<string, unknown>) => unknown };
};
const { tenantStorage } = require("../../middlewares/tenantContext.middleware") as typeof TenantContextModule;
const { logger } = require("../../middlewares/activityLog.middleware") as typeof ActivityLogModule;
const service = require("../../services/tenantHierarchy.service") as typeof TenantHierarchyModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT = "11111111-1111-4111-8111-111111111111" as TenantId;
const USER = "22222222-2222-4222-8222-222222222222" as UserId;

const asTenant = <T>(fn: () => T): T =>
  tenantStorage.run({ tenantId: TENANT, isSuperAdmin: false, isSystemTask: false }, fn);

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const joinType = (sql: string, table: string, alias: string): string | null => {
  const m = new RegExp(`(LEFT OUTER|INNER) JOIN "${esc(table)}" AS "${esc(alias)}"`).exec(sql);
  return m ? (m[1] as string) : null;
};

beforeEach(() => {
  mockDb.statements = [];
  mockDb.rows = [];
  mockDb.fail = null;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-110 — getUserRolesAcrossTenants", () => {
  it("sends one SELECT that LEFT-joins the `role` and `tenant` associations (it threw before any SQL)", async () => {
    await asTenant(() => service.getUserRolesAcrossTenants(USER));

    expect(mockDb.statements).toHaveLength(1);
    const [sql] = mockDb.statements as [string];
    expect(sql).toMatch(/^SELECT /);
    expect(joinType(sql, "roles", "role")).toBe("LEFT OUTER");
    expect(joinType(sql, "tenants", "tenant")).toBe("LEFT OUTER");
    expect(sql).toContain(`"User"."id" = '${USER}'`);
    // Role has no "level" column — it is role_level (roleLevel)
    expect(sql).toContain('"role"."role_level" AS "role.roleLevel"');
    expect(sql).not.toContain('"role"."level"');
    // and no credential column is read for this answer
    expect(sql).not.toMatch(/"User"\."(password|mfa_secret|otp_code)"/);
  });

  it("maps the joined role and tenant into the answer", async () => {
    // what the dialect hands back: User instances with the includes built
    mockDb.rows = () => [
      models.User.build(
        {
          id: USER,
          tenantId: TENANT,
          role: { id: "r1", name: "ADMIN", roleLevel: 80 },
          tenant: { id: TENANT, name: "RS Sehat", code: "RSS" },
        },
        { isNewRecord: false, include: [{ association: "role" }, { association: "tenant" }] },
      ),
    ];

    const result = await asTenant(() => service.getUserRolesAcrossTenants(USER));

    expect(result).toEqual([
      {
        tenantId: TENANT,
        tenantName: "RS Sehat",
        tenantCode: "RSS",
        role: { id: "r1", name: "ADMIN", level: 80 },
      },
    ]);
  });

  it("answers 500 and logs the cause when the query fails, instead of an empty list", async () => {
    mockDb.fail = new Error("connection reset");
    const logged = jest.spyOn(logger, "error").mockImplementation(() => logger);

    await expect(asTenant(() => service.getUserRolesAcrossTenants(USER))).rejects.toMatchObject({
      status: 500,
      message: "Failed to get user roles",
    });
    expect(logged).toHaveBeenCalledWith(
      "Failed to get user roles",
      expect.objectContaining({ userId: USER, error: "connection reset" }),
    );
  });
});
