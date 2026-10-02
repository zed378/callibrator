/**
 * Migration 0024 — per-tenant NC/CAPA number uniqueness (A-73).
 *
 * Runs the migration against a fake QueryInterface. It proves the LOGIC: it
 * refuses on duplicates before any DDL, the unique indexes are per tenant
 * (never global), it is idempotent and reversible, and a real failure is not
 * swallowed. The DDL itself was run against pgvector/pgvector:pg18 and
 * checked with `\d non_conformances`, `\d capas`, `\d qms_counters` — including
 * the refusal on a real count()+1 duplicate (see the A-73 record).
 *
 * P9-23: 0024 is TypeScript now (its recorded name is still
 * "0024-qms-number-uniqueness.js"); this suite reads the .ts source.
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for the async QueryInterface: a throw inside them must be a rejection */
import * as fs from "fs";
import * as path from "path";
import { Sequelize } from "sequelize";

import migration from "../../migrations/0024-qms-number-uniqueness";

type Context = Parameters<typeof migration.up>[0]["context"];
const ctx = (qi: object): Context => qi as Context;

interface ColumnSpec {
  primaryKey?: boolean;
  references?: unknown;
  onDelete?: string;
  allowNull?: boolean;
}
interface IndexDdl {
  table: string;
  fields: string[];
  options: { name: string; unique?: boolean };
}

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0024-qms-number-uniqueness.ts"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
// P9-16: the service is TypeScript (re-keyed, ADR-087).
const SERVICE = fs.readFileSync(path.join(__dirname, "../../services/qms.service.ts"), "utf8");

const fakeQueryInterface = ({
  tables = ["tenants", "non_conformances", "capas"],
  duplicates = {},
  indexes = {},
}: {
  tables?: string[];
  duplicates?: Record<string, { tenant_id: string; number: string; copies: number }[] | undefined>;
  indexes?: Record<string, string[]>;
} = {}) => {
  const state = {
    tables: new Set(tables),
    indexes: new Map(Object.entries(indexes).map(([t, names]) => [t, new Set(names)])),
    created: [] as { table: string; spec: Record<string, ColumnSpec> }[],
    ddl: [] as (string | IndexDdl)[],
  };
  const qi = {
    state,
    sequelize: {
      Sequelize,
      query: jest.fn(async (sql: string) => {
        const table = (/FROM (\w+)/.exec(sql) as RegExpMatchArray & [string, string])[1];
        return [duplicates[table] ?? [], {}];
      }),
    },
    showAllTables: jest.fn(async () => [...state.tables].map((tableName) => ({ tableName, schema: "public" }))),
    showIndex: jest.fn(async (table: string) => [...(state.indexes.get(table) ?? [])].map((name) => ({ name }))),
    createTable: jest.fn(async (table: string, spec: Record<string, ColumnSpec>) => {
      if (state.tables.has(table)) {throw new Error(`relation "${table}" already exists`);}
      state.tables.add(table);
      state.created.push({ table, spec });
      state.ddl.push(`create ${table}`);
    }),
    dropTable: jest.fn(async (table: string) => {
      state.tables.delete(table);
      state.ddl.push(`drop ${table}`);
    }),
    addIndex: jest.fn(async (table: string, fields: string[], options: { name: string; unique?: boolean }) => {
      if (!state.indexes.has(table)) {state.indexes.set(table, new Set());}
      const names = state.indexes.get(table) as Set<string>;
      if (names.has(options.name)) {throw new Error(`relation "${options.name}" already exists`);}
      names.add(options.name);
      state.ddl.push({ table, fields, options });
    }),
    removeIndex: jest.fn(async (table: string, name: string) => {
      (state.indexes.get(table) as Set<string>).delete(name);
      state.ddl.push(`removeIndex ${name}`);
    }),
  };
  return qi;
};

const failure = async (promise: Promise<void>): Promise<Error> => (await promise.catch((e: unknown) => e)) as Error;

describe("migration 0024 — QMS number uniqueness", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0024-qms-number-uniqueness.js", require("../migrations/0024-qms-number-uniqueness")]',
    );
  });

  it("adds a UNIQUE index per table on (tenant_id, number) — per tenant, never global", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: ctx(qi) });

    const indexes = qi.state.ddl.filter((d): d is IndexDdl => typeof d === "object");
    expect(indexes).toEqual([
      {
        table: "non_conformances",
        fields: ["tenant_id", "nc_number"],
        options: { name: "non_conformances_tenant_id_nc_number_unique", unique: true },
      },
      {
        table: "capas",
        fields: ["tenant_id", "capa_number"],
        options: { name: "capas_tenant_id_capa_number_unique", unique: true },
      },
    ]);
    // A unique over the number alone would be a cross-tenant existence oracle.
    for (const { fields } of indexes) {
      expect(fields[0]).toBe("tenant_id");
    }
  });

  it("creates qms_counters keyed by (tenant_id, kind) — the ON CONFLICT target the service names", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: ctx(qi) });

    const [{ table, spec }] = qi.state.created as [{ table: string; spec: Record<string, ColumnSpec> }];
    expect(table).toBe("qms_counters");
    expect(Object.keys(spec).filter((c) => spec[c]?.primaryKey)).toEqual(["tenant_id", "kind"]);
    expect(spec["tenant_id"]?.references).toEqual({ model: "tenants", key: "id" });
    expect(spec["tenant_id"]?.onDelete).toBe("CASCADE");
    expect(spec["seq"]?.allowNull).toBe(false);
    // The service's statement must target exactly this table and key.
    expect(SERVICE).toContain("INSERT INTO qms_counters (tenant_id, kind, seq, created_at, updated_at)");
    expect(SERVICE).toContain("ON CONFLICT (tenant_id, kind)");
  });

  it("REFUSES on duplicate numbers within a tenant, naming them, before any DDL", async () => {
    const qi = fakeQueryInterface({
      duplicates: {
        non_conformances: [{ tenant_id: "t-1", number: "NC-00001", copies: 2 }],
        capas: [{ tenant_id: "t-2", number: "CAPA-00003", copies: 3 }],
      },
    });

    const err = await failure(migration.up({ context: ctx(qi) }));

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/Migration 0024 refused: 2 NC\/CAPA number\(s\)/);
    expect(err.message).toContain("non_conformances.nc_number = 'NC-00001' ×2 in tenant t-1");
    expect(err.message).toContain("capas.capa_number = 'CAPA-00003' ×3 in tenant t-2");
    expect(err.message).toMatch(/will not renumber/);
    // Nothing half-applied: Umzug records nothing, and a re-run starts clean.
    expect(qi.state.ddl).toEqual([]);
  });

  it("summarises a long duplicate list instead of printing every row", async () => {
    const many = Array.from({ length: 23 }, (_, i) => ({ tenant_id: "t-1", number: `NC-${String(i)}`, copies: 2 }));
    const qi = fakeQueryInterface({ duplicates: { non_conformances: many } });

    const err = await failure(migration.up({ context: ctx(qi) }));

    expect(err.message).toMatch(/refused: 23 /);
    expect(err.message).toContain("… and 3 more in non_conformances");
    expect(err.message.match(/×2 in tenant/g)).toHaveLength(20);
  });

  it("the duplicate check counts soft-deleted rows too — a number is never re-issued", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: ctx(qi) });

    for (const [sql] of qi.sequelize.query.mock.calls) {
      expect(sql).toMatch(/GROUP BY tenant_id, \w+_number/);
      expect(sql).not.toMatch(/deleted_at/);
    }
  });

  it("up is idempotent — a second run changes nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });
    const after = qi.state.ddl.length;

    await migration.up({ context: ctx(qi) });

    expect(qi.state.ddl).toHaveLength(after);
  });

  it("a QMS table that does not exist yet is skipped; the counter table is still created", async () => {
    const qi = fakeQueryInterface({ tables: ["tenants"] });

    await migration.up({ context: ctx(qi) });

    expect(qi.sequelize.query).not.toHaveBeenCalled();
    expect(qi.state.ddl).toEqual(["create qms_counters"]);
  });

  it("any failure propagates — Umzug must not record it as applied", async () => {
    const qi = fakeQueryInterface();
    qi.sequelize.query.mockRejectedValueOnce(new Error("permission denied for table non_conformances"));
    await expect(migration.up({ context: ctx(qi) })).rejects.toThrow("permission denied");

    const qi2 = fakeQueryInterface();
    qi2.addIndex.mockRejectedValueOnce(new Error("could not create unique index"));
    await expect(migration.up({ context: ctx(qi2) })).rejects.toThrow("could not create unique index");
  });

  it("down removes both indexes and the counter table, and is idempotent", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });

    await migration.down({ context: ctx(qi) });
    expect(qi.state.tables.has("qms_counters")).toBe(false);
    expect([...(qi.state.indexes.get("non_conformances") as Set<string>)]).toEqual([]);
    expect([...(qi.state.indexes.get("capas") as Set<string>)]).toEqual([]);

    qi.removeIndex.mockClear();
    qi.dropTable.mockClear();
    await migration.down({ context: ctx(qi) });
    expect(qi.removeIndex).not.toHaveBeenCalled();
    expect(qi.dropTable).not.toHaveBeenCalled();
  });

  it("down skips tables that are absent", async () => {
    const qi = fakeQueryInterface({ tables: [] });

    await expect(migration.down({ context: ctx(qi) })).resolves.toBeUndefined();
    expect(qi.showIndex).not.toHaveBeenCalled();
  });

  it("has no try/catch at all (CLAUDE.md traps table: a blanket catch records a no-op as applied)", () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bcatch\b/);
  });
});
