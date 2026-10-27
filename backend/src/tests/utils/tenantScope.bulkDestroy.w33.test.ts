/**
 * W-33 — the tenant predicate on a bulk DESTROY names the column.
 *
 * `Model.destroy` maps attribute names to column names BEFORE it runs
 * `beforeBulkDestroy` (sequelize/lib/model.js: `Utils.mapOptionFieldNames`,
 * then `runHooks("beforeBulkDestroy")`), and nothing maps them again. The hook
 * added `tenantId`, which reached the DELETE verbatim: on PostgreSQL every
 * bulk destroy of an underscored model inside a tenant context failed with
 * `column "tenantId" does not exist`. Background jobs ran with no context, so
 * the hook skipped and nobody saw it; W-12 gave them one, and the retention
 * purge failed for every tenant on the first live run.
 *
 * Drives the REAL Sequelize Model class and PostgreSQL query generator with
 * the real hooks; only the wire is stubbed. The same statements are executed
 * on PostgreSQL 18 by backgroundJobs.w12.live.test.js.
 */
import { DataTypes, Sequelize } from "sequelize";
import type { Model, ModelStatic } from "sequelize";
import { register } from "../../utils/tenantScope.util";
import { runForTenant } from "../../utils/jobContext.util";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("W-33 — bulk destroy inside a tenant context", () => {
  let db: Sequelize;
  let Note: ModelStatic<Model>;
  let sql: string[];

  beforeAll(() => {
    db = new Sequelize("postgres://u:p@127.0.0.1:5432/none", { dialect: "postgres", logging: false });
    register(db as unknown as Parameters<typeof register>[0]);
    Note = db.define(
      "Note",
      {
        id: { type: DataTypes.UUID, primaryKey: true },
        tenantId: { type: DataTypes.UUID },
        title: { type: DataTypes.STRING },
      },
      { tableName: "notes", underscored: true },
    );
  });

  beforeEach(() => {
    sql = [];
    jest.spyOn(db, "query").mockImplementation((statement: unknown) => {
      sql.push(String(statement));
      return Promise.resolve(0) as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("the predicate is the COLUMN tenant_id, never the attribute tenantId", async () => {
    await runForTenant(TENANT_A, () => Note.destroy({ where: { title: "x" } }));

    expect(sql).toEqual([`DELETE FROM "notes" WHERE "title" = 'x' AND "tenant_id" = '${TENANT_A}'`]);
  });

  it("a bounded destroy carries it inside the LIMIT subquery", async () => {
    await runForTenant(TENANT_A, () => Note.destroy({ where: { title: "x" }, limit: 5 }));

    expect(sql).toEqual([
      `DELETE FROM "notes" WHERE "id" IN (SELECT "id" FROM "notes" WHERE "title" = 'x' AND "tenant_id" = '${TENANT_A}' LIMIT 5)`,
    ]);
  });

  it("a where naming another tenant is overridden, not AND-ed with an unknown column", async () => {
    await runForTenant(TENANT_A, () =>
      Note.destroy({ where: { tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } }),
    );

    expect(sql).toEqual([`DELETE FROM "notes" WHERE "tenant_id" = '${TENANT_A}'`]);
  });
});
