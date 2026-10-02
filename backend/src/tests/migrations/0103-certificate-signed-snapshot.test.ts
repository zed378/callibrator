/**
 * Migration 0103 — certificates.signed_snapshot (ADR-107, Q-50).
 *
 * A fake QueryInterface over an in-memory table description (the 0023/0102
 * harness): the column's name is the model's own underscored field, it is
 * JSONB and nullable, up is idempotent, NOTHING is back-filled (no UPDATE, no
 * raw SQL — an invented snapshot would be a false record of the signing),
 * down is reversible, and a real failure propagates. The DDL itself was run
 * on PostgreSQL 18 (see the record).
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for the async QueryInterface: a throw inside them must be a rejection */
import * as fs from "fs";
import * as path from "path";
import { Sequelize, DataTypes } from "sequelize";

import migration from "../../migrations/0103-certificate-signed-snapshot";
import defineCertificate from "../../models/certificate.model";

type Context = Parameters<typeof migration.up>[0]["context"];
const ctx = (qi: object): Context => qi as Context;

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0103-certificate-signed-snapshot.ts"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");

const Certificate = defineCertificate(new Sequelize({ dialect: "postgres", logging: false }), DataTypes);
const attribute = (Certificate.getAttributes() as Record<string, { field: string; type: { key: string }; allowNull?: boolean }>)["signedSnapshot"];

const BASE = ["id", "tenant_id", "certificate_number", "status", "signed_at"];

const fakeQueryInterface = ({ columns = BASE, describeError = null }: { columns?: string[]; describeError?: Error | null } = {}) => {
  const state = { columns: new Set(columns), added: [] as { column: string; spec: { type: { key: string }; allowNull: boolean } }[] };
  return {
    state,
    sequelize: { Sequelize, query: jest.fn() },
    describeTable: jest.fn(async (table: string) => {
      expect(table).toBe("certificates");
      if (describeError) {
        throw describeError;
      }
      return Object.fromEntries([...state.columns].map((c) => [c, { type: "X" }]));
    }),
    addColumn: jest.fn(async (_t: string, column: string, spec: { type: { key: string }; allowNull: boolean }) => {
      if (state.columns.has(column)) {
        throw new Error(`column "${column}" already exists`);
      }
      state.columns.add(column);
      state.added.push({ column, spec });
    }),
    removeColumn: jest.fn(async (_t: string, column: string) => {
      state.columns.delete(column);
    }),
    bulkUpdate: jest.fn(),
  };
};

describe("migration 0103 — certificates.signed_snapshot (ADR-107)", () => {
  it("is in the manifest under a .js name, after 0102", () => {
    const entry = '["0103-certificate-signed-snapshot.js", require("../migrations/0103-certificate-signed-snapshot")]';
    expect(MANIFEST).toContain(entry);
    expect(MANIFEST.indexOf(entry)).toBeGreaterThan(MANIFEST.indexOf('"0102-'));
  });

  it("adds the model's own column — JSONB, nullable — and nothing else", async () => {
    expect(attribute?.field).toBe(migration.COLUMN);
    expect(attribute?.type.key).toBe("JSONB");
    expect(attribute?.allowNull).toBe(true);
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });
    expect(qi.state.added).toHaveLength(1);
    expect(qi.state.added[0]?.column).toBe("signed_snapshot");
    expect(qi.state.added[0]?.spec.type.key).toBe("JSONB");
    expect(qi.state.added[0]?.spec.allowNull).toBe(true);
  });

  it("back-fills nothing: no query, no update — an already-signed certificate keeps a NULL snapshot (it stays v2)", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });
    expect(qi.sequelize.query).not.toHaveBeenCalled();
    expect(qi.bulkUpdate).not.toHaveBeenCalled();
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\.query\(|UPDATE\s|bulkUpdate/i);
  });

  it("is idempotent, and down removes the column (idempotently)", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });
    qi.addColumn.mockClear();
    await migration.up({ context: ctx(qi) });
    expect(qi.addColumn).not.toHaveBeenCalled();
    await migration.down({ context: ctx(qi) });
    expect([...qi.state.columns].sort()).toEqual([...BASE].sort());
    qi.removeColumn.mockClear();
    await migration.down({ context: ctx(qi) });
    expect(qi.removeColumn).not.toHaveBeenCalled();
  });

  it("skips an absent table, and propagates anything else (Umzug must not record a failure as applied)", async () => {
    const missing = new Error('No description found for "certificates" table.');
    await expect(migration.up({ context: ctx(fakeQueryInterface({ describeError: missing })) })).resolves.toBeUndefined();
    await expect(migration.down({ context: ctx(fakeQueryInterface({ describeError: missing })) })).resolves.toBeUndefined();
    await expect(
      migration.up({ context: ctx(fakeQueryInterface({ describeError: new TypeError("describeTable is not a function") })) }),
    ).rejects.toThrow("describeTable is not a function");
    await expect(
      migration.down({ context: ctx(fakeQueryInterface({ describeError: new Error("connection reset") })) }),
    ).rejects.toThrow("connection reset");
    const failing = fakeQueryInterface();
    failing.addColumn.mockRejectedValueOnce(new Error("permission denied for table certificates"));
    await expect(migration.up({ context: ctx(failing) })).rejects.toThrow("permission denied");
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
