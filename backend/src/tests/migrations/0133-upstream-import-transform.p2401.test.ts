/**
 * Migration 0133 — the transform role, `upstream_import.id_map` and `.quarantine`, and the run's
 * transform columns (P24-01). Pins what it ISSUES on each path, without a database; the grants
 * themselves are proved AS each role on PostgreSQL 18 by
 * tests/migrations/upstreamImportTransform.p2401.live.test.ts.
 *
 *  - refuses (never skips) when the run table, the staging schema, the import role or the
 *    application role is missing, when the import role cannot be SET to, when a role name is not
 *    a plain identifier, when the transform role cannot be created or SET to;
 *  - creates the bookkeeping AS the import role, revokes it from PUBLIC and the application role,
 *    grants the transform role exactly SELECT/INSERT/UPDATE on id_map and SELECT/INSERT/DELETE on
 *    quarantine, SELECT on staging (now and by default);
 *  - widens the vocabulary CHECK, adds each new CHECK only when absent;
 *  - `down` refuses while a decision or a transform status exists;
 *  - registered after 0132, no blanket try/catch.
 */
import * as fs from "fs";
import * as path from "path";
import m0133 from "../../migrations/0133-upstream-import-transform";
import { UPSTREAM_IMPORT_QUARANTINE_REASONS } from "@callibrator/contracts/upstreamSqlImport";
import { environment } from "../../config/env";

const penv = environment();

interface World {
  runTable: boolean;
  schema: boolean;
  importRole: boolean;
  appRole: boolean;
  canSetImport: boolean;
  transformRole: boolean;
  canCreateRole: boolean;
  canSetTransform: boolean;
  canGrant: boolean;
  constraints: string[];
  decisions: boolean;
  transformed: boolean;
}

const fakeContext = (world: Partial<World> = {}) => {
  const w: World = {
    runTable: true,
    schema: true,
    importRole: true,
    appRole: true,
    canSetImport: true,
    transformRole: false,
    canCreateRole: true,
    canSetTransform: false,
    canGrant: true,
    constraints: [],
    decisions: false,
    transformed: false,
    ...world,
  };
  const calls: string[] = [];
  const yes = (v: boolean) => Promise.resolve([[{ yes: v }], null]);
  const sequelize = {
    query: jest.fn((sql: string, options: { replacements?: Record<string, unknown> } = {}) => {
      calls.push(sql);
      const r = options.replacements ?? {};
      if (sql.includes("to_regclass('upstream_sql_imports')")) {
        return yes(w.runTable);
      }
      if (sql.includes("pg_namespace WHERE nspname = 'upstream_import'")) {
        return yes(w.schema);
      }
      if (sql.includes("rolname = 'callibrator_import'")) {
        return yes(w.importRole);
      }
      if (sql.includes("rolname = 'callibrator_app'")) {
        return yes(w.appRole);
      }
      if (sql.includes("pg_has_role")) {
        return yes(r["role"] === "callibrator_import" ? w.canSetImport : w.canSetTransform);
      }
      if (sql.includes("admin_option")) {
        return yes(w.canGrant);
      }
      if (sql.includes("FROM pg_roles WHERE rolname = :role)")) {
        return yes(w.transformRole);
      }
      if (sql.includes("rolsuper OR rolcreaterole")) {
        return yes(w.canCreateRole);
      }
      if (sql.includes("pg_constraint")) {
        return yes(w.constraints.includes(String(r["name"])));
      }
      if (sql.includes("to_regclass('upstream_import.")) {
        return yes(true);
      }
      if (sql.includes("EXISTS (SELECT 1 FROM upstream_import.")) {
        return yes(w.decisions);
      }
      if (sql.includes("transform_status <> 'not_available'")) {
        return yes(w.transformed);
      }
      return Promise.resolve([[], null]);
    }),
    transaction: jest.fn((fn: (t: object) => Promise<void>) => fn({})),
  };
  return { context: { sequelize } as unknown as Parameters<typeof m0133.up>[0]["context"], calls };
};

afterEach(() => {
  delete penv["UPSTREAM_TRANSFORM_DB_ROLE"];
  delete penv["UPSTREAM_IMPORT_DB_ROLE"];
  delete penv["DB_APP_ROLE"];
});

describe("0133 up", () => {
  it("builds the role, the bookkeeping AS the import role with its grants, then the run's columns, CHECKs and indexes", async () => {
    const { context, calls } = fakeContext();
    await m0133.up({ context });
    const at = (needle: string): number => calls.findIndex((c) => c.includes(needle));
    expect(calls[0]).toBe("SET LOCAL lock_timeout = '10s'");
    expect(calls).toContain("CREATE ROLE callibrator_transform NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS");
    expect(calls).toContain("GRANT callibrator_transform TO CURRENT_USER");
    expect(at("SET LOCAL ROLE callibrator_import")).toBeLessThan(at("CREATE TABLE IF NOT EXISTS upstream_import.id_map"));
    expect(at("CREATE TABLE IF NOT EXISTS upstream_import.quarantine")).toBeLessThan(at("RESET ROLE"));
    for (const statement of [
      "REVOKE ALL ON upstream_import.id_map, upstream_import.quarantine FROM PUBLIC",
      "REVOKE ALL ON upstream_import.id_map, upstream_import.quarantine FROM callibrator_app",
      "GRANT USAGE ON SCHEMA upstream_import TO callibrator_transform",
      "GRANT SELECT ON ALL TABLES IN SCHEMA upstream_import TO callibrator_transform",
      "GRANT INSERT, UPDATE ON upstream_import.id_map TO callibrator_transform",
      "GRANT INSERT, DELETE ON upstream_import.quarantine TO callibrator_transform",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA upstream_import GRANT SELECT ON TABLES TO callibrator_transform",
    ]) {
      expect(at(statement)).toBeGreaterThan(at("SET LOCAL ROLE callibrator_import"));
      expect(at(statement)).toBeLessThan(at("RESET ROLE"));
    }
    expect(calls.some((c) => /GRANT .*TO callibrator_app/.test(c))).toBe(false);
    // Nothing in `public`: every grant to the transform role names the staging schema (P24-02 grants its targets).
    expect(calls.filter((c) => c.endsWith(" TO callibrator_transform")).every((c) => c.includes("upstream_import"))).toBe(true);
    for (const [column] of m0133.RUN_COLUMNS) {
      expect(calls.some((c) => c.includes(`ADD COLUMN IF NOT EXISTS ${column} `))).toBe(true);
    }
    expect(calls).not.toContain("ALTER TABLE upstream_sql_imports DROP CONSTRAINT upstream_sql_imports_vocabulary");
    expect(calls).toContain(`ALTER TABLE upstream_sql_imports ADD CONSTRAINT upstream_sql_imports_vocabulary CHECK (${m0133.VOCABULARY_AFTER})`);
    for (const name of Object.keys(m0133.RUN_CHECKS)) {
      expect(calls.some((c) => c.includes(`ADD CONSTRAINT ${name} CHECK`))).toBe(true);
    }
    for (const statement of [...m0133.RUN_INDEX_SQL, ...m0133.BOOKKEEPING_INDEX_SQL]) {
      expect(calls).toContain(statement);
    }
    expect(m0133.VOCABULARY_AFTER).toContain("'not_available', 'transform_requested', 'transforming', 'transformed', 'transform_failed'");
  });

  it("the tables carry their rules: keys, hex hash, no user values, facility needs tenant, the reason vocabulary", async () => {
    const { context, calls } = fakeContext();
    await m0133.up({ context });
    const idMap = calls.find((c) => c.startsWith("CREATE TABLE IF NOT EXISTS upstream_import.id_map")) as string;
    expect(idMap).toContain("PRIMARY KEY (source_table, legacy_id)");
    expect(idMap).toContain("CHECK (source_row_hash ~ '^[0-9a-f]{64}$')");
    expect(idMap).toContain("CONSTRAINT id_map_no_user_values CHECK (source_table <> 'users' OR source_values IS NULL)");
    expect(idMap).toContain("CONSTRAINT id_map_facility_needs_tenant CHECK (client_facility_id IS NULL OR tenant_id IS NOT NULL)");
    const quarantine = calls.find((c) => c.startsWith("CREATE TABLE IF NOT EXISTS upstream_import.quarantine")) as string;
    expect(quarantine).toContain("PRIMARY KEY (import_run_id, source_table, source_row_number, reason)");
    expect(quarantine).toContain(`CHECK (reason IN (${UPSTREAM_IMPORT_QUARANTINE_REASONS.map((r) => `'${r}'`).join(", ")}))`);
  });

  it("re-run: an existing role it may SET to is used as is; the old vocabulary is replaced; existing CHECKs are kept", async () => {
    const { context, calls } = fakeContext({
      transformRole: true,
      canSetTransform: true,
      constraints: ["upstream_sql_imports_vocabulary", ...Object.keys(m0133.RUN_CHECKS)],
    });
    await m0133.up({ context });
    expect(calls.some((c) => c.startsWith("CREATE ROLE") || c.startsWith("GRANT callibrator_transform TO"))).toBe(false);
    expect(calls).toContain("ALTER TABLE upstream_sql_imports DROP CONSTRAINT upstream_sql_imports_vocabulary");
    expect(calls.filter((c) => c.includes("ADD CONSTRAINT upstream_sql_imports_transform"))).toEqual([]);
  });

  it("an existing role it may not SET to but may grant itself: GRANT TO CURRENT_USER", async () => {
    const { context, calls } = fakeContext({ transformRole: true });
    await m0133.up({ context });
    expect(calls).toContain("GRANT callibrator_transform TO CURRENT_USER");
  });

  it.each([
    ["the run table", { runTable: false }, /table upstream_sql_imports does not exist/],
    ["the schema", { schema: false }, /schema upstream_import does not exist/],
    ["the import role", { importRole: false }, /the import role "callibrator_import" does not exist/],
    ["the application role", { appRole: false }, /the application role "callibrator_app" does not exist/],
    ["SET ROLE to the import role", { canSetImport: false }, /cannot SET ROLE to the import role/],
    ["CREATEROLE for a missing transform role", { canCreateRole: false }, /cannot create it \(no CREATEROLE\)/],
    ["membership of an existing transform role", { transformRole: true, canGrant: false }, /can neither SET ROLE to it nor grant itself/],
  ])("refuses without %s — nothing built", async (_label, world, message) => {
    const { context, calls } = fakeContext(world);
    await expect(m0133.up({ context })).rejects.toThrow(message);
    expect(calls.some((c) => c.startsWith("CREATE TABLE"))).toBe(false);
  });

  it("role names come from the environment, and only plain identifiers are interpolated", async () => {
    penv["UPSTREAM_TRANSFORM_DB_ROLE"] = "etl_t";
    const { context, calls } = fakeContext();
    await m0133.up({ context });
    expect(calls).toContain("GRANT USAGE ON SCHEMA upstream_import TO etl_t");
    penv["UPSTREAM_TRANSFORM_DB_ROLE"] = "x; DROP ROLE y";
    await expect(m0133.up({ context: fakeContext().context })).rejects.toThrow("is not a plain lower-case identifier");
    expect(m0133.roleName("V", "fallback", "none")).toBe("fallback");
    expect(m0133.roleName("V", "fallback", "")).toBe("fallback");
    expect(m0133.roleName("V", "fallback", undefined)).toBe("fallback");
  });
});

describe("0133 down", () => {
  it("drops what up added, revoking the transform role's grants as the import role, and restores 0114's vocabulary", async () => {
    const { context, calls } = fakeContext({ transformRole: true });
    await m0133.down({ context });
    expect(calls).toContain("ALTER DEFAULT PRIVILEGES IN SCHEMA upstream_import REVOKE SELECT ON TABLES FROM callibrator_transform");
    expect(calls).toContain(
      "ALTER TABLE upstream_sql_imports ADD CONSTRAINT upstream_sql_imports_vocabulary CHECK (data_class IN ('synthetic', 'real') AND compression IN ('none', 'gzip') AND transform_status IN ('not_available'))",
    );
    expect(calls).toContain("DROP TABLE IF EXISTS upstream_import.id_map");
    expect(calls).toContain("DROP TABLE IF EXISTS upstream_import.quarantine");
    for (const [column] of m0133.RUN_COLUMNS) {
      expect(calls).toContain(`ALTER TABLE upstream_sql_imports DROP COLUMN IF EXISTS ${column}`);
    }
  });

  it("with no transform role there is nothing to revoke", async () => {
    const { context, calls } = fakeContext({ transformRole: false });
    await m0133.down({ context });
    expect(calls.some((c) => c.includes("REVOKE"))).toBe(false);
  });

  it("refuses while id_map or quarantine holds a decision, or a run has a transform status", async () => {
    await expect(m0133.down({ context: fakeContext({ decisions: true }).context })).rejects.toThrow("holds the import's decisions");
    await expect(m0133.down({ context: fakeContext({ transformed: true }).context })).rejects.toThrow("has a transform status");
  });
});

describe("0133 registration", () => {
  it("is registered right after 0132, and has no try/catch", () => {
    const manifest = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
    const names = [...manifest.matchAll(/\["(\d{4}-[\w.-]+\.js)"/g)].map((m) => m[1]);
    expect(names.indexOf("0133-upstream-import-transform.js")).toBe(names.indexOf("0132-client-facilities-menu-active.js") + 1);
    const source = fs.readFileSync(path.join(__dirname, "../../migrations/0133-upstream-import-transform.ts"), "utf8");
    expect(source).not.toMatch(/\btry\s*\{/);
  });
});
