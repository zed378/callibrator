/**
 * Migration 0108 — tenant_backups.name / .description (A-363).
 *
 * The 0106 suite's harness: a fake QueryInterface over an in-memory table
 * description. It proves the LOGIC — the columns the model maps `name` and
 * `description` to, the model's types and lengths, idempotent, reversible,
 * registered in the manifest, and that a real failure is NOT swallowed and
 * recorded as applied. The DDL on PostgreSQL 18 (up/down/up, as the
 * application role) is in MEMORY/records/2026-10-02-a359-a363.md.
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for the async QueryInterface: a throw inside them must be a rejection */
import * as fs from "fs";
import * as path from "path";
import { Sequelize, DataTypes } from "sequelize";

import migration from "../../migrations/0108-tenant-backup-name-description";
import defineTenantBackup from "../../models/tenantBackup.model";

type Context = Parameters<typeof migration.up>[0]["context"];
const ctx = (qi: object): Context => qi as Context;

interface Attribute {
  field: string;
  type: { key: string; options?: { length?: number } };
  allowNull?: boolean;
}

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0108-tenant-backup-name-description.ts"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");

const TenantBackup = defineTenantBackup(new Sequelize({ dialect: "postgres", logging: false }), DataTypes);
const attributeOf = (name: string): Attribute | undefined =>
  (TenantBackup.getAttributes() as Record<string, unknown>)[name] as Attribute | undefined;

const BASE_COLUMNS = ["id", "tenant_id", "status", "file_path", "created_at"];

const fakeQueryInterface = ({ columns = BASE_COLUMNS, describeError = null }: { columns?: string[]; describeError?: Error | null } = {}) => {
  const state = { columns: new Set(columns), added: [] as string[], removed: [] as string[] };
  return {
    state,
    sequelize: { Sequelize },
    describeTable: jest.fn(async (table: string) => {
      expect(table).toBe("tenant_backups");
      if (describeError) {
        throw describeError;
      }
      return Object.fromEntries([...state.columns].map((c) => [c, { type: "X" }]));
    }),
    addColumn: jest.fn(async (table: string, column: string) => {
      expect(table).toBe("tenant_backups");
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

describe("migration 0108 — tenant_backups.name / .description (A-363)", () => {
  it("is registered in the static manifest under a .js name, after 0107", () => {
    const entry = '["0108-tenant-backup-name-description.js", require("../migrations/0108-tenant-backup-name-description")]';
    expect(MANIFEST).toContain(entry);
    expect(MANIFEST.indexOf(entry)).toBeGreaterThan(MANIFEST.indexOf('"0107-'));
  });

  it("adds exactly the columns the model maps `name` and `description` to, with the model's types and lengths, nullable", () => {
    const model = ["name", "description"].map(attributeOf);
    expect(Object.keys(migration.COLUMNS)).toEqual(model.map((a) => a?.field));
    for (const attribute of model) {
      const spec = (migration.COLUMNS[attribute?.field ?? ""] as (typeof migration.COLUMNS)[string])(DataTypes) as unknown as Attribute;
      expect({ type: spec.type.key, length: spec.type.options?.length, allowNull: spec.allowNull }).toEqual({
        type: attribute?.type.key,
        length: attribute?.type.options?.length,
        allowNull: true,
      });
      expect(attribute?.allowNull).toBe(true);
    }
    expect(model.map((a) => a?.type.options?.length)).toEqual([100, 500]);
  });

  it("up adds the columns; a second run (or a sync()'d table) changes nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });
    expect(qi.state.added).toEqual(["name", "description"]);

    qi.addColumn.mockClear();
    await migration.up({ context: ctx(qi) });
    expect(qi.addColumn).not.toHaveBeenCalled();
  });

  it("up and down skip cleanly when the table does not exist yet", async () => {
    const missing = (): ReturnType<typeof fakeQueryInterface> =>
      fakeQueryInterface({ describeError: new Error('No description found for "tenant_backups" table.') });
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
    qi.addColumn.mockRejectedValueOnce(new Error("permission denied for table tenant_backups"));
    await expect(migration.up({ context: ctx(qi) })).rejects.toThrow("permission denied");
  });

  it("down removes exactly these columns, and is idempotent", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });
    await migration.down({ context: ctx(qi) });
    expect(qi.state.removed).toEqual(["name", "description"]);
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
