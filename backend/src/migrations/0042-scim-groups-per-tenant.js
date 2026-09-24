"use strict";

/**
 * `scim_groups` — SCIM Groups owned by a tenant, mapped to an existing role
 * (ADR-053; A-38, A-39, A-49).
 *
 * A SCIM Group used to BE a row in the global `roles` table, so one tenant's
 * IdP listed, name-probed and deleted roles every tenant shares. A group is now
 * a tenant-owned row that points at a role; the role itself is never created,
 * renamed or deleted through SCIM.
 *
 * This migration:
 *  1. creates `scim_groups` when it is absent (db.sync() creates it first at
 *     boot; a standalone `npm run migrate` does not run sync);
 *  2. REFUSES to continue while two groups of one tenant share a display name
 *     case-insensitively, or share a role — possible only if the table existed
 *     without these indexes. It does not choose which group to keep;
 *  3. adds UNIQUE (tenant_id, lower(display_name)) — case-insensitive and per
 *     tenant, so another tenant's name is never a 409 (the A-38/A-49 oracle);
 *  4. adds UNIQUE (tenant_id, role_id) — membership is derived from the
 *     members' roleId, so two groups on one role would share their members.
 *     NULLs stay distinct: any number of unmapped groups may exist.
 *
 * NOT migrated: roles an IdP created through the old code ("SCIM-provisioned
 * group: …" descriptions). Nothing records which tenant created them, and
 * guessing from their members could hand a group to the wrong hospital. They
 * stay ordinary global roles; an IdP re-creates its groups and an administrator
 * maps them with `roleId`.
 *
 * The two unique indexes live only here, not on the model (the 0024/0026
 * pattern): an expression index cannot be declared portably on the model, and
 * building one during sync() would fail with a bare constraint error before
 * step 2 could name the duplicates.
 *
 * No try/catch: every failure propagates (CLAUDE.md; 0008/0013/0014). Verify
 * with psql, not the log:
 *   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'scim_groups';
 */

const TABLE = "scim_groups";
const NAME_INDEX = "scim_groups_tenant_id_lower_display_name_unique";
const ROLE_INDEX = "scim_groups_tenant_id_role_id_unique";

/** How many duplicate groups a refusal lists before summarising. */
const REPORT_LIMIT = 20;

const tableNames = async (queryInterface) =>
  (await queryInterface.showAllTables()).map((t) =>
    (typeof t === "object" ? t.tableName : t).toLowerCase(),
  );

// pg_indexes, not showIndex(): Sequelize's showIndex joins pg_attribute on the
// index key columns, and an expression index (lower(display_name)) has key 0 —
// it would be missed, and a re-run would try to create it a second time.
const indexNames = async (queryInterface) => {
  const [rows] = await queryInterface.sequelize.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ?",
    { replacements: [TABLE] },
  );
  return rows.map((row) => row.indexname);
};

/**
 * Rows that would violate one of the two unique indexes.
 * @returns {Promise<Array<{tenant_id: string, key: string, n: number}>>}
 */
const duplicates = async (queryInterface, keySql) => {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT tenant_id, ${keySql} AS key, COUNT(*)::int AS n
       FROM ${TABLE}
      WHERE ${keySql} IS NOT NULL
      GROUP BY tenant_id, ${keySql}
     HAVING COUNT(*) > 1
      ORDER BY tenant_id, key
      LIMIT ${REPORT_LIMIT + 1}`,
  );
  return rows;
};

const describeDuplicates = (label, rows) => {
  const shown = rows.slice(0, REPORT_LIMIT).map((r) => `  tenant ${r.tenant_id}: ${label} "${r.key}" × ${r.n}`);
  const more = rows.length > REPORT_LIMIT ? "\n  … and more" : "";
  return `${shown.join("\n")}${more}`;
};

module.exports = {
  TABLE,
  NAME_INDEX,
  ROLE_INDEX,

  async up({ context }) {
    const queryInterface = context;
    const { DataTypes, Sequelize } = require("sequelize");

    if (!(await tableNames(queryInterface)).includes(TABLE)) {
      await queryInterface.createTable(TABLE, {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        tenant_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: "tenants", key: "id" },
          onDelete: "RESTRICT",
          onUpdate: "CASCADE",
        },
        display_name: { type: DataTypes.STRING(255), allowNull: false },
        role_id: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: "roles", key: "id" },
          onDelete: "RESTRICT",
          onUpdate: "CASCADE",
        },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      });
      await queryInterface.addIndex(TABLE, ["tenant_id"]);
      await queryInterface.addIndex(TABLE, ["role_id"]);
    }

    const byName = await duplicates(queryInterface, "lower(display_name)");
    const byRole = await duplicates(queryInterface, "role_id::text");
    if (byName.length > 0 || byRole.length > 0) {
      const parts = [];
      if (byName.length > 0) {
        parts.push(describeDuplicates("display name", byName));
      }
      if (byRole.length > 0) {
        parts.push(describeDuplicates("role", byRole));
      }
      throw new Error(
        `0042: ${TABLE} holds groups that the new unique indexes would reject. ` +
          `Resolve them by hand (rename or delete one of each), then re-run:\n${parts.join("\n")}`,
      );
    }

    const existing = await indexNames(queryInterface);
    if (!existing.includes(NAME_INDEX)) {
      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX "${NAME_INDEX}" ON "${TABLE}" (tenant_id, lower(display_name))`,
      );
    }
    if (!existing.includes(ROLE_INDEX)) {
      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX "${ROLE_INDEX}" ON "${TABLE}" (tenant_id, role_id)`,
      );
    }
  },

  // Drops the table: every tenant's group-to-role mapping is lost. The users'
  // roles are untouched — they live on `users.role_id`, not here.
  async down({ context }) {
    const queryInterface = context;
    if ((await tableNames(queryInterface)).includes(TABLE)) {
      await queryInterface.dropTable(TABLE);
    }
  },
};
