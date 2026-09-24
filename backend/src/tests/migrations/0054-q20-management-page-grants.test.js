/**
 * Migration 0054 — Q-20: grants for the Management pages only SUPERADMIN could
 * reach (users, vendors, billing, audit; content stays SUPERADMIN-only).
 *
 * The logic runs against a fake QueryInterface that records its SQL. The SQL
 * itself was run on a private PostgreSQL 16 cluster (not 18, no pgvector) with
 * a minimal roles / menu_groups / role_menu_permissions schema — see the
 * change record; `make migrate && make migrate-verify` remains the check on
 * the real schema.
 */
const fs = require("fs");
const path = require("path");

const migration = require("../../migrations/0054-q20-management-page-grants");
const { ROLE_MENU_ASSIGNMENTS, MENU_SLUGS } = require("../../constants");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0054-q20-management-page-grants.js"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

const fakeQueryInterface = ({ seeded = true, fail = null } = {}) => {
  const state = { writes: [] };
  const query = jest.fn(async (sql, { replacements } = {}) => {
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
    const Q20_SLUGS = [MENU_SLUGS.USERS, MENU_SLUGS.VENDORS, MENU_SLUGS.BILLING, MENU_SLUGS.AUDIT];
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

    await migration.up({ context: qi });

    expect(qi.state.writes).toHaveLength(migration.GRANTS.length);
    for (const [i, [role, slug, type]] of migration.GRANTS.entries()) {
      expect(qi.state.writes[i].sql).toMatch(/^INSERT INTO role_menu_permissions/);
      expect(qi.state.writes[i].sql).toContain("AND NOT EXISTS");
      expect(qi.state.writes[i].replacements).toEqual([type, role, slug]);
    }
  });

  it("does nothing on a database that has not been seeded", async () => {
    const qi = fakeQueryInterface({ seeded: false });

    await migration.up({ context: qi });

    expect(qi.state.writes).toEqual([]);
  });

  it("accepts the Umzug context shape { queryInterface }", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: { queryInterface: qi } });

    expect(qi.state.writes).toHaveLength(migration.GRANTS.length);
  });

  it("down removes exactly those (role, page, type) grants", async () => {
    const qi = fakeQueryInterface();

    await migration.down({ context: qi });

    expect(qi.state.writes).toHaveLength(migration.GRANTS.length);
    expect(qi.state.writes[0].sql).toMatch(/^DELETE FROM role_menu_permissions/);
    expect(qi.state.writes.map((w) => w.replacements)).toEqual(migration.GRANTS.map((g) => [...g]));
  });

  it("does not swallow a failure (no blanket try/catch)", async () => {
    await expect(migration.up({ context: fakeQueryInterface({ fail: new Error("boom") }) })).rejects.toThrow("boom");
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
  });
});
