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
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const migration = require("../../migrations/0044-iot-device-token-hash");

const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");
const sha256 = (raw) => crypto.createHash("sha256").update(raw, "utf8").digest("hex");

const TX = { id: "tx-0044" };

/**
 * @param {object} opts - initial state
 * @returns {object} a fake QueryInterface over one table
 */
const fakeQueryInterface = ({
  tables = ["calibration_devices"],
  columns = ["id", "tenant_id", "iot_device_token", "iot_enabled", "updated_at"],
  indexes = ["calibration_devices_pkey"],
  rows = [],
} = {}) => {
  const state = { columns: new Set(columns), indexes: new Set(indexes), rows, ddl: [], transactions: [] };
  const inTx = (options) => {
    state.transactions.push(options && options.transaction);
  };
  const qi = {
    state,
    showAllTables: jest.fn(async (options) => {
      inTx(options);
      return tables;
    }),
    describeTable: jest.fn(async (table, options) => {
      inTx(options);
      return Object.fromEntries([...state.columns].map((c) => [c, { type: "x" }]));
    }),
    showIndex: jest.fn(async (table, options) => {
      inTx(options);
      return [...state.indexes].map((name) => ({ name }));
    }),
    addColumn: jest.fn(async (table, column, spec, options) => {
      inTx(options);
      state.columns.add(column);
      state.ddl.push(`addColumn ${column}`);
    }),
    removeColumn: jest.fn(async (table, column, options) => {
      inTx(options);
      state.columns.delete(column);
      for (const r of state.rows) {
        delete r[column];
      }
      state.ddl.push(`removeColumn ${column}`);
    }),
    addIndex: jest.fn(async (table, fields, options) => {
      inTx(options);
      state.indexes.add(options.name);
      state.ddl.push({ fields, options: { ...options, transaction: undefined } });
    }),
    removeIndex: jest.fn(async (table, name, options) => {
      inTx(options);
      state.indexes.delete(name);
      state.ddl.push(`removeIndex ${name}`);
    }),
    sequelize: {
      transaction: jest.fn(async (work) => work(TX)),
      query: jest.fn(async (sql, options) => {
        inTx(options);
        const plaintext = (r) => r.iot_device_token !== null && r.iot_device_token !== undefined && r.iot_device_token !== "";
        if (/^UPDATE/.test(sql.trim())) {
          for (const r of state.rows.filter((x) => plaintext(x) && !x.iot_token_hash)) {
            r.iot_token_hash = sha256(r.iot_device_token);
            r.iot_token_issued_at = r.iot_token_issued_at || r.updated_at;
          }
          return [[], { rowCount: 0 }];
        }
        if (/IS DISTINCT FROM/.test(sql)) {
          const n = state.rows.filter((r) => plaintext(r) && r.iot_token_hash !== sha256(r.iot_device_token)).length;
          return [[{ n }]];
        }
        if (/iot_token_hash IS NOT NULL/.test(sql)) {
          return [[{ n: state.rows.filter((r) => r.iot_token_hash).length }]];
        }
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    },
  };
  return qi;
};

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

    await migration.up({ context: qi });

    expect(qi.state.rows[0]).toEqual({
      id: 1,
      iot_token_hash: sha256("hand-written"),
      iot_token_issued_at: "2026-01-01",
      updated_at: "2026-01-01",
    });
    expect(qi.state.rows[1].iot_token_hash).toBeUndefined(); // no token, no hash
    expect(qi.state.rows[2].iot_token_hash).toBeUndefined(); // '' authenticated nothing
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
    await migration.up({ context: qi });
    const ddl = qi.state.ddl.length;
    const snapshot = JSON.stringify(qi.state.rows);

    await migration.up({ context: qi });

    expect(qi.state.ddl).toHaveLength(ddl);
    expect(JSON.stringify(qi.state.rows)).toBe(snapshot);
  });

  it("refuses when a row already carries a different hash, before dropping anything", async () => {
    const qi = fakeQueryInterface({
      columns: ["id", "iot_device_token", "iot_token_hash", "iot_token_issued_at", "updated_at"],
      rows: [{ id: 1, iot_device_token: "one", iot_token_hash: sha256("two"), updated_at: "d" }],
    });

    await expect(migration.up({ context: qi })).rejects.toThrow(/Migration 0044 refused: 1 device/);
    expect(qi.state.columns.has("iot_device_token")).toBe(true);
  });

  it("does nothing when the table does not exist yet", async () => {
    const qi = fakeQueryInterface({ tables: [] });
    await migration.up({ context: qi });
    await migration.down({ context: qi });
    expect(qi.describeTable).not.toHaveBeenCalled();
  });

  it("down refuses while any device holds a hashed token", async () => {
    const qi = fakeQueryInterface({ rows: [{ id: 1, iot_device_token: "t", updated_at: "d" }] });
    await migration.up({ context: qi });

    await expect(migration.down({ context: qi })).rejects.toThrow(/down refused: 1 device\(s\) hold a hashed/);
    expect(qi.state.columns.has("iot_token_hash")).toBe(true);
  });

  it("down, with no token held, restores the 0010 column and removes the new ones", async () => {
    const qi = fakeQueryInterface({ rows: [{ id: 1, iot_device_token: null, updated_at: "d" }] });
    await migration.up({ context: qi });

    await migration.down({ context: qi });

    expect(qi.state.columns.has("iot_device_token")).toBe(true);
    expect(qi.state.columns.has("iot_token_hash")).toBe(false);
    expect(qi.state.columns.has("iot_token_issued_at")).toBe(false);
    expect(qi.state.indexes.has(migration.INDEX)).toBe(false);

    // and a second down is a no-op
    const ddl = qi.state.ddl.length;
    await migration.down({ context: qi });
    expect(qi.state.ddl).toHaveLength(ddl);
  });
});
