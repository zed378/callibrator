/**
 * Migration 0102 — the tenant profile columns (A-303).
 *
 * Runs the migration against a fake QueryInterface over an in-memory table
 * description (the 0023 suite's harness). It proves the LOGIC: which columns,
 * under which names (the model's own underscored fields), idempotent,
 * reversible, and that a real failure is NOT swallowed and recorded as applied.
 * The DDL itself was checked with `\d tenants` on PostgreSQL 18 (see
 * MEMORY/records/2026-09-29-multipart-sanitizer.md § A-303).
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for the async QueryInterface: a throw inside them must be a rejection */
import * as fs from "fs";
import * as path from "path";
import { Sequelize, DataTypes } from "sequelize";

import migration from "../../migrations/0102-tenant-profile-columns";
import defineTenant from "../../models/tenant.model";

type Context = Parameters<typeof migration.up>[0]["context"];
const ctx = (qi: object): Context => qi as Context;

interface Attribute {
  field: string;
  type: { key: string; options?: { length?: number } };
  allowNull?: boolean;
}

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0102-tenant-profile-columns.ts"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");

/** The REAL Tenant model on an unconnected PostgreSQL-dialect Sequelize. */
const Tenant = defineTenant(new Sequelize({ dialect: "postgres", logging: false }), DataTypes);
const modelAttribute = (name: string): Attribute => (Tenant.getAttributes() as Record<string, unknown>)[name] as Attribute;
const columnSpec = (column: string): Attribute =>
  (migration.COLUMNS[column] as (typeof migration.COLUMNS)[string])(DataTypes) as unknown as Attribute;

const PROFILE_ATTRIBUTES = ["description", "phone", "address", "city", "state", "zipCode", "country", "website"];
const BASE_COLUMNS = ["id", "name", "status", "is_deleted", "created_at"];

const fakeQueryInterface = ({
  columns = BASE_COLUMNS,
  describeError = null,
}: { columns?: string[]; describeError?: Error | null } = {}) => {
  const state = { columns: new Set(columns), added: [] as string[], removed: [] as string[] };
  return {
    state,
    sequelize: { Sequelize },
    describeTable: jest.fn(async (table: string) => {
      expect(table).toBe("tenants");
      if (describeError) {
        throw describeError;
      }
      return Object.fromEntries([...state.columns].map((c) => [c, { type: "X" }]));
    }),
    addColumn: jest.fn(async (table: string, column: string) => {
      expect(table).toBe("tenants");
      if (state.columns.has(column)) {
        throw new Error(`column "${column}" already exists`);
      }
      state.columns.add(column);
      state.added.push(column);
    }),
    removeColumn: jest.fn(async (_table: string, column: string) => {
      state.columns.delete(column);
      state.removed.push(column);
    }),
  };
};

describe("migration 0102 — tenant profile columns (A-303)", () => {
  it("is registered in the static manifest under a .js name, after 0101", () => {
    const entry = '["0102-tenant-profile-columns.js", require("../migrations/0102-tenant-profile-columns")]';
    expect(MANIFEST).toContain(entry);
    expect(MANIFEST.indexOf(entry)).toBeGreaterThan(MANIFEST.indexOf('"0101-'));
  });

  it("adds exactly the columns the model maps its profile attributes to (underscored)", () => {
    const modelFields = PROFILE_ATTRIBUTES.map((a) => modelAttribute(a).field).sort();
    expect(Object.keys(migration.COLUMNS).sort()).toEqual(modelFields);
    expect(modelFields).toContain("zip_code");
  });

  it("gives each column the model's type and length, nullable", () => {
    for (const attribute of PROFILE_ATTRIBUTES) {
      const modelAttr = modelAttribute(attribute);
      const spec = columnSpec(modelAttr.field);
      expect({ attribute, type: spec.type.key, length: spec.type.options?.length, allowNull: spec.allowNull }).toEqual({
        attribute,
        type: modelAttr.type.key,
        length: modelAttr.type.options?.length,
        allowNull: true,
      });
      expect(modelAttr.allowNull).toBe(true);
    }
  });

  it("up adds every missing column; a second run (or a sync()'d table) changes nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });
    expect(qi.state.added.sort()).toEqual(Object.keys(migration.COLUMNS).sort());

    qi.addColumn.mockClear();
    await migration.up({ context: ctx(qi) });
    expect(qi.addColumn).not.toHaveBeenCalled();
  });

  it("up adds only what is missing", async () => {
    const qi = fakeQueryInterface({ columns: [...BASE_COLUMNS, "phone", "website"] });
    await migration.up({ context: ctx(qi) });
    expect(qi.state.added.sort()).toEqual(["address", "city", "country", "description", "state", "zip_code"]);
  });

  it("up and down skip cleanly when the table does not exist yet", async () => {
    const missing = (): ReturnType<typeof fakeQueryInterface> =>
      fakeQueryInterface({ describeError: new Error('No description found for "tenants" table.') });
    await expect(migration.up({ context: ctx(missing()) })).resolves.toBeUndefined();
    await expect(migration.down({ context: ctx(missing()) })).resolves.toBeUndefined();
  });

  it("does NOT swallow any other failure — Umzug must not record it as applied", async () => {
    await expect(
      migration.up({ context: ctx(fakeQueryInterface({ describeError: new TypeError("context.describeTable is not a function") })) }),
    ).rejects.toThrow("describeTable is not a function");
    await expect(
      migration.down({ context: ctx(fakeQueryInterface({ describeError: new Error("connection reset") })) }),
    ).rejects.toThrow("connection reset");
    const qi = fakeQueryInterface();
    qi.addColumn.mockRejectedValueOnce(new Error("permission denied for table tenants"));
    await expect(migration.up({ context: ctx(qi) })).rejects.toThrow("permission denied");
  });

  it("down removes exactly these columns, and is idempotent", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });
    await migration.down({ context: ctx(qi) });
    expect(qi.state.removed.sort()).toEqual(Object.keys(migration.COLUMNS).sort());
    expect([...qi.state.columns].sort()).toEqual([...BASE_COLUMNS].sort());

    qi.removeColumn.mockClear();
    await migration.down({ context: ctx(qi) });
    expect(qi.removeColumn).not.toHaveBeenCalled();
  });

  it("has no blanket catch: one catch, and it re-throws what it does not recognise", () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/catch\s*\{/);
    const catches = [...code.matchAll(/catch\s*\(\s*(\w+)\s*\)/g)];
    expect(catches).toHaveLength(1);
    const [match, name] = catches[0] as RegExpExecArray & [string, string];
    const start = code.indexOf(match);
    expect(code.slice(start, code.indexOf("\n};", start))).toContain(`throw ${name};`);
  });
});
