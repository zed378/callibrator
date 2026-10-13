/**
 * Migration 0138 — the templates step's quarantine reasons and the transform role's grants on the
 * three template tables (P24-02d). Pins what it ISSUES, without a database; the grants are proved
 * AS the transform role in upstreamTransform.p2402d.live.
 */
import * as fs from "fs";
import * as path from "path";
import m0138 from "../../migrations/0138-upstream-transform-templates";
import { UPSTREAM_IMPORT_QUARANTINE_REASONS } from "@callibrator/contracts/upstreamSqlImport";
import { environment } from "../../config/env";

const penv = environment();

interface World {
  tables: string[];
  transformRole: boolean;
  canSetImport: boolean;
  decided: boolean;
}

const fakeContext = (world: Partial<World> = {}) => {
  const w: World = { tables: ["inspection_templates", "inspection_template_versions", "inspection_template_items", "upstream_import.quarantine"], transformRole: true, canSetImport: true, decided: false, ...world };
  const calls: { sql: string; replacements: Record<string, unknown> }[] = [];
  const yes = (v: boolean) => Promise.resolve([[{ yes: v }], null]);
  const sequelize = {
    query: jest.fn((sql: string, options: { replacements?: Record<string, unknown> } = {}) => {
      calls.push({ sql, replacements: options.replacements ?? {} });
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
  return { context: { sequelize } as unknown as Parameters<typeof m0138.up>[0]["context"], calls };
};

const reasonsOf = (statement: string | undefined): string[] => [...(statement ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
const NEW = ["reference_unresolved", "template_operator_managed", "item_content_incomplete"];

afterEach(() => {
  delete penv["UPSTREAM_TRANSFORM_DB_ROLE"];
  delete penv["UPSTREAM_IMPORT_DB_ROLE"];
});

describe("0138 up", () => {
  it("rebuilds the reasons AS the import role, then grants the three global template tables — no DELETE", async () => {
    const { context, calls } = fakeContext();
    await m0138.up({ context });
    const sqls = calls.map((c) => c.sql);
    expect(sqls[0]).toBe("SET LOCAL lock_timeout = '10s'");
    const add = sqls.find((s) => s.startsWith("ALTER TABLE upstream_import.quarantine ADD CONSTRAINT quarantine_reason_vocabulary"));
    expect(reasonsOf(add)).toEqual([...UPSTREAM_IMPORT_QUARANTINE_REASONS]);
    expect(reasonsOf(add)).toEqual(expect.arrayContaining(NEW));
    expect(sqls.indexOf("SET LOCAL ROLE callibrator_import")).toBeLessThan(sqls.indexOf(add as string));
    expect(sqls.filter((s) => s.startsWith("GRANT "))).toEqual([
      "GRANT SELECT, INSERT, UPDATE ON inspection_templates TO callibrator_transform",
      "GRANT SELECT, INSERT, UPDATE ON inspection_template_versions TO callibrator_transform",
      "GRANT SELECT, INSERT, UPDATE ON inspection_template_items TO callibrator_transform",
    ]);
    expect(m0138.NEW_REASONS).toEqual(NEW);
  });

  it.each([
    ["inspection_templates", "0138: table inspection_templates does not exist"],
    ["inspection_template_versions", "0138: table inspection_template_versions does not exist"],
    ["inspection_template_items", "0138: table inspection_template_items does not exist"],
    ["upstream_import.quarantine", "0138: table upstream_import.quarantine does not exist"],
  ])("refuses (never skips) without %s", async (missing, message) => {
    await expect(m0138.up({ context: fakeContext({ tables: ["inspection_templates", "inspection_template_versions", "inspection_template_items", "upstream_import.quarantine"].filter((t) => t !== missing) }).context })).rejects.toThrow(message);
  });

  it("refuses without the transform role or when the import role cannot be SET to; role names come from the environment", async () => {
    await expect(m0138.up({ context: fakeContext({ transformRole: false }).context })).rejects.toThrow('the transform role "callibrator_transform" does not exist');
    await expect(m0138.up({ context: fakeContext({ canSetImport: false }).context })).rejects.toThrow("cannot SET ROLE to the import role");
    penv["UPSTREAM_TRANSFORM_DB_ROLE"] = "etl_transform";
    const { context, calls } = fakeContext();
    await m0138.up({ context });
    expect(calls.map((c) => c.sql)).toContain("GRANT SELECT, INSERT, UPDATE ON inspection_templates TO etl_transform");
  });
});

describe("0138 down", () => {
  it("revokes the grants and narrows the reasons back", async () => {
    const { context, calls } = fakeContext();
    await m0138.down({ context });
    const sqls = calls.map((c) => c.sql);
    expect(sqls.filter((s) => s.startsWith("REVOKE "))).toEqual(m0138.GRANTS.map(([privilege, table]) => `REVOKE ${privilege} ON ${table} FROM callibrator_transform`));
    const add = sqls.find((s) => s.startsWith("ALTER TABLE upstream_import.quarantine ADD CONSTRAINT"));
    expect(reasonsOf(add)).toEqual(UPSTREAM_IMPORT_QUARANTINE_REASONS.filter((r) => !NEW.includes(r)));
    expect(calls.find((c) => c.sql.includes("WHERE reason IN (:reasons)"))?.replacements).toEqual({ reasons: NEW });
  });

  it("refuses while a quarantine row uses a new reason", async () => {
    await expect(m0138.down({ context: fakeContext({ decided: true }).context })).rejects.toThrow("holds a templates-step decision");
  });
});

describe("0138 registration", () => {
  it("is registered after 0136 (0137 is the public device tokens' when present), and has no try/catch", () => {
    const manifest = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
    const names = [...manifest.matchAll(/\["(\d{4}-[\w.-]+\.js)"/g)].map((m) => m[1]);
    const at = names.indexOf("0138-upstream-transform-templates.js");
    expect(at).toBeGreaterThan(names.indexOf("0136-upstream-transform-catalogue.js"));
    expect(names.slice(at + 1).every((name) => (name as string) > "0138")).toBe(true);
    expect(fs.readFileSync(path.join(__dirname, "../../migrations/0138-upstream-transform-templates.ts"), "utf8")).not.toMatch(/\btry\s*\{/);
  });
});
