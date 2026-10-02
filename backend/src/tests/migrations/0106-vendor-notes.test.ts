/**
 * Migration 0106 — vendors.notes (Q-52, ADR-109 §6).
 *
 * The 0102 suite's harness: a fake QueryInterface over an in-memory table
 * description. It proves the LOGIC — the column the model maps `notes` to, the
 * model's type, idempotent, reversible, registered in the manifest, and that a
 * real failure is NOT swallowed and recorded as applied. The DDL on PostgreSQL
 * is checked with `\d vendors` (see MEMORY/records/2026-09-30-correctness-batch.md).
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for the async QueryInterface: a throw inside them must be a rejection */
import * as fs from "fs";
import * as path from "path";
import { Sequelize, DataTypes } from "sequelize";

import migration from "../../migrations/0106-vendor-notes";
import defineVendor from "../../models/vendor.model";

type Context = Parameters<typeof migration.up>[0]["context"];
const ctx = (qi: object): Context => qi as Context;

interface Attribute {
  field: string;
  type: { key: string };
  allowNull?: boolean;
}

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0106-vendor-notes.ts"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");

const Vendor = defineVendor(new Sequelize({ dialect: "postgres", logging: false }));
const notesAttribute = (Vendor.getAttributes() as Record<string, unknown>)["notes"] as Attribute | undefined;

const BASE_COLUMNS = ["id", "tenant_id", "name", "address", "created_at"];

const fakeQueryInterface = ({ columns = BASE_COLUMNS, describeError = null }: { columns?: string[]; describeError?: Error | null } = {}) => {
  const state = { columns: new Set(columns), added: [] as string[], removed: [] as string[] };
  return {
    state,
    sequelize: { Sequelize },
    describeTable: jest.fn(async (table: string) => {
      expect(table).toBe("vendors");
      if (describeError) {
        throw describeError;
      }
      return Object.fromEntries([...state.columns].map((c) => [c, { type: "X" }]));
    }),
    addColumn: jest.fn(async (table: string, column: string) => {
      expect(table).toBe("vendors");
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

describe("migration 0106 — vendors.notes (Q-52)", () => {
  it("is registered in the static manifest under a .js name, after 0105", () => {
    const entry = '["0106-vendor-notes.js", require("../migrations/0106-vendor-notes")]';
    expect(MANIFEST).toContain(entry);
    expect(MANIFEST.indexOf(entry)).toBeGreaterThan(MANIFEST.indexOf('"0105-'));
  });

  it("adds exactly the column the model maps `notes` to, with the model's type, nullable", () => {
    expect(notesAttribute).toBeDefined();
    expect(Object.keys(migration.COLUMNS)).toEqual([notesAttribute?.field]);
    const spec = (migration.COLUMNS["notes"] as (typeof migration.COLUMNS)[string])(DataTypes) as unknown as Attribute;
    expect({ type: spec.type.key, allowNull: spec.allowNull }).toEqual({ type: notesAttribute?.type.key, allowNull: true });
    expect(notesAttribute?.allowNull).toBe(true);
  });

  it("up adds the column; a second run (or a sync()'d table) changes nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });
    expect(qi.state.added).toEqual(["notes"]);

    qi.addColumn.mockClear();
    await migration.up({ context: ctx(qi) });
    expect(qi.addColumn).not.toHaveBeenCalled();
  });

  it("up and down skip cleanly when the table does not exist yet", async () => {
    const missing = (): ReturnType<typeof fakeQueryInterface> =>
      fakeQueryInterface({ describeError: new Error('No description found for "vendors" table.') });
    await expect(migration.up({ context: ctx(missing()) })).resolves.toBeUndefined();
    await expect(migration.down({ context: ctx(missing()) })).resolves.toBeUndefined();
  });

  it("does NOT swallow any other failure — Umzug must not record it as applied", async () => {
    await expect(
      migration.up({ context: ctx(fakeQueryInterface({ describeError: new Error("connection reset") })) }),
    ).rejects.toThrow("connection reset");
    await expect(
      migration.down({ context: ctx(fakeQueryInterface({ describeError: new Error("connection reset") })) }),
    ).rejects.toThrow("connection reset");
    const qi = fakeQueryInterface();
    qi.addColumn.mockRejectedValueOnce(new Error("permission denied for table vendors"));
    await expect(migration.up({ context: ctx(qi) })).rejects.toThrow("permission denied");
  });

  it("down removes exactly this column, and is idempotent", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });
    await migration.down({ context: ctx(qi) });
    expect(qi.state.removed).toEqual(["notes"]);
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
  });
});
