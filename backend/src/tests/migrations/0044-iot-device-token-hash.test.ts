/**
 * Migration 0044 — IoT ingest tokens stored as a SHA-256 hash (A-29).
 *
 * Runs the migration against a fake QueryInterface over an in-memory table.
 * It proves the LOGIC: the columns are added, a plaintext token is hashed
 * deliberately (and an empty one mapped to none), a row whose hash disagrees
 * refuses the run, the plaintext column is dropped, the unique index is
 * created, a second run changes nothing, and `down` refuses while any device
 * holds a hash. Every statement runs in the one transaction.
 *
 * The SQL itself was run on pgvector/pgvector:pg18 — see the A-29 record in
 * TASKS/AUDIT-2026-09-REMEDIATION.md (up, re-run, down, psql check).
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for the async QueryInterface: a throw inside them must be a rejection */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import migration from "../../migrations/0044-iot-device-token-hash";

const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
const sha256 = (raw: string): string => crypto.createHash("sha256").update(raw, "utf8").digest("hex");

const TX = { id: "tx-0044" };

interface DeviceRow {
    id: number;
    iot_device_token?: string | null;
    iot_token_hash?: string;
    iot_token_issued_at?: string;
    updated_at: string;
    [column: string]: unknown;
}

interface DdlIndex {
    fields: string[];
    options: { name: string; unique?: boolean; transaction: unknown };
}

/**
 * A fake QueryInterface over one table.
 */
const fakeQueryInterface = ({
  tables = ["calibration_devices"],
  columns = ["id", "tenant_id", "iot_device_token", "iot_enabled", "updated_at"],
  indexes = ["calibration_devices_pkey"],
  rows = [],
}: {
    tables?: string[];
    columns?: string[];
    indexes?: string[];
    rows?: DeviceRow[];
} = {}) => {
  const state = { columns: new Set(columns), indexes: new Set(indexes), rows, ddl: [] as (string | DdlIndex)[], transactions: [] as unknown[] };
  const inTx = (options?: { transaction?: unknown }): void => {
    state.transactions.push(options?.transaction);
  };
  const qi = {
    state,
    showAllTables: jest.fn(async (options?: { transaction?: unknown }) => {
      inTx(options);
      return tables;
    }),
    describeTable: jest.fn(async (_table: string, options?: { transaction?: unknown }) => {
      inTx(options);
      return Object.fromEntries([...state.columns].map((c) => [c, { type: "x" }]));
    }),
    showIndex: jest.fn(async (_table: string, options?: { transaction?: unknown }) => {
      inTx(options);
      return [...state.indexes].map((name) => ({ name }));
    }),
    addColumn: jest.fn(async (_table: string, column: string, _spec: unknown, options?: { transaction?: unknown }) => {
      inTx(options);
      state.columns.add(column);
      state.ddl.push(`addColumn ${column}`);
    }),
    removeColumn: jest.fn(async (_table: string, column: string, options?: { transaction?: unknown }) => {
      inTx(options);
      state.columns.delete(column);
      for (const r of state.rows) {
        Reflect.deleteProperty(r, column);
      }
      state.ddl.push(`removeColumn ${column}`);
    }),
    addIndex: jest.fn(async (_table: string, fields: string[], options: { name: string; unique?: boolean; transaction?: unknown }) => {
      inTx(options);
      state.indexes.add(options.name);
      state.ddl.push({ fields, options: { ...options, transaction: undefined } });
    }),
    removeIndex: jest.fn(async (_table: string, name: string, options?: { transaction?: unknown }) => {
      inTx(options);
      state.indexes.delete(name);
      state.ddl.push(`removeIndex ${name}`);
    }),
    sequelize: {
      transaction: jest.fn(async (work: (tx: unknown) => unknown) => work(TX)),
      query: jest.fn(async (sql: string, options?: { transaction?: unknown }) => {
        inTx(options);
        const plaintext = (r: DeviceRow): boolean => r.iot_device_token !== null && r.iot_device_token !== undefined && r.iot_device_token !== "";
        if (sql.trim().startsWith("UPDATE")) {
          for (const r of state.rows.filter((x) => plaintext(x) && !x.iot_token_hash)) {
            r.iot_token_hash = sha256(r.iot_device_token as string);
            r.iot_token_issued_at = (r.iot_token_issued_at ?? r.updated_at);
          }
          return [[], { rowCount: 0 }];
        }
        if (sql.includes("IS DISTINCT FROM")) {
          const n = state.rows.filter((r) => plaintext(r) && r.iot_token_hash !== sha256(r.iot_device_token as string)).length;
          return [[{ n }]];
        }
        if (sql.includes("iot_token_hash IS NOT NULL")) {
          return [[{ n: state.rows.filter((r) => r.iot_token_hash).length }]];
        }
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    },
  };
  return qi;
};

type FakeQi = ReturnType<typeof fakeQueryInterface>;
type Context = Parameters<typeof migration.up>[0]["context"];
const ctx = (qi: FakeQi): Context => qi as unknown as Context;

describe("migration 0044 — IoT token hash (A-29)", () => {
  it("is registered in the migrator manifest", () => {
    expect(MANIFEST).toContain(
      '["0044-iot-device-token-hash.js", require("../migrations/0044-iot-device-token-hash")]',
    );
  });

  it("the SQL hash is SHA-256 of the UTF-8 token, hex — what the application computes", () => {
    expect(migration.HASH_SQL).toBe("encode(sha256(convert_to(iot_device_token, 'UTF8')), 'hex')");
  });

  it("hashes an existing plaintext token, drops the plaintext column and adds the unique index", async () => {
    const qi = fakeQueryInterface({
      rows: [
        { id: 1, iot_device_token: "hand-written", updated_at: "2026-01-01" },
        { id: 2, iot_device_token: null, updated_at: "2026-01-02" },
        { id: 3, iot_device_token: "", updated_at: "2026-01-03" },
      ],
    });

    await migration.up({ context: ctx(qi) });

    expect(qi.state.rows[0]).toEqual({
      id: 1,
      iot_token_hash: sha256("hand-written"),
      iot_token_issued_at: "2026-01-01",
      updated_at: "2026-01-01",
    });
    expect(qi.state.rows[1]?.iot_token_hash).toBeUndefined(); // no token, no hash
    expect(qi.state.rows[2]?.iot_token_hash).toBeUndefined(); // '' authenticated nothing
    expect(qi.state.columns.has("iot_device_token")).toBe(false);
    expect(qi.state.columns.has("iot_token_hash")).toBe(true);
    expect(qi.state.columns.has("iot_token_issued_at")).toBe(true);
    expect(qi.state.ddl).toContainEqual({
      fields: ["iot_token_hash"],
      options: { name: migration.INDEX, unique: true, transaction: undefined },
    });
    expect(qi.state.transactions.every((t) => t === TX)).toBe(true);
  });

  it("a second run changes nothing", async () => {
    const qi = fakeQueryInterface({ rows: [{ id: 1, iot_device_token: "t", updated_at: "d" }] });
    await migration.up({ context: ctx(qi) });
    const ddl = qi.state.ddl.length;
    const snapshot = JSON.stringify(qi.state.rows);

    await migration.up({ context: ctx(qi) });

    expect(qi.state.ddl).toHaveLength(ddl);
    expect(JSON.stringify(qi.state.rows)).toBe(snapshot);
  });

  it("refuses when a row already carries a different hash, before dropping anything", async () => {
    const qi = fakeQueryInterface({
      columns: ["id", "iot_device_token", "iot_token_hash", "iot_token_issued_at", "updated_at"],
      rows: [{ id: 1, iot_device_token: "one", iot_token_hash: sha256("two"), updated_at: "d" }],
    });

    await expect(migration.up({ context: ctx(qi) })).rejects.toThrow(/Migration 0044 refused: 1 device/);
    expect(qi.state.columns.has("iot_device_token")).toBe(true);
  });

  it("does nothing when the table does not exist yet", async () => {
    const qi = fakeQueryInterface({ tables: [] });
    await migration.up({ context: ctx(qi) });
    await migration.down({ context: ctx(qi) });
    expect(qi.describeTable).not.toHaveBeenCalled();
  });

  it("down refuses while any device holds a hashed token", async () => {
    const qi = fakeQueryInterface({ rows: [{ id: 1, iot_device_token: "t", updated_at: "d" }] });
    await migration.up({ context: ctx(qi) });

    await expect(migration.down({ context: ctx(qi) })).rejects.toThrow(/down refused: 1 device\(s\) hold a hashed/);
    expect(qi.state.columns.has("iot_token_hash")).toBe(true);
  });

  it("down, with no token held, restores the 0010 column and removes the new ones", async () => {
    const qi = fakeQueryInterface({ rows: [{ id: 1, iot_device_token: null, updated_at: "d" }] });
    await migration.up({ context: ctx(qi) });

    await migration.down({ context: ctx(qi) });

    expect(qi.state.columns.has("iot_device_token")).toBe(true);
    expect(qi.state.columns.has("iot_token_hash")).toBe(false);
    expect(qi.state.columns.has("iot_token_issued_at")).toBe(false);
    expect(qi.state.indexes.has(migration.INDEX)).toBe(false);

    // and a second down is a no-op
    const ddl = qi.state.ddl.length;
    await migration.down({ context: ctx(qi) });
    expect(qi.state.ddl).toHaveLength(ddl);
  });
});
