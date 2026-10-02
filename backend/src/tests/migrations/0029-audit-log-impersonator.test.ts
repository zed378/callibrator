/**
 * Migration 0029 — audit_logs.impersonator_id (F-8).
 *
 * Runs the migration against a fake QueryInterface over an in-memory table
 * description. It proves the LOGIC: the column it adds and under which name
 * (taken from the MODEL's field mapping, so a camelCase column cannot pass),
 * that it is idempotent and reversible, and that a real failure is NOT
 * swallowed and recorded as applied (0008/0013/0014). It does not prove the
 * DDL runs on PostgreSQL — check `\d audit_logs` after `make migrate`.
 *
 * P9-23: 0029 is TypeScript now (its recorded name is still
 * "0029-audit-log-impersonator.js"); this suite reads the .ts source.
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for the async QueryInterface: a throw inside them must be a rejection */
import * as fs from "fs";
import * as path from "path";
import { Sequelize, DataTypes } from "sequelize";

import migration from "../../migrations/0029-audit-log-impersonator";
import defineAuditLog from "../../models/auditLog.model";

type Context = Parameters<typeof migration.up>[0]["context"];
const ctx = (qi: object): Context => qi as Context;

/** The parts of a column spec / model attribute these assertions read. */
interface Attribute {
  field: string;
  type: { key: string };
  allowNull?: boolean;
  references?: unknown;
  onDelete?: string;
}

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0029-audit-log-impersonator.ts"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");

/** The REAL AuditLog model on an unconnected PostgreSQL-dialect Sequelize. */
const AuditLog = defineAuditLog(new Sequelize({ dialect: "postgres", logging: false }));

const BASE_COLUMNS = ["id", "tenant_id", "user_id", "action", "resource_type", "created_at"];

const fakeQueryInterface = ({
  columns = BASE_COLUMNS,
  indexes = [],
  describeError = null,
}: { columns?: string[]; indexes?: string[]; describeError?: Error | null } = {}) => {
  const state = {
    columns: new Set(columns),
    indexes: new Set(indexes),
    added: [] as { column: string; spec: unknown }[],
    removed: [] as string[],
  };
  const qi = {
    state,
    sequelize: { Sequelize },
    describeTable: jest.fn(async (table: string) => {
      expect(table).toBe("audit_logs");
      if (describeError) {throw describeError;}
      return Object.fromEntries([...state.columns].map((c) => [c, { type: "X" }]));
    }),
    addColumn: jest.fn(async (table: string, column: string, spec: unknown) => {
      expect(table).toBe("audit_logs");
      if (state.columns.has(column)) {throw new Error(`column "${column}" already exists`);}
      state.columns.add(column);
      state.added.push({ column, spec });
    }),
    removeColumn: jest.fn(async (_table: string, column: string) => {
      state.columns.delete(column);
      state.removed.push(column);
    }),
    showIndex: jest.fn(async () => [...state.indexes].map((name) => ({ name }))),
    addIndex: jest.fn(async (_table: string, fields: string[], { name }: { name: string }) => {
      if (state.indexes.has(name)) {throw new Error(`relation "${name}" already exists`);}
      for (const f of fields) {
        if (!state.columns.has(f)) {throw new Error(`column "${f}" does not exist`);}
      }
      state.indexes.add(name);
    }),
    removeIndex: jest.fn(async (_table: string, name: string) => {
      state.indexes.delete(name);
    }),
  };
  return qi;
};

describe("migration 0029 — audit_logs.impersonator_id", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0029-audit-log-impersonator.js", require("../migrations/0029-audit-log-impersonator")]',
    );
  });

  it("adds the column the model maps impersonatorId to, with the model's type, nullable", () => {
    const attribute = (AuditLog.getAttributes() as Record<string, unknown>)["impersonatorId"] as Attribute;
    expect(migration.COLUMN).toBe(attribute.field);
    expect(migration.COLUMN).toBe("impersonator_id");
    const spec = migration.columnSpec(DataTypes) as unknown as Attribute;
    expect(spec.type.key).toBe(attribute.type.key);
    expect(spec.allowNull).toBe(true);
    // Mirrors user_id: a foreign key to users, SET NULL on delete.
    expect(spec.references).toEqual({ model: "users", key: "id" });
    expect(spec.onDelete).toBe("SET NULL");
  });

  it("up adds the column and its index", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: ctx(qi) });

    expect(qi.state.added.map((a) => a.column)).toEqual(["impersonator_id"]);
    expect(qi.addIndex).toHaveBeenCalledWith("audit_logs", ["impersonator_id"], {
      name: "audit_logs_impersonator_id",
    });
  });

  it("up is idempotent — a second run (or a fresh db.sync()'d table) changes nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });
    qi.addColumn.mockClear();
    qi.addIndex.mockClear();

    await migration.up({ context: ctx(qi) });

    expect(qi.addColumn).not.toHaveBeenCalled();
    expect(qi.addIndex).not.toHaveBeenCalled();
  });

  it("up skips cleanly when the table does not exist yet", async () => {
    const qi = fakeQueryInterface({ describeError: new Error('No description found for "audit_logs" table.') });

    await expect(migration.up({ context: ctx(qi) })).resolves.toBeUndefined();
    expect(qi.addColumn).not.toHaveBeenCalled();
  });

  it("up does NOT swallow any other failure — Umzug must not record it as applied", async () => {
    const qi = fakeQueryInterface({ describeError: new TypeError("context.describeTable is not a function") });

    await expect(migration.up({ context: ctx(qi) })).rejects.toThrow("describeTable is not a function");
  });

  it("an addColumn failure propagates", async () => {
    const qi = fakeQueryInterface();
    qi.addColumn.mockRejectedValueOnce(new Error("permission denied for table audit_logs"));

    await expect(migration.up({ context: ctx(qi) })).rejects.toThrow("permission denied");
  });

  it("down removes the index and the column, and is idempotent", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });

    await migration.down({ context: ctx(qi) });
    expect(qi.state.removed).toEqual(["impersonator_id"]);
    expect(qi.state.indexes.size).toBe(0);
    expect([...qi.state.columns].sort()).toEqual([...BASE_COLUMNS].sort());

    qi.removeColumn.mockClear();
    qi.removeIndex.mockClear();
    await migration.down({ context: ctx(qi) });
    expect(qi.removeColumn).not.toHaveBeenCalled();
    expect(qi.removeIndex).not.toHaveBeenCalled();
  });

  it("down skips when the table is absent, and propagates anything else", async () => {
    await expect(
      migration.down({ context: ctx(fakeQueryInterface({ describeError: new Error('relation "audit_logs" does not exist') })) }),
    ).resolves.toBeUndefined();
    await expect(
      migration.down({ context: ctx(fakeQueryInterface({ describeError: new Error("connection reset") })) }),
    ).rejects.toThrow("connection reset");
  });

  describe("no blanket catch (CLAUDE.md traps table)", () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    it("has no `catch {` — a catch that cannot even look at what it caught", () => {
      expect(code).not.toMatch(/catch\s*\{/);
    });

    it("has exactly one catch, and it re-throws what it does not recognise", () => {
      const catches = [...code.matchAll(/catch\s*\(\s*(\w+)\s*\)/g)];
      expect(catches).toHaveLength(1);
      const [match, name] = catches[0] as RegExpExecArray & [string, string];
      const start = code.indexOf(match);
      const body = code.slice(start, code.indexOf("\n};", start));
      expect(body).toContain(`throw ${name};`);
    });
  });
});
