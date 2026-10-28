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
import type * as SequelizeModule from "sequelize";

const mockDb: { statements: string[] } = { statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual<typeof SequelizeModule>("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  (db as unknown as { query: unknown }).query = (
    sql: string | { query: string },
    options: { plain?: boolean } = {},
  ) => {
    mockDb.statements.push(typeof sql === "string" ? sql : sql.query);
    if (/count\(/i.test(mockDb.statements[mockDb.statements.length - 1] ?? "")) {
      return Promise.resolve(options.plain ? { count: 0 } : []);
    }
    return Promise.resolve(options.plain ? null : []);
  };
  return { db };
});

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as includes.a90 does */
require("../../models");
const maintenance = require("../../services/maintenance.service") as {
    fetchWorkOrders: (q: Record<string, unknown>) => Promise<unknown>;
    getWorkOrderById: (tenantId: string, orderId: string) => Promise<unknown>;
};
const { tenantStorage } = require("../../middlewares/tenantContext.middleware") as {
    tenantStorage: { run<T>(store: object, fn: () => T): T };
};
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const inTenant = <T>(fn: () => T): T => tenantStorage.run({ tenantId: TENANT }, fn);

const joinsOf = (sql: string): (readonly [string, string])[] =>
  [...sql.matchAll(/(LEFT OUTER|INNER) JOIN "(\w+)" AS "(\w+)"/g)].map(
    (m) => [m[1] ?? "", m[3] ?? ""] as const,
  );

beforeEach(() => {
  mockDb.statements = [];
});

describe("maintenance_work_orders reads never INNER JOIN an optional relation", () => {
  it("the list LEFT-joins device, vendor and assignee (a work order with no vendor or assignee is listed)", async () => {
    await inTenant(() => maintenance.fetchWorkOrders({ tenantId: TENANT }));

    const select = mockDb.statements.find((sql) => sql.startsWith("SELECT \"MaintenanceWorkOrder\"")) ?? "";
    expect(joinsOf(select)).toEqual([
      ["LEFT OUTER", "device"],
      ["LEFT OUTER", "vendor"],
      ["LEFT OUTER", "assignee"],
    ]);
  });

  it("the detail read LEFT-joins them too (a work order with no assignee is not 404)", async () => {
    await expect(inTenant(() => maintenance.getWorkOrderById(TENANT, "wo-1"))).rejects.toMatchObject({
      status: 404,
    });

    const [select = ""] = mockDb.statements;
    expect(joinsOf(select)).toEqual([
      ["LEFT OUTER", "device"],
      ["LEFT OUTER", "vendor"],
      ["LEFT OUTER", "assignee"],
    ]);
  });

  it("control: the same include of User WITHOUT required:false is an INNER JOIN (the trap is real)", async () => {
    /* eslint-disable @typescript-eslint/no-require-imports -- the control needs the model, not the service */
    const { MaintenanceWorkOrder, User } = require("../../models") as {
            MaintenanceWorkOrder: { findAll: (q: Record<string, unknown>) => Promise<unknown> };
            User: unknown;
        };
    /* eslint-enable @typescript-eslint/no-require-imports */

    await inTenant(() =>
      MaintenanceWorkOrder.findAll({ include: [{ model: User, as: "assignee", attributes: ["id"] }] }),
    );

    expect(joinsOf(mockDb.statements[0] ?? "")).toEqual([["INNER", "assignee"]]);
  });
});
