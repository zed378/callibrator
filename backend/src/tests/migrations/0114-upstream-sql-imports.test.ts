/**
 * Migration 0114 — the SQL-dump import's run table, import role and staging
 * schema (P24-06). Pins what it ISSUES on each path, without a database; the
 * grants themselves are proved AS each role on PostgreSQL 18 by
 * tests/services/upstreamSqlImport.p2406.live.test.ts.
 *
 *  - refuses (never skips) when a table it builds on or the application role
 *    is missing, when a role name is not a plain identifier, when the import
 *    role cannot be created, or cannot be SET to;
 *  - creates the table only when absent, each CHECK only when absent;
 *  - REVOKEs DELETE / TRUNCATE on the runs from the application role, and
 *    every privilege on the staging schema from PUBLIC and the application role;
 *  - `down` refuses while a run or a staged row exists;
 *  - registered after 0113, no blanket try/catch.
 */
import * as fs from "fs";
import * as path from "path";
import m0114 from "../../migrations/0114-upstream-sql-imports";
import { environment } from "../../config/env";

const penv = environment();

interface World {
  tables?: boolean;
  appRole?: boolean;
  runsTable?: boolean;
  constraints?: string[];
  importRole?: boolean;
  canCreateRole?: boolean;
  canSet?: boolean;
  canGrant?: boolean;
  runs?: boolean;
  staged?: { name: string; rows: boolean }[];
}

const fakeContext = (world: World = {}) => {
  const w = { tables: true, appRole: true, runsTable: false, constraints: [], importRole: false, canCreateRole: true, canSet: false, canGrant: true, runs: false, staged: [], ...world };
  const calls: string[] = [];
  const yes = (v: boolean) => Promise.resolve([[{ yes: v }], null]);
  const sequelize = {
    query: jest.fn((sql: string, options: { replacements?: Record<string, unknown> } = {}) => {
      calls.push(sql);
      const r = options.replacements ?? {};
      if (sql.includes(":required")) {
        return yes(w.tables);
      }
      if (sql.includes(":appRole")) {
        return yes(w.appRole);
      }
      if (sql.includes("to_regclass('upstream_sql_imports')")) {
        return yes(w.runsTable);
      }
      if (sql.includes("pg_constraint")) {
        return yes(w.constraints.includes(String(r["name"])));
      }
      if (sql.includes("admin_option")) {
        return yes(w.canGrant);
      }
      if (sql.includes("FROM pg_roles WHERE rolname = :role)")) {
        return yes(w.importRole);
      }
      if (sql.includes("rolsuper OR rolcreaterole")) {
        return yes(w.canCreateRole);
      }
      if (sql.includes("pg_has_role")) {
        return yes(w.canSet);
      }
      if (sql.includes("EXISTS (SELECT 1 FROM upstream_sql_imports)")) {
        return yes(w.runs);
      }
      if (sql.includes("relkind = 'r'")) {
        return Promise.resolve([w.staged.map((t) => ({ name: t.name })), null]);
      }
      const staged = /EXISTS \(SELECT 1 FROM upstream_import\."([a-z_]+)"\)/.exec(sql);
      if (staged) {
        return yes(w.staged.find((t) => t.name === staged[1])?.rows ?? false);
      }
      return Promise.resolve([[], null]);
    }),
    transaction: jest.fn((fn: (t: object) => Promise<void>) => fn({})),
  };
  const createTable = jest.fn(() => Promise.resolve());
  const context: unknown = { sequelize, createTable };
  return { context: context as never, calls, createTable };
};

afterEach(() => {
  delete penv["DB_APP_ROLE"];
  delete penv["UPSTREAM_IMPORT_DB_ROLE"];
});

describe("migration 0114 — upstream_sql_imports, the import role, the staging schema", () => {
  it("on a fresh database: the table, five CHECKs, the indexes, the revokes, the role, the closed schema", async () => {
    const f = fakeContext();
    await m0114.up({ context: f.context });
    expect(f.createTable).toHaveBeenCalledTimes(1);
    expect(f.calls.filter((c) => c.startsWith("ALTER TABLE upstream_sql_imports ADD CONSTRAINT"))).toHaveLength(5);
    expect(f.calls).toEqual(expect.arrayContaining([
      ...m0114.INDEX_SQL,
      "REVOKE DELETE, TRUNCATE ON upstream_sql_imports FROM callibrator_app",
      "CREATE ROLE callibrator_import NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS",
      "GRANT callibrator_import TO CURRENT_USER",
      "CREATE SCHEMA IF NOT EXISTS upstream_import AUTHORIZATION callibrator_import",
      "ALTER SCHEMA upstream_import OWNER TO callibrator_import",
      "REVOKE ALL ON SCHEMA upstream_import FROM PUBLIC",
      "REVOKE ALL ON SCHEMA upstream_import FROM callibrator_app",
      "REVOKE ALL ON ALL TABLES IN SCHEMA upstream_import FROM PUBLIC",
      "REVOKE ALL ON ALL TABLES IN SCHEMA upstream_import FROM callibrator_app",
    ]));
    expect(m0114.INDEX_SQL).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS upstream_sql_imports_one_active ON upstream_sql_imports ((true)) WHERE status IN ('uploaded', 'scanning', 'parsing')",
    );
  });

  it("re-run (sync made the table, the role exists and is SET-able): nothing created twice", async () => {
    const f = fakeContext({ runsTable: true, constraints: Object.keys(m0114.CHECKS), importRole: true, canSet: true });
    await m0114.up({ context: f.context });
    expect(f.createTable).not.toHaveBeenCalled();
    expect(f.calls.some((c) => c.includes("ADD CONSTRAINT") || c.startsWith("CREATE ROLE") || c.startsWith("GRANT "))).toBe(false);
  });

  it("names its roles from DB_APP_ROLE and UPSTREAM_IMPORT_DB_ROLE, and refuses one that is not a plain identifier", async () => {
    penv["DB_APP_ROLE"] = "app_role";
    penv["UPSTREAM_IMPORT_DB_ROLE"] = "import_role";
    const f = fakeContext();
    await m0114.up({ context: f.context });
    expect(f.calls).toEqual(expect.arrayContaining(["REVOKE ALL ON SCHEMA upstream_import FROM app_role", "CREATE SCHEMA IF NOT EXISTS upstream_import AUTHORIZATION import_role"]));
    penv["UPSTREAM_IMPORT_DB_ROLE"] = "x; DROP ROLE y";
    await expect(m0114.up({ context: fakeContext().context })).rejects.toThrow(/not a plain lower-case identifier/);
    expect(m0114.roleName("V", "fallback", "none")).toBe("fallback");
  });

  it.each([
    ["a table it builds on is missing", { tables: false }, /table users does not exist/],
    ["the application role is missing", { appRole: false }, /application role "callibrator_app" does not exist/],
    ["the import role cannot be created", { canCreateRole: false }, /cannot create it/],
    ["the import role exists and cannot be SET to or granted", { importRole: true, canGrant: false }, /can neither SET ROLE/],
  ])("refuses when %s — never recorded as applied with nothing built", async (_label, world, message) => {
    await expect(m0114.up({ context: fakeContext(world).context })).rejects.toThrow(message);
  });

  it("down drops the schema, the table and its type — and refuses while a run or a staged row exists", async () => {
    const f = fakeContext({ runsTable: true, staged: [{ name: "stg_users", rows: false }] });
    await m0114.down({ context: f.context });
    expect(f.calls).toEqual(expect.arrayContaining(["DROP SCHEMA IF EXISTS upstream_import CASCADE", "DROP TABLE IF EXISTS upstream_sql_imports", "DROP TYPE IF EXISTS enum_upstream_sql_imports_status"]));
    await expect(m0114.down({ context: fakeContext({ runsTable: true, runs: true }).context })).rejects.toThrow(/holds import runs/);
    await expect(m0114.down({ context: fakeContext({ staged: [{ name: "stg_users", rows: true }] }).context })).rejects.toThrow(/holds staged rows/);
  });

  it("is registered after 0113 and has no blanket try/catch", () => {
    const manifest = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
    expect(manifest.indexOf('"0114-upstream-sql-imports.js"')).toBeGreaterThan(manifest.indexOf('"0113-upstream-file-imports.js"'));
    const source = fs.readFileSync(path.join(__dirname, "../../migrations/0114-upstream-sql-imports.ts"), "utf8");
    expect(/\btry\s*\{/.test(source)).toBe(false);
  });
});
