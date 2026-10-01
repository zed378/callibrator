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
 *
 * P9-23: 0011 is TypeScript now (its recorded name is still
 * "0011-add-esignature-records.js"); this suite reads the .ts source.
 */
import * as fs from "fs";
import * as path from "path";
import type { QueryInterface } from "sequelize";
import migration from "../../migrations/0011-add-esignature-records";

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0011-add-esignature-records.ts"), "utf8");

interface ColumnSpec {
  allowNull?: boolean;
  onDelete?: string;
  references?: unknown;
}

const fakeQueryInterface = ({
  exists = true,
  rows = 0,
  dropError = null,
}: { exists?: boolean; rows?: number; dropError?: Error | null } = {}) => {
  const calls: string[] = [];
  const queryInterface = {
    sequelize: {
      query: jest.fn((sql: string) => {
        calls.push(sql);
        if (sql.includes("to_regclass")) {
          return Promise.resolve([[{ exists }]]);
        }
        if (sql.includes("count(*)")) {
          return Promise.resolve([[{ n: rows }]]);
        }
        return Promise.resolve([[]]);
      }),
    },
    dropTable: jest.fn((name: string) => {
      calls.push(`dropTable ${name}`);
      return dropError ? Promise.reject(dropError) : Promise.resolve();
    }),
    createTable: jest.fn<Promise<void>, [string, Record<string, ColumnSpec>]>((name) => {
      calls.push(`createTable ${name}`);
      return Promise.resolve();
    }),
    addIndex: jest.fn((name: string, fields: string[]) => {
      calls.push(`addIndex ${name} ${fields.join(",")}`);
      return Promise.resolve();
    }),
  };
  return { queryInterface, context: queryInterface as unknown as QueryInterface, calls };
};

describe("migration 0011 — e_signature_records (A-147)", () => {
  it("has no catch at all: an error fails the migration instead of recording it as applied", () => {
    expect(SOURCE).not.toMatch(/\.catch\(/);
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
  });

  it("an error from the drop propagates, and nothing is created after it", async () => {
    const boom = new Error("canceling statement due to lock timeout");
    const { context, calls } = fakeQueryInterface({ dropError: boom });

    await expect(migration.up({ context })).rejects.toBe(boom);
    expect(calls.some((c) => c.startsWith("createTable"))).toBe(false);
  });

  it("refuses — and drops nothing — when the table already holds signature records", async () => {
    const { queryInterface, context, calls } = fakeQueryInterface({ rows: 3 });

    const err = await migration.up({ context }).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.message).toMatch(/^Migration 0011 refused: e_signature_records already holds 3 row\(s\)/);
    expect(err?.message).toMatch(/Nothing was changed/);
    expect(queryInterface.dropTable).not.toHaveBeenCalled();
    expect(calls.some((c) => c.includes("DROP TYPE"))).toBe(false);
  });

  it("fresh database (sync() built it, empty): drops and recreates it exactly as before", async () => {
    const { queryInterface, context, calls } = fakeQueryInterface({ rows: 0 });

    await migration.up({ context });

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
    const { queryInterface, context, calls } = fakeQueryInterface({ exists: false });

    await migration.up({ context });

    expect(calls.some((c) => c.includes("count(*)"))).toBe(false);
    expect(queryInterface.createTable).toHaveBeenCalledTimes(1);
  });

  it("the columns it creates are unchanged (fresh and deployed databases must not diverge)", async () => {
    const { queryInterface, context } = fakeQueryInterface();

    await migration.up({ context });

    const [, columns = {}] = queryInterface.createTable.mock.calls[0] ?? [];
    expect(Object.keys(columns)).toEqual([
      "id", "tenant_id", "entity_type", "entity_id", "user_id", "action",
      "meaning", "auth_method", "document_hash", "ip_address", "user_agent", "timestamp",
    ]);
    expect(columns["tenant_id"]).toMatchObject({ allowNull: false, onDelete: "CASCADE" });
    expect(columns["user_id"]?.references).toEqual({ model: "users", key: "id" });
  });

  it("accepts a wrapped context ({ queryInterface }) as it always has", async () => {
    const { queryInterface, context } = fakeQueryInterface();

    await migration.up({ context: { queryInterface: context } as unknown as QueryInterface });

    expect(queryInterface.createTable).toHaveBeenCalledTimes(1);
  });

  it("down drops the table and its enum types", async () => {
    const { context, calls } = fakeQueryInterface();

    await migration.down({ context });

    expect(calls).toEqual([
      "dropTable e_signature_records",
      'DROP TYPE IF EXISTS "enum_e_signature_records_action";',
      'DROP TYPE IF EXISTS "enum_e_signature_records_auth_method";',
    ]);
  });
});
