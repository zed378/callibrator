/**
 * Migration 0124 (P20-06) — the ipm / ipm-templates / client-facilities menu entries, their grants,
 * and UD-4 (b)'s `calibration` write for the technicians. Pins what it ISSUES on each path, without
 * a database (the rows themselves are proved on PostgreSQL 18 by menuGrants.p2006.live): an
 * unseeded database is left alone; the three groups are created under their parents, inactive,
 * with their fixed ids; an existing group is not created again; a taken fixed id falls back to a
 * random one; the grants of spec P18-01-02 § 3.1 skip an existing pair; step 3 raises a `read` row
 * and inserts an absent one for exactly the two technician roles; `user_menu_permissions` is never
 * written by `up`; `down` removes the groups and their grants and leaves the technicians' write;
 * registered after 0123; no blanket try/catch. The grant list is checked against the SEED, not
 * against itself.
 */
import * as fs from "fs";
import * as path from "path";
import m0124 from "../../migrations/0124-ipm-menus-technician-calibration";
import { ROLE_MENU_ASSIGNMENTS } from "../../constants/roleConstants";

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

const PARENTS: Record<string, string> = { equipment: "equipment-id", "mgmt-organization": "org-id" };

const seeded = (over: { exists?: string[]; idTaken?: boolean; noParent?: boolean } = {}) => (sql: string, bind: unknown[]): { id: string }[] => {
  if (sql.includes("slug = 'home'")) {
    return [{ id: "home" }];
  }
  if (sql.includes("WHERE slug = $1")) {
    const slug = bind[0] as string;
    if (PARENTS[slug] !== undefined) {
      return over.noParent ? [] : [{ id: PARENTS[slug] }];
    }
    return (over.exists ?? []).includes(slug) ? [{ id: `existing-${slug}` }] : [];
  }
  if (sql.includes("WHERE id = $1")) {
    return over.idTaken ? [{ id: bind[0] as string }] : [];
  }
  return [];
};

const menuInserts = (calls: Call[]): Call[] => calls.filter((c) => c.sql.includes("INSERT INTO menu_groups"));

describe("migration 0124 — P20-06 menus, grants and UD-4 (b)", () => {
  it("an unseeded database is left to the seed", async () => {
    const f = fakeContext(() => []);
    await m0124.up({ context: f.context });
    expect(f.calls).toHaveLength(1);
  });

  it("creates the three groups under their parents, inactive, with their fixed ids", async () => {
    const f = fakeContext(seeded());
    await m0124.up({ context: f.context });
    const inserts = menuInserts(f.calls);
    expect(inserts.map((c) => c.bind)).toEqual([
      ["IPM", "ipm", "ClipboardCheck", "equipment-id", 6, "a0000000-0000-0000-0000-000000000307"],
      ["IPM Checklists", "ipm-templates", "ClipboardList", "equipment-id", 7, "a0000000-0000-0000-0000-000000000308"],
      ["Client Facilities", "client-facilities", "Building2", "org-id", 9, "a0000000-0000-0000-0000-000000000240"],
    ]);
    for (const insert of inserts) {
      expect(insert.sql).toMatch(/\$5, false, NOW\(\), NOW\(\)/);
    }
  });

  it("a taken fixed id falls back to a random one; a missing parent inserts at the top level", async () => {
    const f = fakeContext(seeded({ idTaken: true, noParent: true }));
    await m0124.up({ context: f.context });
    const inserts = menuInserts(f.calls);
    expect(inserts).toHaveLength(3);
    for (const insert of inserts) {
      expect(insert.sql).toContain("gen_random_uuid()");
      expect(insert.bind).toHaveLength(5);
      expect(insert.bind[3]).toBeNull();
    }
  });

  it("an existing group is not created again; the grants still run", async () => {
    const f = fakeContext(seeded({ exists: ["ipm", "ipm-templates", "client-facilities"] }));
    await m0124.up({ context: f.context });
    expect(menuInserts(f.calls)).toHaveLength(0);
    expect(f.calls.filter((c) => c.sql.includes("INSERT INTO role_menu_permissions"))).toHaveLength(2);
  });

  it("step 2 inserts the explicit grants by role name and slug, skipping an existing pair", async () => {
    const f = fakeContext(seeded());
    await m0124.up({ context: f.context });
    const grant = f.calls.find((c) => c.sql.includes("unnest("));
    expect(grant?.sql).toMatch(/NOT EXISTS/);
    expect(grant?.sql).not.toMatch(/UPDATE/);
    const [roles = [], slugs = [], permissions = []] = grant?.bind as string[][];
    const rows = roles.map((role, i) => `${role}|${String(slugs[i])}|${String(permissions[i])}`);
    expect(rows).toEqual([
      "SUPERADMIN|ipm|write",
      "SUPERADMIN|ipm-templates|write",
      "SUPERADMIN|client-facilities|write",
      "HEALTHCARE ADMIN|client-facilities|write",
      "CALIBRATOR ADMIN|client-facilities|write",
      "ENGINEERING MANAGER|client-facilities|read",
      "TECHNICIAN|ipm|write",
      "HEALTHCARE TECHNICIAN|ipm|write",
      "FACILITY MAINTENANCE|ipm|write",
    ]);
  });

  it("the grants equal the seed's rows on the three new slugs (read from ROLE_MENU_ASSIGNMENTS)", () => {
    const fromSeed = ROLE_MENU_ASSIGNMENTS.flatMap((a) =>
      Object.entries(a.menus)
        .filter(([slug]) => ["ipm", "ipm-templates", "client-facilities"].includes(slug))
        .map(([slug, permission]) => `${a.roleName}|${slug}|${permission}`),
    ).sort();
    expect(m0124.GRANTS.map((g) => g.join("|")).sort()).toEqual(fromSeed);
  });

  it("step 3 raises an existing non-write `calibration` row, then inserts where absent — the two technician roles only", async () => {
    const f = fakeContext(seeded());
    await m0124.up({ context: f.context });
    const raise = f.calls.find((c) => c.sql.includes("UPDATE role_menu_permissions"));
    expect(raise?.sql).toMatch(/SET permission_type = 'write'/);
    expect(raise?.sql).toMatch(/p\.permission_type <> 'write'/);
    expect(raise?.bind).toEqual(["calibration", ["TECHNICIAN", "HEALTHCARE TECHNICIAN"]]);
    const insert = f.calls.filter((c) => c.sql.includes("INSERT INTO role_menu_permissions")).at(-1);
    expect(insert?.sql).toMatch(/'write'/);
    expect(insert?.sql).toMatch(/NOT EXISTS/);
    expect(insert?.bind).toEqual(["calibration", ["TECHNICIAN", "HEALTHCARE TECHNICIAN"]]);
    expect(f.calls.indexOf(raise as Call)).toBeLessThan(f.calls.indexOf(insert as Call));
  });

  it("up never writes user_menu_permissions (a per-user override still replaces the role grant)", async () => {
    const f = fakeContext(seeded());
    await m0124.up({ context: f.context });
    expect(f.calls.some((c) => c.sql.includes("user_menu_permissions"))).toBe(false);
  });

  it("down removes the role and user grants, then the groups; the technicians' calibration write stays", async () => {
    const f = fakeContext();
    await m0124.down({ context: f.context });
    expect(f.calls.map((c) => c.sql.split(" ").slice(0, 3).join(" "))).toEqual(["DELETE FROM role_menu_permissions", "DELETE FROM user_menu_permissions", "DELETE FROM menu_groups"]);
    for (const call of f.calls) {
      expect(call.bind[0]).toEqual(["ipm", "ipm-templates", "client-facilities"]);
    }
  });

  it("is registered after 0123 and has no blanket try/catch", () => {
    const manifest = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
    expect(manifest.indexOf('"0124-ipm-menus-technician-calibration.js"')).toBeGreaterThan(manifest.indexOf('"0123-facility-nullable.js"'));
    const source = fs.readFileSync(path.join(__dirname, "../../migrations/0124-ipm-menus-technician-calibration.ts"), "utf8");
    expect(/\btry\s*\{/.test(source)).toBe(false);
  });
});
