/**
 * Migration 0027 — backfill the `profile-page` grants (A-80).
 *
 * Runs the migration against a fake QueryInterface that records its SQL. It
 * proves the LOGIC: the right slug and frozen role list, a grant that never
 * overwrites an existing row, a reversible down, a failure that is not
 * swallowed, and a role list that matched ROLE_MENU_ASSIGNMENTS when written.
 *
 * The SQL itself was run by hand (2026-09-24) through Sequelize against
 * pgvector/pgvector:pg18 (18.6) on a MINIMAL schema (roles, menu_groups,
 * role_menu_permissions with the real column names, not the real DDL):
 * unseeded -> 0 rows; seeded + a hand-set TECHNICIAN `read` -> 11 grants, the
 * hand-set `read` kept, a tenant-created role untouched, second `up` a no-op;
 * `down` -> 0 rows. Still owed: `make migrate` + `make migrate-verify` on the
 * real schema.
 */
const fs = require("fs");
const path = require("path");

const migration = require("../../migrations/0027-profile-page-grants");
const { ROLE_MENU_ASSIGNMENTS, ROLE_IDS, ROLE_NAMES, MENU_SLUGS } = require("../../constants");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0027-profile-page-grants.js"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");
const SEED = fs.readFileSync(
  path.join(__dirname, "../../utils/seedMenuGroups.util.js"),
  "utf8",
);

const fakeQueryInterface = () => {
  const writes = [];
  const query = jest.fn(async (sql, { replacements } = {}) => {
    writes.push({ sql: sql.replace(/\s+/g, " ").trim(), replacements });
    return [[]];
  });
  return { writes, sequelize: { query } };
};

describe("migration 0027 — profile-page grants (A-80)", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0027-profile-page-grants.js", require("../migrations/0027-profile-page-grants")]',
    );
  });

  it("targets the slug the seed creates, which is now MENU_SLUGS.PROFILE", () => {
    expect(migration.SLUG).toBe("profile-page");
    expect(migration.SLUG).toBe(MENU_SLUGS.PROFILE);
    expect(SEED).toMatch(/slug: "profile-page"/);
  });

  it("the frozen role list is exactly the seeded roles ROLE_MENU_ASSIGNMENTS grants the Profile page `write`", () => {
    const granted = ROLE_MENU_ASSIGNMENTS.filter(
      (a) => a.menus[MENU_SLUGS.PROFILE] === "write",
    ).map((a) => a.roleName);
    const seeded = Object.keys(ROLE_IDS).map((key) => ROLE_NAMES[key]);

    expect([...migration.GRANTED_ROLES].sort()).toEqual([...granted].sort());
    expect([...migration.GRANTED_ROLES].sort()).toEqual([...seeded].sort());
  });

  it("up inserts a `write` grant for every frozen role, never overwriting an existing row", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: qi });

    expect(qi.writes).toHaveLength(1);
    const [grant] = qi.writes;
    expect(grant.sql).toMatch(/^INSERT INTO role_menu_permissions/);
    expect(grant.sql).toContain("'write'");
    expect(grant.sql).toContain("NOT EXISTS");
    expect(grant.sql).not.toMatch(/\bUPDATE\b/);
    expect(grant.replacements).toEqual(["profile-page", migration.GRANTED_ROLES]);
  });

  it("any failure propagates — Umzug must not record it as applied", async () => {
    const qi = fakeQueryInterface();
    qi.sequelize.query.mockRejectedValueOnce(new Error('relation "menu_groups" does not exist'));

    await expect(migration.up({ context: qi })).rejects.toThrow("does not exist");
    expect(SOURCE).not.toMatch(/\bcatch\s*[({]/);
  });

  it("down removes the profile-page grants of the frozen roles, and nothing else", async () => {
    const qi = fakeQueryInterface();

    await migration.down({ context: qi });

    expect(qi.writes).toHaveLength(1);
    expect(qi.writes[0].sql).toMatch(/^DELETE FROM role_menu_permissions/);
    expect(qi.writes[0].replacements).toEqual(["profile-page", migration.GRANTED_ROLES]);
  });

  it("accepts a { queryInterface } context as well as the QueryInterface itself", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: { queryInterface: qi } });
    await migration.down({ context: { queryInterface: qi } });

    expect(qi.writes).toHaveLength(2);
  });
});
