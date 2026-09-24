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

const mockDb = { statements: [], rows: [], fail: null };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockDb.statements.push(text);
    if (mockDb.fail) {throw mockDb.fail;}
    if (/^SELECT count\(/i.test(text)) {return { count: 0 };}
    const rows = typeof mockDb.rows === "function" ? mockDb.rows() : mockDb.rows;
    return options && options.plain ? null : rows;
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
const service = require("../../services/tenantHierarchy.service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const asTenant = (fn) => tenantStorage.run({ tenantId: TENANT }, fn);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const joinType = (sql, table, alias) => {
  const m = sql.match(new RegExp(`(LEFT OUTER|INNER) JOIN "${esc(table)}" AS "${esc(alias)}"`));
  return m ? m[1] : null;
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
    const [sql] = mockDb.statements;
    expect(sql).toMatch(/^SELECT /);
    expect(joinType(sql, "roles", "role")).toBe("LEFT OUTER");
    expect(joinType(sql, "tenants", "tenant")).toBe("LEFT OUTER");
    expect(sql).toContain(`"User"."id" = '${USER}'`);
    // Role has no "level" column — it is role_level (roleLevel)
    expect(sql).toContain("\"role\".\"role_level\" AS \"role.roleLevel\"");
    expect(sql).not.toContain("\"role\".\"level\"");
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
    const logged = jest.spyOn(logger, "error").mockImplementation(() => {});

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
