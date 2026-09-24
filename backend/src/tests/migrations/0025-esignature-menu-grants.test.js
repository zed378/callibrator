/**
 * Migration 0025 — the `esignature` menu group and its grants (A-84).
 *
 * Runs the migration against a fake QueryInterface that records its SQL and
 * answers the SELECTs from an in-memory state. It proves the LOGIC: that a
 * seeded database gets the group and a `write` grant for every seeded role,
 * that an unseeded one is left for the seed, that it is idempotent and
 * reversible, and that a failure is not swallowed. The SQL itself was run
 * against pgvector/pgvector:pg18 (18.6): group created under mgmt-quality with
 * the fixed id, 11 grants, a hand-set grant kept on re-run, down removes all.
 */
const fs = require("fs");
const path = require("path");

const migration = require("../../migrations/0025-esignature-menu-grants");
const { ROLE_MENU_ASSIGNMENTS, ROLE_IDS, ROLE_NAMES, MENU_SLUGS } = require("../../constants");
const { getMenuGroupId } = require("../../utils/seedMenuGroups.util");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0025-esignature-menu-grants.js"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

/**
 * @param {{seeded?: boolean, groupExists?: boolean, idTaken?: boolean, parent?: boolean}} state
 */
const fakeQueryInterface = ({ seeded = true, groupExists = false, idTaken = false, parent = true } = {}) => {
  const state = { seeded, groupExists, idTaken, parent, writes: [] };
  const query = jest.fn(async (sql, { replacements } = {}) => {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text.startsWith("SELECT id FROM menu_groups WHERE slug = 'home'")) {
      return [state.seeded ? [{ id: "home-id" }] : []];
    }
    if (text.startsWith("SELECT id FROM menu_groups WHERE slug = ?")) {
      if (replacements[0] === "esignature") {
        return [state.groupExists ? [{ id: "esig-id" }] : []];
      }
      return [state.parent ? [{ id: "quality-id" }] : []];
    }
    if (text.startsWith("SELECT id FROM menu_groups WHERE id = ?")) {
      return [state.idTaken ? [{ id: replacements[0] }] : []];
    }
    state.writes.push({ sql: text, replacements });
    if (text.startsWith("INSERT INTO menu_groups")) {
      state.groupExists = true;
    }
    return [[]];
  });
  return { state, sequelize: { query } };
};

describe("migration 0025 — esignature menu group and grants (A-84)", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0025-esignature-menu-grants.js", require("../migrations/0025-esignature-menu-grants")]',
    );
  });

  it("the frozen role list is every seeded role — ROLE_MENU_ASSIGNMENTS as it stood when 0025 was written", () => {
    // A-129 (ADR-051 Q-19) later narrowed ROLE_MENU_ASSIGNMENTS; migration
    // 0032 withdrew the untouched default from the roles it names. What 0025
    // did is frozen: its list plus 0032's is still every seeded role, and
    // today's grants are exactly its list minus 0032's.
    const granted = ROLE_MENU_ASSIGNMENTS.filter(
      (a) => a.menus[MENU_SLUGS.ESIGNATURE] === "write",
    ).map((a) => a.roleName);
    const seeded = Object.keys(ROLE_IDS).map((key) => ROLE_NAMES[key]);
    const { REVOKED_ROLES } = require("../../migrations/0032-esignature-technical-roles-only");

    expect([...migration.GRANTED_ROLES].sort()).toEqual([...seeded].sort());
    expect(
      migration.GRANTED_ROLES.filter((role) => !REVOKED_ROLES.includes(role)).sort(),
    ).toEqual([...granted].sort());
  });

  it("uses the same slug and fixed id as the seed", () => {
    expect(migration.SLUG).toBe(MENU_SLUGS.ESIGNATURE);
    expect(migration.FIXED_ID).toBe(getMenuGroupId("esignature"));
  });

  it("on a seeded database: creates the group under mgmt-quality with the fixed id, then grants write to every seeded role", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: qi });

    const [group, grants] = qi.state.writes;
    expect(qi.state.writes).toHaveLength(2);
    expect(group.sql).toMatch(/^INSERT INTO menu_groups/);
    expect(group.replacements).toEqual([migration.FIXED_ID, "esignature", "quality-id"]);
    expect(grants.sql).toMatch(/^INSERT INTO role_menu_permissions/);
    expect(grants.sql).toContain("'write'");
    // Never overwrites a grant somebody set by hand.
    expect(grants.sql).toContain("NOT EXISTS");
    expect(grants.replacements).toEqual(["esignature", migration.GRANTED_ROLES]);
  });

  it("generates an id when the fixed one is taken, and goes top level when mgmt-quality is absent", async () => {
    const qi = fakeQueryInterface({ idTaken: true, parent: false });

    await migration.up({ context: qi });

    const [group] = qi.state.writes;
    expect(group.sql).toContain("gen_random_uuid()");
    expect(group.replacements).toEqual(["esignature", null]);
  });

  it("on an unseeded database it does nothing — the seed creates the group and grants", async () => {
    const qi = fakeQueryInterface({ seeded: false });

    await migration.up({ context: qi });

    expect(qi.state.writes).toEqual([]);
  });

  it("is idempotent: when the group exists, only the NOT EXISTS grant insert runs", async () => {
    const qi = fakeQueryInterface({ groupExists: true });

    await migration.up({ context: qi });

    expect(qi.state.writes).toHaveLength(1);
    expect(qi.state.writes[0].sql).toMatch(/^INSERT INTO role_menu_permissions/);
  });

  it("any failure propagates — Umzug must not record it as applied", async () => {
    const qi = fakeQueryInterface();
    qi.sequelize.query.mockRejectedValueOnce(new Error('relation "menu_groups" does not exist'));

    await expect(migration.up({ context: qi })).rejects.toThrow("does not exist");
    expect(SOURCE).not.toMatch(/\bcatch\s*[({]/);
  });

  it("down removes the grants and the group", async () => {
    const qi = fakeQueryInterface();

    await migration.down({ context: qi });

    expect(qi.state.writes.map((w) => w.sql.split(" ").slice(0, 3).join(" "))).toEqual([
      "DELETE FROM role_menu_permissions",
      "DELETE FROM user_menu_permissions",
      "DELETE FROM menu_groups",
    ]);
    for (const write of qi.state.writes) {
      expect(write.replacements).toEqual(["esignature"]);
    }
  });

  it("accepts a { queryInterface } context as well as the QueryInterface itself", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: { queryInterface: qi } });
    await migration.down({ context: { queryInterface: qi } });

    expect(qi.state.writes).toHaveLength(5);
  });
});
