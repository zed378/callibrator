/**
 * Migration 0134 — the run's provider tenant, the facilities quarantine reason, the transform
 * role's first grants in `public` (P24-02a). Pins what it ISSUES on each path, without a
 * database; the grants are proved AS the transform role on PostgreSQL 18 by
 * tests/migrations/upstreamTransform.p2402a.live.test.ts.
 */
import * as fs from "fs";
import * as path from "path";
import m0134 from "../../migrations/0134-upstream-transform-facilities";
import { UPSTREAM_IMPORT_QUARANTINE_REASONS } from "@callibrator/contracts/upstreamSqlImport";
import { environment } from "../../config/env";

const penv = environment();

interface World {
  tables: string[];
  transformRole: boolean;
  canSetImport: boolean;
  constraints: string[];
  transformed: boolean;
  decided: boolean;
}

const fakeContext = (world: Partial<World> = {}) => {
  const w: World = {
    tables: ["upstream_sql_imports", "client_facilities", "audit_logs", "upstream_import.quarantine"],
    transformRole: true,
    canSetImport: true,
    constraints: [],
    transformed: false,
    decided: false,
    ...world,
  };
  const calls: string[] = [];
  const yes = (v: boolean) => Promise.resolve([[{ yes: v }], null]);
  const sequelize = {
    query: jest.fn((sql: string, options: { replacements?: Record<string, unknown> } = {}) => {
      calls.push(sql);
      const r = options.replacements ?? {};
      const regclass = /to_regclass\('([\w.]+)'\)/.exec(sql);
      if (regclass) {
        return yes(w.tables.includes(regclass[1] as string));
      }
      if (sql.includes("FROM pg_roles WHERE rolname")) {
        return yes(w.transformRole);
      }
      if (sql.includes("pg_has_role")) {
        return yes(w.canSetImport);
      }
      if (sql.includes("pg_constraint")) {
        return yes(w.constraints.includes(String(r["name"])));
      }
      if (sql.includes("transform_status <> 'not_available'")) {
        return yes(w.transformed);
      }
      if (sql.includes("WHERE reason = :reason")) {
        return yes(w.decided);
      }
      return Promise.resolve([[], null]);
    }),
    transaction: jest.fn((fn: (t: object) => Promise<void>) => fn({})),
  };
  return { context: { sequelize } as unknown as Parameters<typeof m0134.up>[0]["context"], calls };
};

const at = (calls: string[], needle: string): number => calls.findIndex((c) => c.includes(needle));
const reasonsOf = (statement: string | undefined): string[] => [...(statement ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);

afterEach(() => {
  delete penv["UPSTREAM_TRANSFORM_DB_ROLE"];
  delete penv["UPSTREAM_IMPORT_DB_ROLE"];
});

describe("0134 up", () => {
  it("adds the tenant column and its CHECK, rebuilds the reasons AS the import role, grants exactly two tables", async () => {
    const { context, calls } = fakeContext();
    await m0134.up({ context });
    expect(calls[0]).toBe("SET LOCAL lock_timeout = '10s'");
    expect(calls).toContain("ALTER TABLE upstream_sql_imports ADD COLUMN IF NOT EXISTS transform_tenant_id UUID");
    expect(calls).toContain(`ALTER TABLE upstream_sql_imports ADD CONSTRAINT upstream_sql_imports_transform_tenant CHECK (${m0134.TENANT_PREDICATE})`);
    expect(m0134.TENANT_PREDICATE).toBe("transform_status = 'not_available' OR transform_tenant_id IS NOT NULL");
    const add = calls.find((c) => c.startsWith("ALTER TABLE upstream_import.quarantine ADD CONSTRAINT quarantine_reason_vocabulary"));
    expect(reasonsOf(add)).toEqual([...UPSTREAM_IMPORT_QUARANTINE_REASONS]);
    expect(reasonsOf(add)).toContain("facility_without_devices");
    expect(at(calls, "SET LOCAL ROLE callibrator_import")).toBeLessThan(at(calls, "DROP CONSTRAINT IF EXISTS quarantine_reason_vocabulary"));
    expect(at(calls, "ADD CONSTRAINT quarantine_reason_vocabulary")).toBeLessThan(at(calls, "RESET ROLE"));
    expect(calls.filter((c) => c.startsWith("GRANT "))).toEqual([
      "GRANT SELECT, INSERT, UPDATE ON client_facilities TO callibrator_transform",
      "GRANT INSERT ON audit_logs TO callibrator_transform",
    ]);
    expect(calls.some((c) => /DELETE ON client_facilities|callibrator_app/.test(c))).toBe(false);
  });

  it("is idempotent: an existing tenant CHECK is not added again; role names come from the environment", async () => {
    penv["UPSTREAM_TRANSFORM_DB_ROLE"] = "etl_transform";
    penv["UPSTREAM_IMPORT_DB_ROLE"] = "etl_import";
    const { context, calls } = fakeContext({ constraints: ["upstream_sql_imports_transform_tenant"] });
    await m0134.up({ context });
    expect(calls.some((c) => c.includes("ADD CONSTRAINT upstream_sql_imports_transform_tenant"))).toBe(false);
    expect(calls).toContain("SET LOCAL ROLE etl_import");
    expect(calls).toContain("GRANT INSERT ON audit_logs TO etl_transform");
  });

  it.each([
    ["upstream_sql_imports", "0134: table upstream_sql_imports does not exist"],
    ["client_facilities", "0134: table client_facilities does not exist"],
    ["audit_logs", "0134: table audit_logs does not exist"],
    ["upstream_import.quarantine", "0134: table upstream_import.quarantine does not exist"],
  ])("refuses (never skips) without %s", async (missing, message) => {
    const { context } = fakeContext({ tables: ["upstream_sql_imports", "client_facilities", "audit_logs", "upstream_import.quarantine"].filter((t) => t !== missing) });
    await expect(m0134.up({ context })).rejects.toThrow(message);
  });

  it("refuses without the transform role, when the import role cannot be SET to, or on a role name that is not an identifier", async () => {
    await expect(m0134.up({ context: fakeContext({ transformRole: false }).context })).rejects.toThrow('the transform role "callibrator_transform" does not exist');
    await expect(m0134.up({ context: fakeContext({ canSetImport: false }).context })).rejects.toThrow("cannot SET ROLE to the import role");
    penv["UPSTREAM_TRANSFORM_DB_ROLE"] = "bad-name";
    await expect(m0134.up({ context: fakeContext().context })).rejects.toThrow("is not a plain lower-case identifier");
  });
});

describe("0134 down", () => {
  it("revokes the grants, narrows the reasons back, drops the CHECK and the column", async () => {
    const { context, calls } = fakeContext();
    await m0134.down({ context });
    expect(calls.filter((c) => c.startsWith("REVOKE "))).toEqual([
      "REVOKE SELECT, INSERT, UPDATE ON client_facilities FROM callibrator_transform",
      "REVOKE INSERT ON audit_logs FROM callibrator_transform",
    ]);
    const add = calls.find((c) => c.startsWith("ALTER TABLE upstream_import.quarantine ADD CONSTRAINT"));
    expect(reasonsOf(add)).toEqual(UPSTREAM_IMPORT_QUARANTINE_REASONS.filter((r) => r !== "facility_without_devices"));
    expect(calls.slice(-2)).toEqual([
      "ALTER TABLE upstream_sql_imports DROP CONSTRAINT IF EXISTS upstream_sql_imports_transform_tenant",
      "ALTER TABLE upstream_sql_imports DROP COLUMN IF EXISTS transform_tenant_id",
    ]);
  });

  it("refuses while a run has a transform status or a quarantine row uses the new reason", async () => {
    await expect(m0134.down({ context: fakeContext({ transformed: true }).context })).rejects.toThrow("has a transform status");
    await expect(m0134.down({ context: fakeContext({ decided: true }).context })).rejects.toThrow('holds a "facility_without_devices" decision');
  });
});

describe("0134 registration", () => {
  it("is registered right after 0133, and has no try/catch", () => {
    const manifest = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
    const names = [...manifest.matchAll(/\["(\d{4}-[\w.-]+\.js)"/g)].map((m) => m[1]);
    expect(names.indexOf("0134-upstream-transform-facilities.js")).toBe(names.indexOf("0133-upstream-import-transform.js") + 1);
    const source = fs.readFileSync(path.join(__dirname, "../../migrations/0134-upstream-transform-facilities.ts"), "utf8");
    expect(source).not.toMatch(/\btry\s*\{/);
  });
});
