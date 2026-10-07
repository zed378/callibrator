/**
 * Migration 0116 — the `upstream-sql-import` menu entry and its SUPERADMIN grant (P24-06: the
 * SQL-dump import's page). Pins what it ISSUES on each path, without a database: an unseeded database is
 * left alone, an existing entry is not duplicated, a taken fixed id falls back to a random one,
 * the grant is idempotent, `down` removes the grants and the entry; registered after 0115; no
 * blanket try/catch.
 */
import * as fs from "fs";
import * as path from "path";
import m0116 from "../../migrations/0116-upstream-sql-import-menu";

interface Call {
  sql: string;
  bind: unknown[];
}

const fakeContext = (answers: (sql: string, bind: unknown[]) => { id: string }[] = () => []) => {
  const calls: Call[] = [];
  const sequelize = {
    query: jest.fn(async (sql: string, options: { bind?: unknown[] } = {}) => {
      const bind = options.bind ?? [];
      calls.push({ sql, bind });
      return Promise.resolve([answers(sql, bind), null]);
    }),
  };
  const context: unknown = { sequelize };
  return { context: context as never, calls };
};

const seeded = (sql: string, bind: unknown[], over: { exists?: boolean; idTaken?: boolean } = {}): { id: string }[] => {
  if (sql.includes("slug = 'home'")) {
    return [{ id: "home" }];
  }
  if (sql.includes("WHERE slug = $1") && bind[0] === "upstream-sql-import") {
    return over.exists ? [{ id: "existing" }] : [];
  }
  if (sql.includes("WHERE id = $1")) {
    return over.idTaken ? [{ id: m0116.FIXED_ID }] : [];
  }
  if (sql.includes("WHERE slug = $1") && bind[0] === "mgmt-organization") {
    return [{ id: "parent-id" }];
  }
  return [];
};

describe("migration 0116 — the upstream-sql-import menu entry", () => {
  it("an unseeded database is left to the seed", async () => {
    const f = fakeContext(() => []);
    await m0116.up({ context: f.context });
    expect(f.calls).toHaveLength(1);
  });

  it("creates the entry under mgmt-organization with its fixed id, then grants SUPERADMIN write", async () => {
    const f = fakeContext((sql, bind) => seeded(sql, bind));
    await m0116.up({ context: f.context });
    const insert = f.calls.find((c) => c.sql.includes("INSERT INTO menu_groups"));
    expect(insert?.bind).toEqual(["upstream-sql-import", "parent-id", m0116.FIXED_ID]);
    expect(insert?.sql).toMatch(/'SQL Dump Import', \$1, 'DatabaseZap', \$2::uuid, 8/);
    const grant = f.calls.find((c) => c.sql.includes("INSERT INTO role_menu_permissions"));
    expect(grant?.bind).toEqual(["SUPERADMIN", "upstream-sql-import"]);
    expect(grant?.sql).toMatch(/NOT EXISTS/);
  });

  it("a taken fixed id falls back to a random one; a missing parent inserts at the top level", async () => {
    const f = fakeContext((sql, bind) => (sql.includes("WHERE slug = $1") && bind[0] === "mgmt-organization" ? [] : seeded(sql, bind, { idTaken: true })));
    await m0116.up({ context: f.context });
    const insert = f.calls.find((c) => c.sql.includes("INSERT INTO menu_groups"));
    expect(insert?.sql).toContain("gen_random_uuid()");
    expect(insert?.bind).toEqual(["upstream-sql-import", null]);
  });

  it("an existing entry is not created again; only the (idempotent) grant runs", async () => {
    const f = fakeContext((sql, bind) => seeded(sql, bind, { exists: true }));
    await m0116.up({ context: f.context });
    expect(f.calls.some((c) => c.sql.includes("INSERT INTO menu_groups"))).toBe(false);
    expect(f.calls.some((c) => c.sql.includes("INSERT INTO role_menu_permissions"))).toBe(true);
  });

  it("down removes the role and user grants, then the entry", async () => {
    const f = fakeContext();
    await m0116.down({ context: f.context });
    expect(f.calls.map((c) => c.sql.split(" ").slice(0, 3).join(" "))).toEqual(["DELETE FROM role_menu_permissions", "DELETE FROM user_menu_permissions", "DELETE FROM menu_groups"]);
    expect(f.calls.every((c) => c.bind[0] === "upstream-sql-import")).toBe(true);
  });

  it("is registered after 0115 and has no blanket try/catch", () => {
    const manifest = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
    expect(manifest.indexOf('"0116-upstream-sql-import-menu.js"')).toBeGreaterThan(manifest.indexOf('"0115-upstream-import-menu.js"'));
    const source = fs.readFileSync(path.join(__dirname, "../../migrations/0116-upstream-sql-import-menu.ts"), "utf8");
    expect(/\btry\s*\{/.test(source)).toBe(false);
  });
});
