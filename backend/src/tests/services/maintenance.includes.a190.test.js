/**
 * A-190 follow-up — CLAUDE.md's traps table calls the missing `required: false`
 * "latent on maintenance_work_orders". It is not (TASKS/AUDIT-2026-09-DATA.md
 * D-12 said so too): maintenance.service's two reads carry `required: false`
 * on every include. This pins it against the SQL Sequelize actually generates,
 * so a later edit that drops one — or a Sequelize upgrade that changes what an
 * include of a `defaultScope` model (User) turns into — fails here.
 *
 * Real models barrel, real associations, real global tenant hooks, on an
 * UNCONNECTED PostgreSQL-dialect Sequelize whose `query` records the SQL.
 */

const mockDb = { statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options = {}) => {
    mockDb.statements.push(typeof sql === "string" ? sql : sql.query);
    if (/count\(/i.test(mockDb.statements[mockDb.statements.length - 1])) {
      return options.plain ? { count: 0 } : [];
    }
    return options.plain ? null : [];
  };
  return { db };
});

const maintenance = require("../../services/maintenance.service");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const inTenant = (fn) => tenantStorage.run({ tenantId: TENANT }, fn);

const joinsOf = (sql) => [...sql.matchAll(/(LEFT OUTER|INNER) JOIN "(\w+)" AS "(\w+)"/g)].map((m) => [m[1], m[3]]);

beforeEach(() => {
  mockDb.statements = [];
});

describe("maintenance_work_orders reads never INNER JOIN an optional relation", () => {
  it("the list LEFT-joins device, vendor and assignee (a work order with no vendor or assignee is listed)", async () => {
    await inTenant(() => maintenance.fetchWorkOrders({ tenantId: TENANT }));

    const select = mockDb.statements.find((sql) => /^SELECT "MaintenanceWorkOrder"/.test(sql));
    expect(joinsOf(select)).toEqual([
      ["LEFT OUTER", "device"],
      ["LEFT OUTER", "vendor"],
      ["LEFT OUTER", "assignee"],
    ]);
  });

  it("the detail read LEFT-joins them too (a work order with no assignee is not 404)", async () => {
    await expect(inTenant(() => maintenance.getWorkOrderById(TENANT, "wo-1"))).rejects.toMatchObject({ status: 404 });

    const [select] = mockDb.statements;
    expect(joinsOf(select)).toEqual([
      ["LEFT OUTER", "device"],
      ["LEFT OUTER", "vendor"],
      ["LEFT OUTER", "assignee"],
    ]);
  });

  it("control: the same include of User WITHOUT required:false is an INNER JOIN (the trap is real)", async () => {
    const { MaintenanceWorkOrder, User } = require("../../models");

    await inTenant(() =>
      MaintenanceWorkOrder.findAll({ include: [{ model: User, as: "assignee", attributes: ["id"] }] }),
    );

    expect(joinsOf(mockDb.statements[0])).toEqual([["INNER", "assignee"]]);
  });
});
