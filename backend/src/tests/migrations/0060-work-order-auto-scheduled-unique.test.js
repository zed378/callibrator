/**
 * Migration 0060 — one open auto-scheduled work order per device (W-03).
 *
 * A fake QueryInterface proves the statements, the order, the one
 * transaction, idempotency and the refusal on a missing table. The DDL itself
 * was run on PostgreSQL 16 (not 18): fresh-after-sync, a second `up`, `down`
 * then `up`, and a pre-existing table holding two open orders for one device
 * (the index still builds, because no existing row is auto_scheduled). The
 * concurrency it exists for is proven by calibrationScheduler.w03.live.test.js.
 */
const fs = require("fs");
const path = require("path");
const migration = require("../../migrations/0060-work-order-auto-scheduled-unique");

const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");
const TX = { id: "tx" };

const fakeQueryInterface = ({ columns = ["id", "device_id", "status", "deleted_at"] } = {}) => {
  const queries = [];
  return {
    queries,
    sequelize: {
      transaction: jest.fn(async (cb) => cb(TX)),
      query: jest.fn(async (sql, options) => {
        expect(options.transaction).toBe(TX);
        queries.push(sql.replace(/\s+/g, " ").trim());
        if (/information_schema\.columns/.test(sql)) {
          return [columns.map((column_name) => ({ column_name }))];
        }
        return [[], {}];
      }),
    },
  };
};

describe("migration 0060 — work order auto_scheduled + partial unique index", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0060-work-order-auto-scheduled-unique.js", require("../migrations/0060-work-order-auto-scheduled-unique")]',
    );
  });

  it("adds the column and the partial unique index in one transaction", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });

    expect(qi.sequelize.transaction).toHaveBeenCalledTimes(1);
    expect(qi.queries[0]).toBe("SET LOCAL lock_timeout = '10s'");
    expect(qi.queries).toContain(
      "ALTER TABLE maintenance_work_orders ADD COLUMN auto_scheduled BOOLEAN NOT NULL DEFAULT false",
    );
    expect(qi.queries[qi.queries.length - 1]).toBe(
      "CREATE UNIQUE INDEX IF NOT EXISTS maintenance_work_orders_one_open_auto_per_device " +
        "ON maintenance_work_orders (device_id) " +
        "WHERE auto_scheduled AND status IN ('Open', 'InProgress') AND deleted_at IS NULL",
    );
  });

  it("does not re-add a column db.sync() already created (fresh database)", async () => {
    const qi = fakeQueryInterface({ columns: ["id", "device_id", "auto_scheduled"] });
    await migration.up({ context: qi });

    expect(qi.queries.some((q) => q.startsWith("ALTER TABLE"))).toBe(false);
    expect(qi.queries.some((q) => q.startsWith("CREATE UNIQUE INDEX IF NOT EXISTS"))).toBe(true);
  });

  it("refuses, rather than recording itself applied, when the table is absent", async () => {
    const qi = fakeQueryInterface({ columns: [] });
    await expect(migration.up({ context: qi })).rejects.toThrow(
      /0060: table maintenance_work_orders does not exist/,
    );
  });

  it("down drops the index and keeps the column", async () => {
    const qi = fakeQueryInterface();
    await migration.down({ context: qi });

    expect(qi.queries).toEqual([
      "SET LOCAL lock_timeout = '10s'",
      "DROP INDEX IF EXISTS maintenance_work_orders_one_open_auto_per_device",
    ]);
  });
});
