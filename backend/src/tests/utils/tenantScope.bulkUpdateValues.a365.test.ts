/**
 * A-365 (F-4 of docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md § 9) — a bulk
 * UPDATE inside a tenant context may not re-own rows to another tenant.
 *
 * `beforeBulkUpdate` scoped the WHERE and never read the VALUES:
 * `Note.update({ tenantId: B }, { where })` inside tenant A matched A's rows
 * and moved them to B. Drives the REAL Sequelize Model class and PostgreSQL
 * query generator with the real hooks; only the wire is stubbed (as W-33).
 *
 * Fail-before: "refuses a value naming another tenant" (the UPDATE was sent,
 * `SET "tenant_id"=$1 ... WHERE ... AND "tenant_id" = $4`, $1 = B, $4 = A).
 */
import { DataTypes, Sequelize } from "sequelize";
import type { ModelStatic, Model } from "sequelize";
import { register } from "../../utils/tenantScope.util";
import { runForTenant } from "../../utils/jobContext.util";
import { tenantStorage } from "../../middlewares/tenantContext.middleware";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("A-365 — a bulk update's values cannot move rows to another tenant", () => {
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
      { tableName: "notes", underscored: true, timestamps: false },
    );
  });

  beforeEach(() => {
    sql = [];
    jest.spyOn(db, "query").mockImplementation((statement: unknown) => {
      // An UPDATE reaches the wire as { query, bind }.
      sql.push(typeof statement === "object" && statement !== null ? String((statement as { query?: unknown }).query) : String(statement));
      return Promise.resolve([[], 0]) as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses a value naming another tenant, before any statement is sent", async () => {
    await expect(
      runForTenant(TENANT_A, () => Note.update({ tenantId: TENANT_B }, { where: { title: "x" } })),
    ).rejects.toThrow("Security Violation: Attempted to bulk-update the tenant column to another tenant");
    expect(sql).toEqual([]);
  });

  it("allows the context's own tenant (a no-op value) and still scopes the WHERE", async () => {
    await runForTenant(TENANT_A, () => Note.update({ tenantId: TENANT_A, title: "y" }, { where: { title: "x" } }));
    expect(sql).toHaveLength(1);
    expect(sql[0]).toBe('UPDATE "notes" SET "tenant_id"=$1,"title"=$2 WHERE "title" = $3 AND "tenant_id" = $4');
  });

  it("leaves an update that does not touch the tenant column alone", async () => {
    await runForTenant(TENANT_A, () => Note.update({ title: "y" }, { where: { title: "x" } }));
    expect(sql).toHaveLength(1);
  });

  it("does not apply to a system task (skip scope), as no tenant hook does", async () => {
    await tenantStorage.run({ tenantId: null, isSuperAdmin: false, isSystemTask: true }, () =>
      Note.update({ tenantId: TENANT_B }, { where: { title: "x" } }),
    );
    expect(sql).toHaveLength(1);
  });

  it("does not apply outside any context", async () => {
    await Note.update({ tenantId: TENANT_B }, { where: { title: "x" } });
    expect(sql).toHaveLength(1);
  });
});
