/**
 * Migration 0054 — Q-20: grants for the Management pages only SUPERADMIN could
 * reach (users, vendors, billing, audit; content stays SUPERADMIN-only).
 *
 * The logic runs against a fake QueryInterface that records its SQL. The SQL
 * itself was run on a private PostgreSQL 16 cluster (not 18, no pgvector) with
 * a minimal roles / menu_groups / role_menu_permissions schema — see the
 * change record; `make migrate && make migrate-verify` remains the check on
 * the real schema.
 *
 * P9-23: 0054 is TypeScript now (its recorded name is still
 * "0054-q20-management-page-grants.js"); this suite reads the .ts source.
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for the async sequelize.query: a throw inside them must be a rejection */
import * as fs from "fs";
import * as path from "path";

import migration from "../../migrations/0054-q20-management-page-grants";
import { ROLE_MENU_ASSIGNMENTS, MENU_SLUGS } from "../../constants";

type Context = Parameters<typeof migration.up>[0]["context"];
const ctx = (fake: object): Context => fake as Context;

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0054-q20-management-page-grants.ts"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");

interface Write {
  sql: string;
  replacements: unknown;
}

const fakeQueryInterface = ({ seeded = true, fail = null }: { seeded?: boolean; fail?: Error | null } = {}) => {
  const state = { writes: [] as Write[] };
  const query = jest.fn(async (sql: string, { replacements }: { replacements?: unknown } = {}) => {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text.startsWith("SELECT id FROM menu_groups WHERE slug = 'home'")) {
      return [seeded ? [{ id: "home-id" }] : []];
    }
    if (fail) {
      throw fail;
    }
    state.writes.push({ sql: text, replacements });
    return [[]];
  });
  return { state, sequelize: { query } };
};

describe("migration 0054 — Q-20 management page grants", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0054-q20-management-page-grants.js", require("../migrations/0054-q20-management-page-grants")]',
    );
  });

  it("adds exactly the grants ROLE_MENU_ASSIGNMENTS now holds for the four pages — and none for content", () => {
    const Q20_SLUGS: string[] = [MENU_SLUGS.USERS, MENU_SLUGS.VENDORS, MENU_SLUGS.BILLING, MENU_SLUGS.AUDIT];
    const fromConstants = ROLE_MENU_ASSIGNMENTS.filter((a) => a.roleName !== "SUPERADMIN")
      .flatMap((a) =>
        Object.entries(a.menus)
          .filter(([slug]) => Q20_SLUGS.includes(slug) || slug === MENU_SLUGS.CONTENT)
          .map(([slug, type]) => [a.roleName, slug, type]),
      )
      .sort();

    expect([...migration.GRANTS].sort()).toEqual(fromConstants);
    expect(migration.GRANTS.some(([, slug]) => slug === "content")).toBe(false);
  });

  it("inserts each grant only where the role has no row for that page (a hand-set grant is kept)", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: ctx(qi) });

    expect(qi.state.writes).toHaveLength(migration.GRANTS.length);
    for (const [i, [role, slug, type]] of migration.GRANTS.entries()) {
      const write = qi.state.writes[i] as Write;
      expect(write.sql).toMatch(/^INSERT INTO role_menu_permissions/);
      expect(write.sql).toContain("AND NOT EXISTS");
      expect(write.replacements).toEqual([type, role, slug]);
    }
  });

  it("does nothing on a database that has not been seeded", async () => {
    const qi = fakeQueryInterface({ seeded: false });

    await migration.up({ context: ctx(qi) });

    expect(qi.state.writes).toEqual([]);
  });

  it("accepts the Umzug context shape { queryInterface }", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: ctx({ queryInterface: qi }) });

    expect(qi.state.writes).toHaveLength(migration.GRANTS.length);
  });

  it("down removes exactly those (role, page, type) grants", async () => {
    const qi = fakeQueryInterface();

    await migration.down({ context: ctx(qi) });

    expect(qi.state.writes).toHaveLength(migration.GRANTS.length);
    expect((qi.state.writes[0] as Write).sql).toMatch(/^DELETE FROM role_menu_permissions/);
    expect(qi.state.writes.map((w) => w.replacements)).toEqual(migration.GRANTS.map((g) => [...g]));
  });

  it("does not swallow a failure (no blanket try/catch)", async () => {
    await expect(migration.up({ context: ctx(fakeQueryInterface({ fail: new Error("boom") })) })).rejects.toThrow("boom");
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
  });
});
