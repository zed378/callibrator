/**
 * Migration 0060 — one open auto-scheduled work order per device (W-03).
 *
 * A fake QueryInterface proves the statements, the order, the one
 * transaction, idempotency and the refusal on a missing table. The DDL itself
 * was first run on PostgreSQL 16: fresh-after-sync, a second `up`, `down`
 * then `up`, and a pre-existing table holding two open orders for one device
 * (the index still builds, because no existing row is auto_scheduled). On
 * 2026-09-25 it was run on PostgreSQL 18.6 through the real migrator after
 * db.sync() (up, a second migrator.up() applying nothing, a direct re-run,
 * down keeping the column, up again; `\d maintenance_work_orders` checked).
 * The concurrency it exists for is proven by calibrationScheduler.w03.live.test.js,
 * run on the same 18.6 server (ADR-061).
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for the async QueryInterface: a throw inside them must be a rejection */
import * as fs from "fs";
import * as path from "path";

import migration from "../../migrations/0060-work-order-auto-scheduled-unique";

type Context = Parameters<typeof migration.up>[0]["context"];
const ctx = (qi: object): Context => qi as Context;

const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
const TX = { id: "tx" };

const fakeQueryInterface = ({ columns = ["id", "device_id", "status", "deleted_at"] }: { columns?: string[] } = {}) => {
  const queries: string[] = [];
  return {
    queries,
    sequelize: {
      transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(TX)),
      query: jest.fn(async (sql: string, options: { transaction: unknown }) => {
        expect(options.transaction).toBe(TX);
        queries.push(sql.replace(/\s+/g, " ").trim());
        if (sql.includes("information_schema.columns")) {
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
    await migration.up({ context: ctx(qi) });

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
    await migration.up({ context: ctx(qi) });

    expect(qi.queries.some((q) => q.startsWith("ALTER TABLE"))).toBe(false);
    expect(qi.queries.some((q) => q.startsWith("CREATE UNIQUE INDEX IF NOT EXISTS"))).toBe(true);
  });

  it("refuses, rather than recording itself applied, when the table is absent", async () => {
    const qi = fakeQueryInterface({ columns: [] });
    await expect(migration.up({ context: ctx(qi) })).rejects.toThrow(
      /0060: table maintenance_work_orders does not exist/,
    );
  });

  it("down drops the index and keeps the column", async () => {
    const qi = fakeQueryInterface();
    await migration.down({ context: ctx(qi) });

    expect(qi.queries).toEqual([
      "SET LOCAL lock_timeout = '10s'",
      "DROP INDEX IF EXISTS maintenance_work_orders_one_open_auto_per_device",
    ]);
  });
});
