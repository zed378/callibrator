/**
 * Backfill `roles.role_level` from the ROLE_LEVELS constant (ADR-043).
 *
 * `rbac()` decides by role level (`rbac.middleware.js`), but nothing ever wrote
 * one: `role.model.js` defaults `roleLevel` to 1 and neither seed array in
 * `migration.service.js` set it, so every seeded role in every deployed
 * database carries `role_level = 1`. Every `rbac([ROLE_NAMES.TENANT_ADMIN])`
 * gate therefore compared `1 < 8` and refused every tenant administrator.
 *
 * Adding `roleLevel` to the seed arrays does NOT fix an existing database:
 * `seedDefaultRoles` / `seedApplicationRoles` skip roles that already exist
 * (`migration.service.js`), so the seed edit only affects a database that has
 * never been seeded. This migration is what repairs the ones that have.
 *
 * Scope: the eleven seeded roles, matched by name. Custom, tenant-created roles
 * are deliberately left alone — they keep the model default (1) until someone
 * sets a level through the roles API.
 *
 * Before running this against a database where an operator may have set
 * `role_level` by hand, check it: `SELECT name, role_level FROM roles;`. Nothing
 * in `backend/src` wrote the column before this migration, so every row should
 * read 1; anything else is a hand-made authorization decision this migration
 * would overwrite.
 *
 * No blanket try/catch: a migration that swallows its own errors is recorded as
 * applied while having done nothing (CLAUDE.md; 0008/0013/0014 did exactly
 * that). Verify with `SELECT name, role_level FROM roles ORDER BY role_level;`
 * — the migration log is not evidence.
 */
const { ROLE_NAMES, ROLE_LEVELS } = require("../constants");

/**
 * The seeded role NAME → level pairs, built from the two constants that already
 * share their keys. TENANT_ADMIN is excluded on purpose: it is a logical tier,
 * not a seeded role (see roleConstants.js).
 * @returns {Array<[string, number]>} name/level pairs
 */
function seededRoleLevels() {
  return Object.entries(ROLE_NAMES)
    .filter(([key]) => key !== "TENANT_ADMIN" && ROLE_LEVELS[key] !== undefined)
    .map(([key, name]) => [name, ROLE_LEVELS[key]]);
}

/**
 * Apply one `UPDATE ... CASE` over the named roles.
 * @param {import("sequelize").QueryInterface} queryInterface - query interface
 * @param {(level: number) => number} targetFor - maps a role's constant level
 *   to the value to write (identity for `up`, always 1 for `down`)
 * @returns {Promise<void>} resolves when the update has run
 */
async function setLevels(queryInterface, targetFor) {
  const pairs = seededRoleLevels();
  const cases = pairs.map(() => "WHEN ? THEN ?").join(" ");
  const replacements = [];
  for (const [name, level] of pairs) {
    replacements.push(name, targetFor(level));
  }
  for (const [name] of pairs) {
    replacements.push(name);
  }
  const names = pairs.map(() => "?").join(", ");

  await queryInterface.sequelize.query(
    `UPDATE roles
        SET role_level = CASE name ${cases} ELSE role_level END
      WHERE name IN (${names})`,
    { replacements },
  );
}

module.exports = {
  async up({ context }) {
    const queryInterface = context.queryInterface || context;
    const { DataTypes } = require("sequelize");

    // A database created before `roleLevel` reached the model has no column to
    // backfill. Add it first, at the model's own default, rather than failing.
    const table = await queryInterface.describeTable("roles");
    if (!table.role_level) {
      await queryInterface.addColumn("roles", "role_level", {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 1,
      });
    }

    await setLevels(queryInterface, (level) => level);
  },

  async down({ context }) {
    const queryInterface = context.queryInterface || context;

    // Reverse of `up`: the seeded roles go back to the model default (1), which
    // is what every one of them held before this migration ran. The column
    // itself is left in place — it belongs to the model, not to this migration.
    await setLevels(queryInterface, () => 1);
  },
};
