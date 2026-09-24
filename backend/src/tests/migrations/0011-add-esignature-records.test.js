/**
 * Migration 0011 — A-147: no blanket catch, and never drop a table that holds
 * signature records.
 *
 * 0011 is frozen by name and has run on every deployed database, so editing
 * it changes nothing there. On a fresh database (sync() built the table, and
 * it is empty) its effect is the same as before. What changed: an error now
 * propagates instead of being swallowed — with `CREATE TABLE IF NOT EXISTS`
 * after it, a swallowed drop used to leave 0011 recorded as applied over a
 * table it never built — and a populated table is refused, not dropped.
 *
 * Proven on PostgreSQL 18 (pgvector/pgvector:pg18): on a database whose
 * e_signature_records held a row, the HEAD version of 0011 run by hand left
 * 0 rows; this version refused and left 1. On a fresh database (empty table)
 * it dropped and recreated the table as before, and a full fresh build
 * (sync() + every migration) succeeded.
 */
const fs = require("fs");
const path = require("path");

const migration = require("../../migrations/0011-add-esignature-records");

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0011-add-esignature-records.js"), "utf8");

const fakeQueryInterface = ({ exists = true, rows = 0, dropError = null } = {}) => {
  const calls = [];
  const queryInterface = {
    sequelize: {
      query: jest.fn(async (sql) => {
        calls.push(sql);
        if (/to_regclass/.test(sql)) {
          return [[{ exists }]];
        }
        if (/count\(\*\)/.test(sql)) {
          return [[{ n: rows }]];
        }
        return [[]];
      }),
    },
    dropTable: jest.fn(async (name) => {
      calls.push(`dropTable ${name}`);
      if (dropError) {
        throw dropError;
      }
    }),
    createTable: jest.fn(async (name) => {
      calls.push(`createTable ${name}`);
    }),
    addIndex: jest.fn(async (name, fields) => {
      calls.push(`addIndex ${name} ${fields.join(",")}`);
    }),
  };
  return { queryInterface, calls };
};

describe("migration 0011 — e_signature_records (A-147)", () => {
  it("has no catch at all: an error fails the migration instead of recording it as applied", () => {
    expect(SOURCE).not.toMatch(/\.catch\(/);
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
  });

  it("an error from the drop propagates, and nothing is created after it", async () => {
    const boom = new Error("canceling statement due to lock timeout");
    const { queryInterface, calls } = fakeQueryInterface({ dropError: boom });

    await expect(migration.up({ context: queryInterface })).rejects.toBe(boom);
    expect(calls.some((c) => c.startsWith("createTable"))).toBe(false);
  });

  it("refuses — and drops nothing — when the table already holds signature records", async () => {
    const { queryInterface, calls } = fakeQueryInterface({ rows: 3 });

    const err = await migration.up({ context: queryInterface }).catch((e) => e);

    expect(err.message).toMatch(/^Migration 0011 refused: e_signature_records already holds 3 row\(s\)/);
    expect(err.message).toMatch(/Nothing was changed/);
    expect(queryInterface.dropTable).not.toHaveBeenCalled();
    expect(calls.some((c) => /DROP TYPE/.test(c))).toBe(false);
  });

  it("fresh database (sync() built it, empty): drops and recreates it exactly as before", async () => {
    const { queryInterface, calls } = fakeQueryInterface({ rows: 0 });

    await migration.up({ context: queryInterface });

    expect(calls.slice(2)).toEqual([
      "dropTable e_signature_records",
      'DROP TYPE IF EXISTS "enum_e_signature_records_action";',
      'DROP TYPE IF EXISTS "enum_e_signature_records_auth_method";',
      "createTable e_signature_records",
      "addIndex e_signature_records tenant_id",
      "addIndex e_signature_records entity_type,entity_id",
      "addIndex e_signature_records user_id",
    ]);
    expect(queryInterface.dropTable).toHaveBeenCalledWith("e_signature_records", { cascade: true });
  });

  it("no table yet: creates it without counting rows", async () => {
    const { queryInterface, calls } = fakeQueryInterface({ exists: false });

    await migration.up({ context: queryInterface });

    expect(calls.some((c) => /count\(\*\)/.test(c))).toBe(false);
    expect(queryInterface.createTable).toHaveBeenCalledTimes(1);
  });

  it("the columns it creates are unchanged (fresh and deployed databases must not diverge)", async () => {
    const { queryInterface } = fakeQueryInterface();

    await migration.up({ context: queryInterface });

    const [, columns] = queryInterface.createTable.mock.calls[0];
    expect(Object.keys(columns)).toEqual([
      "id", "tenant_id", "entity_type", "entity_id", "user_id", "action",
      "meaning", "auth_method", "document_hash", "ip_address", "user_agent", "timestamp",
    ]);
    expect(columns.tenant_id).toMatchObject({ allowNull: false, onDelete: "CASCADE" });
    expect(columns.user_id.references).toEqual({ model: "users", key: "id" });
  });

  it("accepts a wrapped context ({ queryInterface }) as it always has", async () => {
    const { queryInterface } = fakeQueryInterface();

    await migration.up({ context: { queryInterface } });

    expect(queryInterface.createTable).toHaveBeenCalledTimes(1);
  });

  it("down drops the table and its enum types", async () => {
    const { queryInterface, calls } = fakeQueryInterface();

    await migration.down({ context: queryInterface });

    expect(calls).toEqual([
      "dropTable e_signature_records",
      'DROP TYPE IF EXISTS "enum_e_signature_records_action";',
      'DROP TYPE IF EXISTS "enum_e_signature_records_auth_method";',
    ]);
  });
});
