/**
 * Migration 0139 — the register steps' quarantine reasons, `upstream_import.former_users` and the
 * transform role's column grants (P24-02e). Pins what it ISSUES, without a database; the grants are
 * proved AS the transform and application roles in upstreamTransform.p2402e.live.
 */
import * as fs from "fs";
import * as path from "path";
import m0139 from "../../migrations/0139-upstream-transform-register";
import { UPSTREAM_IMPORT_QUARANTINE_REASONS } from "@callibrator/contracts/upstreamSqlImport";
import { environment } from "../../config/env";

const penv = environment();
const TABLES = ["vendors", "warehouses", "calibration_devices", "tenant_settings", "users", "tenants", "upstream_import.quarantine"];

interface World {
  tables: string[];
  transformRole: boolean;
  canSetImport: boolean;
  decided: boolean;
  formerTable: boolean;
}

const fakeContext = (world: Partial<World> = {}) => {
  const w: World = { tables: TABLES, transformRole: true, canSetImport: true, decided: false, formerTable: false, ...world };
  const calls: { sql: string; replacements: Record<string, unknown> }[] = [];
  const yes = (v: boolean) => Promise.resolve([[{ yes: v }], null]);
  const sequelize = {
    query: jest.fn((sql: string, options: { replacements?: Record<string, unknown> } = {}) => {
      calls.push({ sql, replacements: options.replacements ?? {} });
      if (sql.includes("upstream_import.former_users') IS NOT NULL AND EXISTS")) {
        return yes(w.formerTable);
      }
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
      if (sql.includes("WHERE reason IN (:reasons)")) {
        return yes(w.decided);
      }
      return Promise.resolve([[], null]);
    }),
    transaction: jest.fn((fn: (t: object) => Promise<void>) => fn({})),
  };
  return { context: { sequelize } as unknown as Parameters<typeof m0139.up>[0]["context"], calls };
};

const reasonsOf = (statement: string | undefined): string[] => [...(statement ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
const NEW = ["qr_in_use", "facility_changed"];

afterEach(() => {
  delete penv["UPSTREAM_TRANSFORM_DB_ROLE"];
  delete penv["UPSTREAM_IMPORT_DB_ROLE"];
  delete penv["DB_APP_ROLE"];
});

describe("0139 up", () => {
  it("rebuilds the reasons, creates former_users AS the import role (closed to the app), then grants columns — never a facility update, never a token", async () => {
    const { context, calls } = fakeContext();
    await m0139.up({ context });
    const sqls = calls.map((c) => c.sql);
    expect(sqls[0]).toBe("SET LOCAL lock_timeout = '10s'");
    const add = sqls.find((s) => s.startsWith("ALTER TABLE upstream_import.quarantine ADD CONSTRAINT quarantine_reason_vocabulary"));
    expect(reasonsOf(add)).toEqual([...UPSTREAM_IMPORT_QUARANTINE_REASONS]);
    expect(reasonsOf(add)).toEqual(expect.arrayContaining(NEW));
    const create = sqls.indexOf(m0139.FORMER_USERS_SQL);
    expect(sqls.lastIndexOf("SET LOCAL ROLE callibrator_import", create)).toBeGreaterThan(sqls.indexOf(add as string));
    expect(sqls.slice(create + 1, create + 5)).toEqual([
      "REVOKE ALL ON upstream_import.former_users FROM PUBLIC",
      "REVOKE ALL ON upstream_import.former_users FROM callibrator_app",
      "GRANT SELECT, INSERT ON upstream_import.former_users TO callibrator_transform",
      "RESET ROLE",
    ]);
    const grants = sqls.filter((s) => s.startsWith("GRANT ") && s.includes(" ON ") && !s.includes("former_users"));
    expect(grants).toEqual(m0139.GRANTS.map(([privilege, table]) => `GRANT ${privilege} ON ${table} TO callibrator_transform`));
    expect(grants.join("\n")).not.toMatch(/iot_token|password|DELETE/);
    expect(grants.find((g) => g.startsWith("GRANT UPDATE"))).not.toContain("client_facility_id");
    expect(grants.find((g) => g.startsWith("GRANT INSERT (id, tenant_id, client_facility_id"))).toBeDefined();
    expect(m0139.NEW_REASONS).toEqual(NEW);
  });

  it.each(TABLES)("refuses (never skips) without %s", async (missing) => {
    await expect(m0139.up({ context: fakeContext({ tables: TABLES.filter((t) => t !== missing) }).context })).rejects.toThrow(`0139: table ${missing} does not exist`);
  });

  it("refuses without the transform role or when the import role cannot be SET to; role names come from the environment", async () => {
    await expect(m0139.up({ context: fakeContext({ transformRole: false }).context })).rejects.toThrow('the transform role "callibrator_transform" does not exist');
    await expect(m0139.up({ context: fakeContext({ canSetImport: false }).context })).rejects.toThrow("cannot SET ROLE to the import role");
    penv["UPSTREAM_TRANSFORM_DB_ROLE"] = "etl_transform";
    penv["DB_APP_ROLE"] = "etl_app";
    const { context, calls } = fakeContext();
    await m0139.up({ context });
    const sqls = calls.map((c) => c.sql);
    expect(sqls).toContain("GRANT SELECT (id, name) ON tenants TO etl_transform");
    expect(sqls).toContain("REVOKE ALL ON upstream_import.former_users FROM etl_app");
  });
});

describe("0139 down", () => {
  it("revokes the grants, drops former_users AS the import role and narrows the reasons back", async () => {
    const { context, calls } = fakeContext();
    await m0139.down({ context });
    const sqls = calls.map((c) => c.sql);
    expect(sqls.filter((s) => s.startsWith("REVOKE "))).toEqual(m0139.GRANTS.map(([privilege, table]) => `REVOKE ${privilege} ON ${table} FROM callibrator_transform`));
    expect(sqls[sqls.indexOf("DROP TABLE IF EXISTS upstream_import.former_users") - 1]).toBe("SET LOCAL ROLE callibrator_import");
    const add = sqls.find((s) => s.startsWith("ALTER TABLE upstream_import.quarantine ADD CONSTRAINT"));
    expect(reasonsOf(add)).toEqual(UPSTREAM_IMPORT_QUARANTINE_REASONS.filter((r) => !NEW.includes(r)));
    expect(calls.find((c) => c.sql.includes("WHERE reason IN (:reasons)"))?.replacements).toEqual({ reasons: NEW });
  });

  it("refuses while a quarantine row uses a new reason, or a departed registrant is numbered", async () => {
    await expect(m0139.down({ context: fakeContext({ decided: true }).context })).rejects.toThrow("holds a register-step decision");
    await expect(m0139.down({ context: fakeContext({ formerTable: true }).context })).rejects.toThrow("holds a departed registrant's number");
  });
});

describe("0139 registration", () => {
  it("is registered after 0138, last so far, and has no try/catch", () => {
    const manifest = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
    const names = [...manifest.matchAll(/\["(\d{4}-[\w.-]+\.js)"/g)].map((m) => m[1]);
    const at = names.indexOf("0139-upstream-transform-register.js");
    expect(at).toBe(names.indexOf("0138-upstream-transform-templates.js") + 1);
    expect(names.slice(at + 1).every((name) => (name as string) > "0139")).toBe(true);
    expect(fs.readFileSync(path.join(__dirname, "../../migrations/0139-upstream-transform-register.ts"), "utf8")).not.toMatch(/\btry\s*\{/);
  });
});
