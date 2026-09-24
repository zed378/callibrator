/**
 * Migration 0032 — withdraw the DEFAULT `esignature` grant from USER, ROOM USER
 * and WAREHOUSE STAFF (A-129, ADR-051 Q-19).
 *
 * Runs the migration against a fake QueryInterface that records its SQL and
 * answers the SELECTs from an in-memory state. It proves the LOGIC: that an
 * unseeded database is left for the seed, that the DELETE is limited to the
 * three roles and to the untouched default (never a grant an administrator
 * set), that what is kept and what may be stranded is reported, that `down`
 * never overwrites a grant, and that a failure is not swallowed. The SQL
 * itself was run against PostgreSQL (see the A-129 report): a default grant
 * removed, an admin-updated one and an audited re-grant kept.
 */
const fs = require("fs");
const path = require("path");

const migration = require("../../migrations/0032-esignature-technical-roles-only");
const { ROLE_MENU_ASSIGNMENTS, ROLE_IDS, ROLE_NAMES, MENU_SLUGS } = require("../../constants");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0032-esignature-technical-roles-only.js"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

const fakeQueryInterface = ({ seeded = true, kept = [], stranded = [] } = {}) => {
  const state = { writes: [] };
  const query = jest.fn(async (sql, { replacements } = {}) => {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text.startsWith("SELECT id FROM menu_groups WHERE slug = ?")) {
      return [seeded ? [{ id: "esig-id" }] : []];
    }
    if (text.startsWith("SELECT r.name AS role")) {
      return [kept];
    }
    if (text.startsWith("SELECT s.tenant_id")) {
      return [stranded];
    }
    state.writes.push({ sql: text, replacements });
    return [[]];
  });
  return { state, sequelize: { query } };
};

let warn;
beforeEach(() => {
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe("migration 0032 — esignature for the technical roles only (A-129)", () => {
  it("is registered in the static manifest under its frozen .js name, after 0031", () => {
    const entry =
      '["0032-esignature-technical-roles-only.js", require("../migrations/0032-esignature-technical-roles-only")]';
    expect(MANIFEST).toContain(entry);
    expect(MANIFEST.indexOf(entry)).toBeGreaterThan(MANIFEST.indexOf('"0031-'));
  });

  it("the frozen role list is exactly the seeded roles ROLE_MENU_ASSIGNMENTS no longer grants `esignature`", () => {
    const seeded = Object.keys(ROLE_IDS).map((key) => ROLE_NAMES[key]);
    const withoutGrant = ROLE_MENU_ASSIGNMENTS.filter(
      (a) => seeded.includes(a.roleName) && a.menus[MENU_SLUGS.ESIGNATURE] === undefined,
    ).map((a) => a.roleName);

    expect([...migration.REVOKED_ROLES].sort()).toEqual([...withoutGrant].sort());
    expect([...migration.REVOKED_ROLES].sort()).toEqual(["ROOM USER", "USER", "WAREHOUSE STAFF"]);
    expect(migration.SLUG).toBe(MENU_SLUGS.ESIGNATURE);
  });

  it("on an unseeded database it does nothing — the seed writes the new defaults", async () => {
    const qi = fakeQueryInterface({ seeded: false });

    await migration.up({ context: qi });

    expect(qi.state.writes).toEqual([]);
    expect(qi.sequelize.query).toHaveBeenCalledTimes(1);
  });

  it("deletes only the untouched default: `write`, never updated, and no audited admin grant or revoke", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: qi });

    expect(qi.state.writes).toHaveLength(1);
    const [del] = qi.state.writes;
    expect(del.sql).toMatch(/^DELETE FROM role_menu_permissions p USING roles r, menu_groups m/);
    expect(del.replacements).toEqual(["esignature", migration.REVOKED_ROLES]);
    expect(del.sql).toContain("r.name IN (?)");
    expect(del.sql).toContain("p.permission_type = 'write'");
    expect(del.sql).toContain("p.created_at = p.updated_at");
    // The shape roles.service#assignMenuToRole / removeMenuFromRole audit.
    expect(del.sql).toContain(
      "NOT EXISTS ( SELECT 1 FROM audit_logs a WHERE a.resource_type = 'Role' AND a.resource_id = r.id::text AND a.changes->>'menuGroupId' = m.id::text )",
    );
    // Per-user grants are hand-set by definition and never touched.
    expect(SOURCE).not.toMatch(/DELETE FROM user_menu_permissions/);
  });

  it("reports every grant it kept, and every open step whose signer may now be stranded — changing neither", async () => {
    const qi = fakeQueryInterface({
      kept: [{ role: "USER", permission: "write" }],
      stranded: [{ tenant_id: "t-1", workflow_id: "wf-1", step_number: 2, role: "ROOM USER" }],
    });

    await migration.up({ context: qi });

    expect(qi.state.writes).toHaveLength(1); // the DELETE only
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/kept the "write" esignature grant of role "USER"/));
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/workflow wf-1 \(tenant t-1\) step 2 names a "ROOM USER" signer/),
    );
  });

  it("the stranded-step report reads only open, undeleted workflows", () => {
    const text = SOURCE.replace(/\s+/g, " ");
    expect(text).toContain("s.status IN ('pending', 'waiting')");
    expect(text).toContain("w.status NOT IN ('completed', 'cancelled')");
    expect(text).toContain("s.deleted_at IS NULL");
    expect(text).toContain("w.deleted_at IS NULL");
  });

  it("any failure propagates — Umzug must not record it as applied", async () => {
    const qi = fakeQueryInterface();
    qi.sequelize.query.mockRejectedValueOnce(new Error('relation "menu_groups" does not exist'));

    await expect(migration.up({ context: qi })).rejects.toThrow("does not exist");
    expect(SOURCE).not.toMatch(/\bcatch\s*[({]/);
  });

  it("down re-grants `write` only where the role has no row — it never overwrites a grant", async () => {
    const qi = fakeQueryInterface();

    await migration.down({ context: qi });

    expect(qi.state.writes).toHaveLength(1);
    expect(qi.state.writes[0].sql).toMatch(/^INSERT INTO role_menu_permissions/);
    expect(qi.state.writes[0].sql).toContain("'write'");
    expect(qi.state.writes[0].sql).toContain("NOT EXISTS");
    expect(qi.state.writes[0].replacements).toEqual(["esignature", migration.REVOKED_ROLES]);
  });

  it("accepts a { queryInterface } context as well as the QueryInterface itself", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: { queryInterface: qi } });
    await migration.down({ context: { queryInterface: qi } });

    expect(qi.state.writes).toHaveLength(2);
  });
});
