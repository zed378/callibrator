/**
 * Migration 0105 — api_key_id + an exactly-one-actor CHECK on
 * calibration_records, stock_adjustments and stock_transfers (Q-51).
 *
 * A fake Sequelize that answers the migration's catalog queries from an
 * in-memory state and records every statement: the order (catalog-only
 * changes and CHECK ... NOT VALID in one transaction, VALIDATE in a second),
 * idempotence on a fresh database where db.sync() already made the column,
 * the loud refusals (a missing table; a row naming no actor or both; a down
 * over key-authored rows), and that the models declare the same columns,
 * foreign keys and indexes. The DDL itself is proved on PostgreSQL 18 by
 * tests/migrations/apiKeyActor.q51.live.test.ts.
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for async Sequelize calls: a throw inside them must be a rejection */
import * as fs from "fs";
import * as path from "path";
import { Sequelize, DataTypes } from "sequelize";

import migration from "../../migrations/0105-api-key-actor-columns";
import defineCalibrationRecord from "../../models/calibrationRecord.model";
import defineStockAdjustment from "../../models/stockAdjustment.model";
import defineStockTransfer from "../../models/stockTransfer.model";

type Context = Parameters<typeof migration.up>[0]["context"];

const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

interface TableState {
  exists: boolean;
  column: boolean;
  constraint: boolean;
  bad: number;
  keyRows: number;
}

interface Statement {
  sql: string;
  tx: number | null;
}

const fakeContext = (init: Partial<Record<string, Partial<TableState>>> = {}) => {
  const tables: Record<string, TableState> = {};
  for (const t of migration.TARGETS) {
    tables[t.table] = { exists: true, column: false, constraint: false, bad: 0, keyRows: 0, ...init[t.table] };
  }
  const statements: Statement[] = [];
  let txSeq = 0;
  const query = jest.fn(async (sql: string, options: { replacements?: Record<string, string>; transaction?: { id: number } } = {}) => {
    statements.push({ sql, tx: options.transaction?.id ?? null });
    const r = options.replacements ?? {};
    const byName = (name: string | undefined): TableState => {
      const state = name ? tables[name] : undefined;
      if (!state) {
        throw new Error(`unknown table ${String(name)}`);
      }
      return state;
    };
    const tableIn = (text: string): TableState => byName(migration.TARGETS.find((t) => text.includes(` ${t.table} `))?.table);
    if (sql.includes("to_regclass")) {
      return [[{ present: byName(r["table"]).exists }], null];
    }
    if (sql.includes("information_schema.columns")) {
      return [byName(r["table"]).column ? [{ "?column?": 1 }] : [], null];
    }
    if (sql.includes("FROM pg_constraint")) {
      return [byName(r["table"]).constraint ? [{ "?column?": 1 }] : [], null];
    }
    if (sql.includes("WHERE NOT (num_nonnulls")) {
      return [[{ n: tableIn(sql).bad }], null];
    }
    if (sql.includes("WHERE api_key_id IS NOT NULL")) {
      return [[{ n: tableIn(sql).keyRows }], null];
    }
    return [[], null];
  });
  const sequelize = {
    query,
    transaction: jest.fn(async (work: (t: { id: number }) => Promise<void>) => {
      txSeq += 1;
      await work({ id: txSeq });
    }),
  };
  return { tables, statements, context: { sequelize } as unknown as Context };
};

const ddl = (statements: Statement[]): Statement[] =>
  statements.filter((s) => /^(ALTER|CREATE|DROP)/.test(s.sql));

describe("migration 0105 — an API key as a row's actor (Q-51)", () => {
  it("is in the manifest under its frozen .js name, after 0104", () => {
    const entry = '["0105-api-key-actor-columns.js", require("../migrations/0105-api-key-actor-columns")]';
    expect(MANIFEST).toContain(entry);
    expect(MANIFEST.indexOf(entry)).toBeGreaterThan(MANIFEST.indexOf('"0104-'));
  });

  it("covers exactly the three tables, each with its user column and named CHECK", () => {
    expect(migration.TARGETS.map((t) => [t.table, t.userColumn, t.check, t.index])).toEqual([
      ["calibration_records", "performed_by", "calibration_records_actor_exactly_one", "calibration_records_api_key_id"],
      ["stock_adjustments", "adjusted_by", "stock_adjustments_actor_exactly_one", "stock_adjustments_api_key_id"],
      ["stock_transfers", "requested_by", "stock_transfers_requester_exactly_one", "stock_transfers_api_key_id"],
    ]);
    const adjustments = migration.TARGETS.find((t) => t.table === "stock_adjustments");
    expect(adjustments && migration.checkPredicate(adjustments)).toBe("num_nonnulls(adjusted_by, api_key_id) = 1");
  });

  it("upgrade: adds the column + FK, drops NOT NULL and adds the CHECK NOT VALID in one transaction, then VALIDATEs in another", async () => {
    const f = fakeContext();
    await migration.up({ context: f.context });
    const adj = ddl(f.statements).filter((s) => s.sql.includes("stock_adjustments"));
    expect(adj.map((s) => s.sql)).toEqual([
      "ALTER TABLE stock_adjustments ADD COLUMN api_key_id UUID REFERENCES api_keys (id) ON DELETE RESTRICT ON UPDATE CASCADE",
      "ALTER TABLE stock_adjustments ALTER COLUMN adjusted_by DROP NOT NULL",
      "ALTER TABLE stock_adjustments ADD CONSTRAINT stock_adjustments_actor_exactly_one CHECK (num_nonnulls(adjusted_by, api_key_id) = 1) NOT VALID",
      "CREATE INDEX IF NOT EXISTS stock_adjustments_api_key_id ON stock_adjustments (api_key_id)",
      "ALTER TABLE stock_adjustments VALIDATE CONSTRAINT stock_adjustments_actor_exactly_one",
    ]);
    const [add, dropNotNull, check, index, validate] = adj;
    expect(add?.tx).not.toBeNull();
    expect(dropNotNull?.tx).toBe(add?.tx);
    expect(check?.tx).toBe(add?.tx);
    expect(index?.tx).toBeNull();
    expect(validate?.tx).not.toBeNull();
    expect(validate?.tx).not.toBe(add?.tx);
    // Each transaction sets a lock_timeout first.
    const locks = f.statements.filter((s) => s.sql.startsWith("SET LOCAL lock_timeout"));
    expect(locks).toHaveLength(6);
    // The other two tables get the same shape.
    for (const t of ["calibration_records", "stock_transfers"]) {
      expect(ddl(f.statements).filter((s) => s.sql.includes(` ${t} `) || s.sql.endsWith(` ${t}`))).toHaveLength(5);
    }
  });

  it("fresh database (db.sync() made the column, a re-run found the CHECK): no ADD COLUMN, no ADD CONSTRAINT; still validates", async () => {
    const all = { exists: true, column: true, constraint: true };
    const f = fakeContext({ calibration_records: all, stock_adjustments: all, stock_transfers: all });
    await migration.up({ context: f.context });
    const sqls = ddl(f.statements).map((s) => s.sql);
    expect(sqls.some((s) => s.includes("ADD COLUMN"))).toBe(false);
    expect(sqls.some((s) => s.includes("ADD CONSTRAINT"))).toBe(false);
    expect(sqls.filter((s) => s.includes("VALIDATE CONSTRAINT"))).toHaveLength(3);
  });

  it("REFUSES, naming the count, when a row names no actor or both — and does not validate", async () => {
    const f = fakeContext({ stock_transfers: { bad: 2 } });
    await expect(migration.up({ context: f.context })).rejects.toThrow(
      /0105: 2 row\(s\) of stock_transfers name no actor or both/,
    );
    expect(f.statements.some((s) => s.sql.includes("VALIDATE CONSTRAINT stock_transfers_requester_exactly_one"))).toBe(false);
  });

  it("REFUSES when a table is missing (db.sync() runs first; a skip would be recorded as applied)", async () => {
    const f = fakeContext({ calibration_records: { exists: false } });
    await expect(migration.up({ context: f.context })).rejects.toThrow(/0105: table calibration_records does not exist/);
    expect(ddl(f.statements)).toEqual([]);
  });

  it("a failure propagates (no try/catch)", async () => {
    const f = fakeContext();
    const boom = new Error('relation "api_keys" does not exist');
    f.context.sequelize.query = jest.fn(async (sql: string) => {
      if (sql.startsWith("ALTER TABLE")) {
        throw boom;
      }
      return [[{ present: true }], null];
    }) as unknown as typeof f.context.sequelize.query;
    await expect(migration.up({ context: f.context })).rejects.toBe(boom);
  });

  it("a catalog query that returns no row is a failure, not a default", async () => {
    const f = fakeContext();
    f.context.sequelize.query = jest.fn(async () => [[], null]) as unknown as typeof f.context.sequelize.query;
    await expect(migration.up({ context: f.context })).rejects.toThrow(/0105: no row from: SELECT to_regclass/);
  });

  it("down REFUSES while a key-authored row exists, before changing anything", async () => {
    const all = { column: true, constraint: true };
    const f = fakeContext({ calibration_records: all, stock_adjustments: { ...all, keyRows: 3 }, stock_transfers: all });
    await expect(migration.down({ context: f.context })).rejects.toThrow(
      /0105 down: 3 row\(s\) of stock_adjustments were written by an API key/,
    );
    expect(ddl(f.statements)).toEqual([]);
  });

  it("down reverts all three tables in ONE transaction: drop the CHECK, the index, the column; restore NOT NULL", async () => {
    const all = { column: true, constraint: true };
    const f = fakeContext({ calibration_records: all, stock_adjustments: all, stock_transfers: all });
    await migration.down({ context: f.context });
    const statements = ddl(f.statements);
    expect(new Set(statements.map((s) => s.tx)).size).toBe(1);
    expect(statements.filter((s) => s.sql.includes("calibration_records")).map((s) => s.sql)).toEqual([
      "ALTER TABLE calibration_records DROP CONSTRAINT IF EXISTS calibration_records_actor_exactly_one",
      "DROP INDEX IF EXISTS calibration_records_api_key_id",
      "ALTER TABLE calibration_records DROP COLUMN IF EXISTS api_key_id",
      "ALTER TABLE calibration_records ALTER COLUMN performed_by SET NOT NULL",
    ]);
  });

  it("down skips a table that does not exist", async () => {
    const f = fakeContext({ stock_transfers: { exists: false } });
    await migration.down({ context: f.context });
    expect(ddl(f.statements).some((s) => s.sql.includes("stock_transfers"))).toBe(false);
    expect(ddl(f.statements).filter((s) => s.sql.includes("stock_adjustments"))).toHaveLength(4);
  });
});

describe("the models declare what 0105 makes (so a fresh db.sync() converges on it)", () => {
  const db = new Sequelize({ dialect: "postgres", logging: false });
  interface Attr {
    field: string;
    allowNull?: boolean;
    references?: { model: string; key: string };
    onDelete?: string;
  }
  /** The members read here, common to the three models. */
  interface ModelLike {
    getAttributes(): unknown;
    readonly options: { readonly indexes?: readonly unknown[] };
  }
  const cases: [string, ModelLike, string][] = [
    ["calibration_records", defineCalibrationRecord(db, DataTypes), "performedBy"],
    ["stock_adjustments", defineStockAdjustment(db, DataTypes), "adjustedBy"],
    ["stock_transfers", defineStockTransfer(db, DataTypes), "requestedBy"],
  ];

  it.each(cases)("%s: api_key_id is a nullable RESTRICT FK to api_keys, the user column nullable, and NO model index on it", (_table, model, userAttr) => {
    const attrs = model.getAttributes() as Record<string, Attr>;
    expect(attrs["apiKeyId"]).toMatchObject({
      field: "api_key_id",
      allowNull: true,
      references: { model: "api_keys", key: "id" },
      onDelete: "RESTRICT",
    });
    expect(attrs[userAttr]?.allowNull).toBe(true);
    // ADR-100 Amendment 3: the index is the migration's alone. db.sync() runs
    // before the migrator, and a model index on a column 0105 adds fails
    // CREATE INDEX on an existing database, so boot never reaches 0105.
    const indexes = (model.options.indexes ?? []) as { fields?: string[] }[];
    expect(indexes.some((i) => i.fields?.includes("api_key_id"))).toBe(false);
  });
});
