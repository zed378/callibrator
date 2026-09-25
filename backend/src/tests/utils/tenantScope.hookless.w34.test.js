/**
 * W-34 — the Sequelize statics that run NO tenant hook.
 *
 * In Sequelize 6.37.8 (`lib/model.js`) `aggregate` runs no hook, and `sum`,
 * `min` and `max` are `this.aggregate(...)`; static `increment` runs no hook,
 * and `decrement` and the instance forms end in it; `restore` fires
 * `beforeBulkRestore` / `beforeRestore`, which were never registered; and
 * `destroy({ truncate: true })` becomes a TRUNCATE with no WHERE. Each of these
 * reached the database with no tenant predicate unless its author wrote one.
 *
 * Drives the REAL Sequelize Model class and PostgreSQL query generator with
 * the real hooks; only the wire is stubbed. The same calls are executed on
 * PostgreSQL 18 by tenantHookless.w34.live.test.js.
 */
const { Sequelize, DataTypes } = require("sequelize");
const { register, NO_TENANT_UUID } = require("../../utils/tenantScope.util");
const { runForTenant } = require("../../utils/jobContext.util");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("W-34 — hookless statics on a tenant-scoped model", () => {
  let db;
  let Item;
  let Owner;
  let Global;
  let sql;

  beforeAll(() => {
    db = new Sequelize("postgres://u:p@127.0.0.1:5432/none", { dialect: "postgres", logging: false });
    register(db);
    Owner = db.define(
      "Owner",
      { id: { type: DataTypes.UUID, primaryKey: true }, tenantId: { type: DataTypes.UUID } },
      { tableName: "owners", underscored: true, timestamps: false },
    );
    Item = db.define(
      "Item",
      {
        id: { type: DataTypes.UUID, primaryKey: true },
        tenantId: { type: DataTypes.UUID },
        ownerId: { type: DataTypes.UUID },
        qty: { type: DataTypes.INTEGER },
      },
      { tableName: "items", underscored: true, paranoid: true },
    );
    Item.belongsTo(Owner, { as: "owner", foreignKey: "ownerId" });
    Global = db.define(
      "Global",
      { id: { type: DataTypes.UUID, primaryKey: true }, qty: { type: DataTypes.INTEGER } },
      { tableName: "globals", timestamps: false },
    );
  });

  beforeEach(() => {
    sql = [];
    jest.spyOn(db, "query").mockImplementation(async (statement, options = {}) => {
      // A bulk UPDATE arrives as { query, bind }: inline the binds to read it.
      let text = typeof statement === "string" ? statement : statement.query;
      const bind = (statement && statement.bind) || options.bind || [];
      text = text.replace(/\$(\d+)/g, (m, i) => (bind[i - 1] === null ? "NULL" : `'${bind[i - 1]}'`));
      sql.push(text);
      return null;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  describe("aggregate, sum, min, max", () => {
    it.each(["sum", "min", "max"])("%s inside a tenant context carries the tenant predicate with no where of its own", async (fn) => {
      await runForTenant(A, () => Item[fn]("qty"));

      expect(sql).toHaveLength(1);
      expect(sql[0]).toContain(`"Item"."tenant_id" = '${A}'`);
    });

    it("aggregate itself is scoped, and a where naming another tenant is overridden", async () => {
      await runForTenant(A, () => Item.aggregate("qty", "sum", { where: { tenantId: B } }));

      expect(sql[0]).toContain(`"Item"."tenant_id" = '${A}'`);
      expect(sql[0]).not.toContain(B);
    });

    it("an include inside sum is scoped in its ON clause too", async () => {
      await runForTenant(A, () =>
        Item.sum("qty", { include: [{ model: Owner, as: "owner", attributes: [] }] }),
      );

      expect(sql[0]).toMatch(new RegExp(`LEFT OUTER JOIN "owners" AS "owner" ON .*"owner"."tenant_id" = '${A}'`));
    });

    it("does not mutate the caller's options", async () => {
      const options = { where: { qty: 1 } };
      await runForTenant(A, () => Item.sum("qty", options));

      expect(options).toEqual({ where: { qty: 1 } });
    });

    it("count carries the predicate exactly once", async () => {
      await runForTenant(A, () => Item.count({ where: { qty: 1 } }));

      expect(sql[0].split(`"tenant_id" = '${A}'`)).toHaveLength(2);
    });

    it("a principal with no resolvable tenant sums nothing (deny)", async () => {
      await tenantStorage.run({ tenantId: null, isSuperAdmin: false }, () => Item.sum("qty"));

      expect(sql[0]).toContain(`"tenant_id" = '${NO_TENANT_UUID}'`);
    });

    it("skipTenantScope is the opt-out; no context and the super admin skip", async () => {
      await runForTenant(A, () => Item.sum("qty", { skipTenantScope: true }));
      await Item.sum("qty");
      await tenantStorage.run({ tenantId: A, isSuperAdmin: true }, () => Item.sum("qty"));

      expect(sql.every((s) => !s.includes("tenant_id"))).toBe(true);
    });

    it("a model with no tenant key is left alone", async () => {
      await runForTenant(A, () => Global.sum("qty"));

      expect(sql[0]).not.toContain("tenant");
      expect(Object.prototype.hasOwnProperty.call(Global, "aggregate")).toBe(false);
    });
  });

  describe("increment and decrement", () => {
    it("static increment carries the tenant COLUMN after Sequelize maps it", async () => {
      await runForTenant(A, () => Item.increment("qty", { where: { id: "i1" } }));

      expect(sql[0]).toMatch(/^UPDATE "items" SET "qty"="qty"\+ 1/);
      expect(sql[0]).toContain(`"tenant_id" = '${A}'`);
      expect(sql[0]).not.toContain("\"tenantId\"");
    });

    it("decrement goes through the same wrapper", async () => {
      await runForTenant(A, () => Item.decrement("qty", { where: { id: "i1" } }));

      expect(sql[0]).toContain("\"qty\"=\"qty\"- 1");
      expect(sql[0]).toContain(`"tenant_id" = '${A}'`);
    });

    it("an instance increment of another tenant's row carries the caller's tenant, so it matches nothing", async () => {
      const foreign = Item.build({ id: "i1", tenantId: B, qty: 1 }, { isNewRecord: false });
      await runForTenant(A, () => foreign.increment("qty"));

      expect(sql[0]).toContain(`"tenant_id" = '${A}'`);
    });

    it("a non-plain where is AND-ed, not spread", async () => {
      const where = db.where(db.col("qty"), ">", 1);
      await runForTenant(A, () => Item.increment("qty", { where }));

      expect(sql[0]).toContain("\"qty\" > 1");
      expect(sql[0]).toContain(`"tenant_id" = '${A}'`);
    });

    it("a principal with no resolvable tenant increments nothing (deny)", async () => {
      await tenantStorage.run({ tenantId: null, isSuperAdmin: false }, () =>
        Item.increment("qty", { where: { id: "i1" } }),
      );

      expect(sql[0]).toContain(`"tenant_id" = '${NO_TENANT_UUID}'`);
    });

    it("with no where it is still refused by Sequelize, not widened to the whole tenant", async () => {
      await expect(runForTenant(A, () => Item.increment("qty", {}))).rejects.toThrow("Missing where");
      await expect(runForTenant(A, () => Item.increment("qty"))).rejects.toThrow("Missing where");
      expect(sql).toEqual([]);
    });

    it("skipTenantScope and a context-free caller get no predicate", async () => {
      await runForTenant(A, () => Item.increment("qty", { where: { id: "i1" }, skipTenantScope: true }));
      await Item.increment("qty", { where: { id: "i1" } });

      expect(sql.every((s) => !s.includes("tenant_id"))).toBe(true);
    });
  });

  describe("restore and truncate", () => {
    it("a bulk restore carries the tenant COLUMN", async () => {
      await runForTenant(A, () => Item.restore({ where: { qty: 1 } }));

      expect(sql[0]).toMatch(/^UPDATE "items" SET "deleted_at"=NULL/);
      expect(sql[0]).toContain(`"tenant_id" = '${A}'`);
      expect(sql[0]).not.toContain("\"tenantId\"");
    });

    it("an instance restore of another tenant's row is refused", async () => {
      const foreign = Item.build({ id: "i1", tenantId: B, qty: 1, deletedAt: new Date() }, { isNewRecord: false });

      await expect(runForTenant(A, () => foreign.restore())).rejects.toThrow("cross-tenant");
      expect(sql).toEqual([]);
    });

    it("a truncate inside a tenant context is refused; outside one it runs", async () => {
      await expect(runForTenant(A, () => Item.destroy({ truncate: true, force: true }))).rejects.toThrow(
        "truncate a tenant-scoped table",
      );
      expect(sql).toEqual([]);

      await Item.destroy({ truncate: true, force: true });
      expect(sql[0]).toMatch(/^TRUNCATE "items"/);
    });
  });

  it("a model defined after register is wrapped once, and a model is never wrapped twice", () => {
    const { scopeHooklessStatics } = require("../../utils/tenantScope.util");
    const wrapped = Item.aggregate;
    scopeHooklessStatics(Item);

    expect(Item.aggregate).toBe(wrapped);
    expect(scopeHooklessStatics(null)).toBeUndefined();
  });
});
