/**
 * Migration 0043 — A-10: `webhook_deliveries.next_attempt_at` and the due index.
 *
 * Fake `sequelize.query`: proves the control flow — refuse (not skip) a
 * missing table, add the column and the index only when absent, resume recent
 * abandoned rows and dead-letter old ones in the same transaction, and a
 * `down` that drops exactly what `up` added.
 *
 * WHICH rows the two UPDATEs touch is proven against PostgreSQL 18, not here:
 * verified on pgvector/pgvector:pg18 (18.6) over a db.sync() schema with the
 * column dropped (a pre-0043 database) and four legacy rows — a 1 h-old
 * `failed` row was resumed (next_attempt_at set), 3-day-old `pending` and
 * 2-day-old `failed` rows became `exhausted` with the 0043 note appended to
 * any existing last_error, and a `success` row was untouched; `\d` showed the
 * column and the partial index `WHERE status = ANY ('{pending,failed}')`; a
 * second `up` changed nothing; `down` removed both; `down` again and `up`
 * after `down` both succeeded.
 */
const fs = require("fs");
const path = require("path");
const migration = require("../../migrations/0043-webhook-durable-delivery");

const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

const fakeContext = ({ table = true, column = false, index = false } = {}) => {
  const calls = [];
  const query = jest.fn(async (sql, options = {}) => {
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), options });
    if (/to_regclass/.test(sql)) {
      const name = options.replacements.table || options.replacements.index;
      return [[{ present: name === migration.TABLE ? table : index }]];
    }
    if (/information_schema\.columns/.test(sql)) {
      return [[{ n: column ? 1 : 0 }]];
    }
    return [[]];
  });
  const tx = { id: "tx" };
  return { calls, tx, context: { sequelize: { query, transaction: async (fn) => fn(tx) } } };
};

const statements = (calls) => calls.map((c) => c.sql).filter((s) => !/^SELECT/.test(s));

describe("0043-webhook-durable-delivery", () => {
  it("is registered in the migrator", () => {
    expect(MANIFEST).toContain(
      '["0043-webhook-durable-delivery.js", require("../migrations/0043-webhook-durable-delivery")]',
    );
  });

  it("refuses — does not skip — when webhook_deliveries is missing", async () => {
    const { context, calls } = fakeContext({ table: false });
    await expect(migration.up({ context })).rejects.toThrow(/does not exist/);
    expect(statements(calls)).toEqual([]);
  });

  it("on a pre-0043 table: adds the column, resumes/dead-letters abandoned rows, adds the index — in one transaction", async () => {
    const { context, calls, tx } = fakeContext();
    await migration.up({ context });
    const done = statements(calls);
    expect(done[0]).toBe("SET LOCAL lock_timeout = '10s'");
    expect(done[1]).toBe("ALTER TABLE webhook_deliveries ADD COLUMN next_attempt_at TIMESTAMPTZ NULL");
    expect(done[2]).toMatch(/UPDATE webhook_deliveries SET next_attempt_at = now\(\) WHERE next_attempt_at IS NULL AND status IN \('pending', 'failed'\) AND created_at >= now\(\) - interval '24 hours'/);
    expect(done[3]).toMatch(/SET status = 'exhausted'/);
    expect(done[4]).toBe(
      "CREATE INDEX webhook_deliveries_due ON webhook_deliveries (next_attempt_at) WHERE status IN ('pending', 'failed')",
    );
    expect(calls.find((c) => /SET status = 'exhausted'/.test(c.sql)).options.replacements.note).toBe(migration.ABANDONED_NOTE);
    expect(calls.every((c) => c.options.transaction === tx)).toBe(true);
  });

  it("is idempotent: with the column and index present it adds neither", async () => {
    const { context, calls } = fakeContext({ column: true, index: true });
    await migration.up({ context });
    const done = statements(calls);
    expect(done.some((s) => /ADD COLUMN|CREATE INDEX/.test(s))).toBe(false);
  });

  it("down drops the index and the column", async () => {
    const { context, calls } = fakeContext();
    await migration.down({ context });
    expect(statements(calls)).toEqual([
      "SET LOCAL lock_timeout = '10s'",
      "DROP INDEX IF EXISTS webhook_deliveries_due",
      "ALTER TABLE webhook_deliveries DROP COLUMN IF EXISTS next_attempt_at",
    ]);
  });

  it("down on a database without the table does nothing", async () => {
    const { context, calls } = fakeContext({ table: false });
    await migration.down({ context });
    expect(statements(calls)).toEqual([]);
  });
});
