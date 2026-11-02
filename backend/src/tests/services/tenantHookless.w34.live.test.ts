/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
/**
 * W-34 against a REAL PostgreSQL 18 — the statics that ran no tenant hook.
 *
 * `sum`/`min`/`max`/`aggregate`, static `increment`/`decrement` and `restore`
 * reached the database with no tenant predicate unless the caller wrote one.
 * tenantScope.hookless.w34.test.js proves the SQL the generator builds; this
 * proves what PostgreSQL does with it: tenant A's calls see and change only
 * A's rows, with NO tenant in their own `where`.
 *
 * NEEDS — the suite builds its database the way the backend boots
 * (fixtures/liveBoot#bootSchema: db.sync() of the current models plus every
 * migration) before it switches role; on a built database that applies
 * nothing. (It used to ASSUME a built database: on a fresh one every case
 * failed in beforeAll with no message — 2026-10-08, the live-suites repair.)
 *
 *   DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... DB_PASS=... \
 *     npm run test:live:jest -- src/tests/services/tenantHookless.w34.live
 *
 * It creates two tenants with fixed ids and removes everything it wrote.
 *
 * A-283 (2026-09-30): it runs as `callibrator_app` (enterApplicationRole, with
 * its boot self-check), never as the owner, and says so: isolation is proved
 * on the role the application uses. The rows it writes carry no audit row, so
 * the cleanup DELETEs are ones the role may make.
 */
const { bootSchema, enterAppRole, APP_ROLE } = require("../fixtures/liveBoot");

const A = "a34a34a3-0000-4000-8000-0000000000a1";
const B = "b34b34b3-0000-4000-8000-0000000000b1";
const WH: any = { [A]: "a34a34a3-0000-4000-8000-0000000000f1", [B]: "b34b34b3-0000-4000-8000-0000000000f2" };
const STOCK = {
  a1: "a34a34a3-0000-4000-8000-00000000c0a1",
  a2: "a34a34a3-0000-4000-8000-00000000c0a2",
  b1: "b34b34b3-0000-4000-8000-00000000c0b1",
  b2: "b34b34b3-0000-4000-8000-00000000c0b2"
};

describe("W-34 — hookless statics on live PostgreSQL", () => {
  jest.setTimeout(60000);
  let db: any;
  let Stock: any;
  let runForTenant: any;

  const q = async (sql: any, replacements: any = {}) => (await db.query(sql, { replacements }))[0];
  const qty = async (id: any) => (await q("SELECT quantity FROM stocks WHERE id = :id", { id }))[0].quantity;

  const cleanup = async () => {
    await q("DELETE FROM stocks WHERE tenant_id IN (:t)", { t: [A, B] });
    await q("DELETE FROM warehouses WHERE tenant_id IN (:t)", { t: [A, B] });
    await q("DELETE FROM tenants WHERE id IN (:t)", { t: [A, B] });
  };

  const seed = async () => {
    await q("DELETE FROM stocks WHERE tenant_id IN (:t)", { t: [A, B] });
    const entries: [string, string, number][] = [
      [STOCK.a1, A, 3],
      [STOCK.a2, A, 4],
      [STOCK.b1, B, 100],
      [STOCK.b2, B, 1000]
    ];
    for (const [id, tenantId, quantity] of entries) {
      await q(
        `INSERT INTO stocks (id, tenant_id, warehouse_id, item_name, quantity, min_quantity, is_deleted, created_at, updated_at)
         VALUES (:id, :tenantId, :wh, 'w34', :quantity, 0, false, now(), now())`,
        { id, tenantId, wh: (WH as any)[tenantId], quantity }
      );
    }
  };

  beforeAll(async () => {
    ({ db } = require("../../config"));
    db.options.logging = false;
    ({ Stock } = require("../../models"));
    ({ runForTenant } = require("../../utils/jobContext.util"));
    await bootSchema(db, require("../../config/migrator").migrator);
    await enterAppRole(db);
    await cleanup();
    const tenants: [string, string][] = [
      [A, "w34-live-a"],
      [B, "w34-live-b"]
    ];
    for (const [id, sub] of tenants) {
      await q(
        `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
         VALUES (:id, :sub, :sub, :email, now(), now())`,
        { id, sub, email: `${sub}@example.test` }
      );
      await q(
        `INSERT INTO warehouses (id, tenant_id, name, code, is_deleted, created_at, updated_at)
         VALUES (:wh, :id, 'W34', 'W34', false, now(), now())`,
        { wh: (WH as any)[id], id }
      );
    }
  });

  beforeEach(seed);

  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.close();
    }
  });

  it("runs as callibrator_app, not the owner", async () => {
    const [row] = await q("SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS s");
    expect(row).toEqual({ u: APP_ROLE, s: false });
  });

  it("tenant A's sum excludes tenant B's rows without an explicit where", async () => {
    expect(await Stock.sum("quantity", { skipTenantScope: true })).toBeGreaterThanOrEqual(1107);
    expect(await runForTenant(A, () => Stock.sum("quantity"))).toBe(7);
    expect(await runForTenant(B, () => Stock.sum("quantity"))).toBe(1100);
  });

  it("min, max, aggregate and count see only the caller's tenant", async () => {
    await runForTenant(A, async () => {
      expect(await Stock.min("quantity")).toBe(3);
      expect(await Stock.max("quantity")).toBe(4);
      expect(Number(await Stock.aggregate("quantity", "sum"))).toBe(7);
      expect(await Stock.count({ where: { itemName: "w34" } })).toBe(2);
    });
  });

  it("a where naming tenant B inside tenant A's context sums A's rows, not B's", async () => {
    expect(await runForTenant(A, () => Stock.sum("quantity", { where: { tenantId: B } }))).toBe(7);
  });

  it("static increment and decrement with no tenant in the where change only A's rows", async () => {
    await runForTenant(A, () => Stock.unscoped().increment("quantity", { by: 10, where: { itemName: "w34" } }));
    await runForTenant(A, () => Stock.unscoped().decrement("quantity", { by: 1, where: { itemName: "w34" } }));

    expect([await qty(STOCK.a1), await qty(STOCK.a2)]).toEqual([12, 13]);
    expect([await qty(STOCK.b1), await qty(STOCK.b2)]).toEqual([100, 1000]);
  });

  it("an increment aimed at B's row by id from A's context changes nothing", async () => {
    await runForTenant(A, () => Stock.unscoped().increment("quantity", { where: { id: STOCK.b1 } }));

    expect(await qty(STOCK.b1)).toBe(100);
  });

  it("a bulk restore from A's context restores only A's soft-deleted rows", async () => {
    await q("UPDATE stocks SET deleted_at = now() WHERE tenant_id IN (:t)", { t: [A, B] });

    await runForTenant(A, () => Stock.unscoped().restore({ where: { itemName: "w34" } }));

    const rows = await q("SELECT tenant_id, deleted_at IS NULL AS live FROM stocks WHERE tenant_id IN (:t)", { t: [A, B] });
    expect(rows.filter((r: any) => r.tenant_id === A).every((r: any) => r.live)).toBe(true);
    expect(rows.filter((r: any) => r.tenant_id === B).every((r: any) => !r.live)).toBe(true);
  });
});