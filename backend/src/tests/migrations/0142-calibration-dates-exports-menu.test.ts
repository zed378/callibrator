/**
 * Migration 0142 (UAT C-3) — the calibration-dates and exports menu entries. Pins what it ISSUES on
 * each path, without a database (the rows are proved on PostgreSQL 18 by menuEntries.c3.live): an
 * unseeded database is left alone; the two groups are created under Equipment, ACTIVE, with their
 * fixed ids; an existing group is not created again; a taken fixed id falls back to a random one;
 * the `read` grant goes to the holders of `calibration` or `equipment`, skipping an existing pair;
 * `down` removes the groups with their role and user grants; registered after 0141; no try/catch.
 * The entries are checked against the SEED (menu data, ROLE_MENU_ASSIGNMENTS, the page gates and the
 * bound ceiling), not against the migration's own lists.
 */
import * as fs from "fs";
import * as path from "path";
import m0142 from "../../migrations/0142-calibration-dates-exports-menu";
import { MENU_SLUGS, ROLE_MENU_ASSIGNMENTS } from "../../constants/roleConstants";
import { MENU_PAGE_GATES } from "../../constants/menuPageAccess";
import { BOUND_MENU_CEILING } from "../../constants/facilityAccess";
import { SEEDED_MENU_SLUGS } from "../../constants/seededMenuSlugs";
import seedMenuGroups from "../../utils/seedMenuGroups.util";

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

const seeded = (over: { exists?: string[]; idTaken?: boolean; noParent?: boolean } = {}) => (sql: string, bind: unknown[]): { id: string }[] => {
  if (sql.includes("slug = 'home'")) {
    return [{ id: "home" }];
  }
  if (sql.includes("WHERE slug = $1")) {
    const slug = bind[0] as string;
    if (slug === "equipment") {
      return over.noParent ? [] : [{ id: "equipment-id" }];
    }
    return (over.exists ?? []).includes(slug) ? [{ id: `existing-${slug}` }] : [];
  }
  if (sql.includes("WHERE id = $1")) {
    return over.idTaken ? [{ id: bind[0] as string }] : [];
  }
  return [];
};

const menuInserts = (calls: Call[]): Call[] => calls.filter((c) => c.sql.includes("INSERT INTO menu_groups"));

describe("migration 0142 — the calibration-dates and exports menu entries", () => {
  it("an unseeded database is left to the seed", async () => {
    const f = fakeContext(() => []);
    await m0142.up({ context: f.context });
    expect(f.calls).toHaveLength(1);
  });

  it("creates both groups ACTIVE under Equipment with their fixed ids, then grants read to the reaching roles", async () => {
    const f = fakeContext(seeded());
    await m0142.up({ context: f.context });
    const inserts = menuInserts(f.calls);
    expect(inserts.map((c) => c.bind)).toEqual([
      ["Calibration Dates", "calibration-dates", "Gauge", "equipment-id", 8, "a0000000-0000-0000-0000-000000000309"],
      ["Exports", "exports", "Table2", "equipment-id", 9, "a0000000-0000-0000-0000-000000000310"],
    ]);
    expect(inserts.every((c) => c.sql.includes(", true, NOW(), NOW())"))).toBe(true);
    const grant = f.calls.find((c) => c.sql.includes("INSERT INTO role_menu_permissions"));
    expect(grant?.bind).toEqual([["calibration-dates", "exports"], ["calibration", "equipment"]]);
    expect(grant?.sql).toContain("'read'");
    expect(grant?.sql).toContain("NOT EXISTS");
    expect(f.calls.some((c) => c.sql.includes("user_menu_permissions"))).toBe(false);
  });

  it("an existing group is not created again; a taken fixed id falls back to a random one; no parent is NULL", async () => {
    const existing = fakeContext(seeded({ exists: ["calibration-dates", "exports"] }));
    await m0142.up({ context: existing.context });
    expect(menuInserts(existing.calls)).toEqual([]);
    const taken = fakeContext(seeded({ idTaken: true, noParent: true }));
    await m0142.up({ context: taken.context });
    expect(menuInserts(taken.calls).map((c) => [c.sql.includes("gen_random_uuid()"), c.bind.length, c.bind[3]])).toEqual([
      [true, 5, null],
      [true, 5, null],
    ]);
  });

  it("down removes the two groups with their role and user grants", async () => {
    const f = fakeContext();
    await m0142.down({ context: f.context });
    expect(f.calls.map((c) => [c.sql.split(" ").slice(0, 3).join(" "), c.bind])).toEqual([
      ["DELETE FROM role_menu_permissions", [["calibration-dates", "exports"]]],
      ["DELETE FROM user_menu_permissions", [["calibration-dates", "exports"]]],
      ["DELETE FROM menu_groups", [["calibration-dates", "exports"]]],
    ]);
  });

  it("the seed says the same: seeded slugs, read for every role holding calibration or equipment, the calibration page gate, the bound ceiling", () => {
    expect(SEEDED_MENU_SLUGS).toEqual(expect.arrayContaining(["calibration-dates", "exports"]));
    const reaching = ROLE_MENU_ASSIGNMENTS.filter((a) => MENU_SLUGS.CALIBRATION in a.menus || MENU_SLUGS.EQUIPMENT in a.menus);
    expect(reaching.length).toBeGreaterThan(0);
    for (const assignment of ROLE_MENU_ASSIGNMENTS) {
      const expected = reaching.includes(assignment) ? "read" : undefined;
      expect([assignment.roleName, assignment.menus[MENU_SLUGS.CALIBRATION_DATES], assignment.menus[MENU_SLUGS.EXPORTS]]).toEqual([assignment.roleName, expected, expected]);
    }
    expect(MENU_PAGE_GATES["calibration-dates"]).toEqual([{ kind: "menu", slug: "calibration" }]);
    expect(MENU_PAGE_GATES["exports"]).toEqual([{ kind: "menu", slug: "calibration" }]);
    for (const ceiling of Object.values(BOUND_MENU_CEILING)) {
      expect([ceiling["calibration-dates"], ceiling["exports"]]).toEqual(["read", "read"]);
    }
    expect(seedMenuGroups.getMenuGroupId("calibration-dates")).toBe(m0142.MENUS[0]?.fixedId);
    expect(seedMenuGroups.getMenuGroupId("exports")).toBe(m0142.MENUS[1]?.fixedId);
  });

  it("is registered right after 0141, and has no try/catch", () => {
    const manifest = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
    const names = [...manifest.matchAll(/\["(\d{4}-[\w.-]+\.js)"/g)].map((m) => m[1]);
    expect(names.indexOf("0142-calibration-dates-exports-menu.js")).toBe(names.indexOf("0141-upstream-transform-ipm.js") + 1);
    expect(fs.readFileSync(path.join(__dirname, "../../migrations/0142-calibration-dates-exports-menu.ts"), "utf8")).not.toMatch(/\btry\s*\{/);
  });
});
