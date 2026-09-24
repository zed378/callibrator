/**
 * Migration 0038 — the `ai-assistant` menu entry and its grants (A-118).
 *
 * Runs the migration against a fake QueryInterface that records its SQL and
 * answers the SELECTs from an in-memory state. It proves the LOGIC: a seeded
 * database gets the group under mgmt-quality with the seed's fixed id, and a
 * `read` grant for every role that can use one of the page's two calls (read
 * from the role's current grants, never overwriting one set by hand); an
 * unseeded database is left to the seed; it is idempotent, reversible, and a
 * failure is not swallowed.
 *
 * The SQL itself was run against pgvector/pgvector:pg18 on 2026-09-24 (a
 * minimal roles / menu_groups / role_menu_permissions schema holding
 * ROLE_MENU_ASSIGNMENTS' defaults): the group was created under mgmt-quality
 * with the fixed id; `read` grants went to CALIBRATOR ADMIN, ENGINEERING
 * MANAGER, HEALTHCARE ADMIN, SUPERADMIN and a TECHNICIAN customised with `sop`
 * read — not to a SUPERVISOR customised with `certificate` READ; a second `up`
 * added nothing; `down` left no group and no grants. That was not the full
 * application schema: `make migrate && make migrate-verify` is still the check.
 */
const fs = require("fs");
const path = require("path");

const migration = require("../../migrations/0038-ai-assistant-menu");
const { ROLE_MENU_ASSIGNMENTS, MENU_SLUGS } = require("../../constants");
const { getMenuGroupId } = require("../../utils/seedMenuGroups.util");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0038-ai-assistant-menu.js"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");
const SEED = fs.readFileSync(path.join(__dirname, "../../utils/seedMenuGroups.util.js"), "utf8");
const AI_ROUTE = fs.readFileSync(path.join(__dirname, "../../routes/api/ai.route.js"), "utf8");

const fakeQueryInterface = ({ seeded = true, groupExists = false, idTaken = false, parent = true } = {}) => {
  const state = { seeded, groupExists, idTaken, parent, writes: [] };
  const query = jest.fn(async (sql, { replacements } = {}) => {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text.startsWith("SELECT id FROM menu_groups WHERE slug = 'home'")) {
      return [state.seeded ? [{ id: "home-id" }] : []];
    }
    if (text.startsWith("SELECT id FROM menu_groups WHERE slug = ?")) {
      if (replacements[0] === "ai-assistant") {
        return [state.groupExists ? [{ id: "ai-id" }] : []];
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

describe("migration 0038 — ai-assistant menu entry and grants (A-118)", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0038-ai-assistant-menu.js", require("../migrations/0038-ai-assistant-menu")]',
    );
  });

  it("uses the seed's slug, fixed id, parent and icon", () => {
    expect(migration.SLUG).toBe(MENU_SLUGS.AI_ASSISTANT);
    expect(migration.FIXED_ID).toBe(getMenuGroupId("ai-assistant"));
    expect(SEED).toMatch(
      /name: "AI Assistant",\s*slug: "ai-assistant",\s*icon: "Sparkles",\s*sortOrder: 6,\s*is_active: true,\s*parentSlug: "mgmt-quality"/,
    );
    expect(SOURCE).toContain("'AI Assistant', ?, 'Sparkles', ?, 6");
  });

  it("follows the slugs the page's routes are gated on — `sop` for /query, `certificate` for /ocr", () => {
    expect(AI_ROUTE).toMatch(/dynamicAccess\(MENU_SLUGS\.SOP, "read"\)/);
    expect(AI_ROUTE).toMatch(/dynamicAccess\("certificate", "write"\)/);
    expect(migration.SOP_SLUGS).toEqual(["sop", "mgmt-quality"]);
    expect(migration.CERTIFICATE_WRITE_SLUGS).toEqual(["certificate", "equipment"]);
  });

  it("the seeded default grants the entry to exactly the roles that hold `sop` or can write `certificate`", () => {
    // What the migration's query selects, evaluated over the seeded defaults.
    const eligible = ROLE_MENU_ASSIGNMENTS.filter(({ menus }) =>
      Object.entries(menus).some(
        ([slug, type]) =>
          migration.SOP_SLUGS.includes(slug) ||
          (migration.CERTIFICATE_WRITE_SLUGS.includes(slug) && type === "write"),
      ),
    ).map((a) => a.roleName);
    const granted = ROLE_MENU_ASSIGNMENTS.filter((a) => a.menus[MENU_SLUGS.AI_ASSISTANT]).map(
      (a) => a.roleName,
    );

    expect(granted.sort()).toEqual(eligible.sort());
    expect(granted).toEqual(
      expect.arrayContaining(["SUPERADMIN", "HEALTHCARE ADMIN", "CALIBRATOR ADMIN", "ENGINEERING MANAGER"]),
    );
    expect(granted).toHaveLength(4);
  });

  it("on a seeded database: creates the group under mgmt-quality with the fixed id, then grants read to the eligible roles", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: qi });

    const [group, grants] = qi.state.writes;
    expect(qi.state.writes).toHaveLength(2);
    expect(group.sql).toMatch(/^INSERT INTO menu_groups/);
    expect(group.replacements).toEqual([migration.FIXED_ID, "ai-assistant", "quality-id"]);
    expect(grants.sql).toMatch(/^INSERT INTO role_menu_permissions/);
    expect(grants.sql).toContain("'read'");
    expect(grants.sql).toContain("g.permission_type = 'write'");
    // Never overwrites a grant somebody set by hand.
    expect(grants.sql).toContain("NOT EXISTS");
    expect(grants.replacements).toEqual([
      "ai-assistant",
      ["sop", "mgmt-quality"],
      ["certificate", "equipment"],
    ]);
  });

  it("generates an id when the fixed one is taken, and goes top level when mgmt-quality is absent", async () => {
    const qi = fakeQueryInterface({ idTaken: true, parent: false });

    await migration.up({ context: qi });

    const [group] = qi.state.writes;
    expect(group.sql).toContain("gen_random_uuid()");
    expect(group.replacements).toEqual(["ai-assistant", null]);
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
      expect(write.replacements).toEqual(["ai-assistant"]);
    }
  });

  it("accepts a { queryInterface } context as well as the QueryInterface itself", async () => {
    const up = fakeQueryInterface();
    await migration.up({ context: { queryInterface: up } });
    expect(up.state.writes).toHaveLength(2);

    const down = fakeQueryInterface();
    await migration.down({ context: { queryInterface: down } });
    expect(down.state.writes).toHaveLength(3);
  });
});
