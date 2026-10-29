/**
 * Migration 0147 — MAINTAIN on the tables the transform writes (P24-05 finding). Pins what it ISSUES,
 * without a database; the runner's ANALYZE runs AS the transform role in the upstreamTransform live suites.
 */
import * as fs from "fs";
import * as path from "path";
import m0147 from "../../migrations/0147-upstream-transform-maintain";
import { environment } from "../../config/env";
import { TRANSFORM_STEPS } from "../../services/upstreamImport/transform/steps";

const penv = environment();

const fakeContext = (world: { tables?: readonly string[]; transformRole?: boolean; canSetImport?: boolean } = {}) => {
  const tables = world.tables ?? m0147.TABLES;
  const calls: string[] = [];
  const yes = (v: boolean) => Promise.resolve([[{ yes: v }], null]);
  const sequelize = {
    query: jest.fn((sql: string) => {
      calls.push(sql);
      const regclass = /to_regclass\('([\w.]+)'\)/.exec(sql);
      if (regclass) {
        return yes(tables.includes(regclass[1] as string));
      }
      if (sql.includes("FROM pg_roles WHERE rolname")) {
        return yes(world.transformRole ?? true);
      }
      if (sql.includes("pg_has_role")) {
        return yes(world.canSetImport ?? true);
      }
      return Promise.resolve([[], null]);
    }),
    transaction: jest.fn((fn: (t: object) => Promise<void>) => fn({})),
  };
  return { context: { sequelize } as unknown as Parameters<typeof m0147.up>[0]["context"], calls };
};

afterEach(() => {
  delete penv["UPSTREAM_TRANSFORM_DB_ROLE"];
});

describe("0147", () => {
  it("up grants MAINTAIN, and only MAINTAIN, on every table the transform writes; down revokes the same", async () => {
    const up = fakeContext();
    await m0147.up({ context: up.context });
    expect(up.calls[0]).toBe("SET LOCAL lock_timeout = '10s'");
    expect(up.calls.filter((s) => s.startsWith("GRANT "))).toEqual(m0147.TABLES.map((t) => `GRANT MAINTAIN ON ${t} TO callibrator_transform`));
    // The bookkeeping belongs to the import role: a GRANT by anyone else only warns. Granted AS its owner.
    const owner = up.calls.indexOf("SET LOCAL ROLE callibrator_import");
    expect(up.calls.slice(owner + 1, owner + 4)).toEqual(
      ["upstream_import.id_map", "upstream_import.quarantine", "upstream_import.former_users"].map((t) => `GRANT MAINTAIN ON ${t} TO callibrator_transform`),
    );
    expect(up.calls[owner + 4]).toBe("RESET ROLE");
    const down = fakeContext();
    await m0147.down({ context: down.context });
    expect(down.calls.filter((s) => s.startsWith("REVOKE "))).toEqual(m0147.TABLES.map((t) => `REVOKE MAINTAIN ON ${t} FROM callibrator_transform`));
  });

  it("covers every table a transform step writes, plus its bookkeeping", () => {
    const written = new Set(TRANSFORM_STEPS.flatMap((step) => step.writes));
    expect([...written].filter((t) => !m0147.TABLES.includes(t))).toEqual([]);
    expect(m0147.TABLES).toEqual(expect.arrayContaining(["upstream_import.id_map", "upstream_import.quarantine"]));
  });

  it("refuses (never skips) without a table", async () => {
    await expect(m0147.up({ context: fakeContext({ tables: m0147.TABLES.filter((t) => t !== "audit_logs") }).context })).rejects.toThrow("0147: table audit_logs does not exist");
  });

  it("refuses when the migrating role cannot act as the import role", async () => {
    await expect(m0147.up({ context: fakeContext({ canSetImport: false }).context })).rejects.toThrow('cannot SET ROLE to the import role "callibrator_import"');
  });

  it("refuses without the transform role; the role name comes from the environment", async () => {
    await expect(m0147.up({ context: fakeContext({ transformRole: false }).context })).rejects.toThrow('the transform role "callibrator_transform" does not exist');
    penv["UPSTREAM_TRANSFORM_DB_ROLE"] = "etl_transform";
    const { context, calls } = fakeContext();
    await m0147.up({ context });
    expect(calls).toContain("GRANT MAINTAIN ON audit_logs TO etl_transform");
  });

  it("is registered right after 0146, and has no try/catch", () => {
    const manifest = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
    const names = [...manifest.matchAll(/\["(\d{4}-[\w.-]+\.js)"/g)].map((m) => m[1]);
    expect(names.indexOf("0147-upstream-transform-maintain.js")).toBe(names.indexOf("0146-upstream-reconciliation-grants.js") + 1);
    expect(fs.readFileSync(path.join(__dirname, "../../migrations/0147-upstream-transform-maintain.ts"), "utf8")).not.toMatch(/\btry\s*\{/);
  });
});
