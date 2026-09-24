"use strict";

/**
 * Per-tenant NC / CAPA numbering that cannot collide (A-73).
 *
 * qms.service issued `NC-<count()+1>` / `CAPA-<count()+1>`. Two concurrent
 * creates read the same count and got the same number, and no constraint
 * stopped it. This migration:
 *
 *  1. REFUSES to run while duplicate numbers exist within a tenant — see
 *     "Why fail rather than renumber" below;
 *  2. creates `qms_counters` — one row per (tenant, kind) that
 *     qms.service#claimNumber upserts and locks for the life of the create's
 *     transaction, so concurrent creates in a tenant serialise on it;
 *  3. adds the composite unique indexes (tenant_id, nc_number) and
 *     (tenant_id, capa_number) — the backstop that makes a collision a failed
 *     INSERT instead of a duplicated quality-record identifier.
 *
 * PER TENANT, NEVER GLOBAL. A global unique on the number would let a tenant
 * learn that "NC-00007" exists somewhere else by failing to create it — a
 * cross-tenant existence oracle (CLAUDE.md traps table).
 *
 * The indexes cover soft-deleted rows too (no `WHERE deleted_at IS NULL`): a
 * number, once issued, is never re-issued.
 *
 * Why fail rather than renumber. NC and CAPA numbers are the identifiers of
 * ISO 13485 quality records: they are printed, quoted in audit_logs `changes`,
 * and referenced outside the system. Renumbering a record from a migration —
 * however deterministic — rewrites a controlled record's identity without an
 * authorised change, and the external references silently point at the wrong
 * record. So a duplicate stops the migration with the offending tenants and
 * numbers named, and a person decides. (No NC/CAPA delete route exists, so a
 * duplicate can only have come from the concurrency race; it should be rare.)
 * The check runs BEFORE any DDL, so a refused run leaves nothing half-applied.
 * Migrations run at boot (index.js: db.sync() then migrator.up()), so a
 * refusal also refuses the boot, with this message.
 *
 * The indexes and the counter table live only here, not on the models: sync()
 * would try to build the unique index on an upgraded database before this
 * migration had checked for duplicates, and fail with a bare constraint error.
 *
 * Idempotent + reversible. There is no try/catch at all: table presence is
 * read from showAllTables(), so every failure propagates and Umzug cannot
 * record this migration as applied while it did nothing.
 */

const COUNTERS = "qms_counters";

const TARGETS = [
  { table: "non_conformances", column: "nc_number", index: "non_conformances_tenant_id_nc_number_unique" },
  { table: "capas", column: "capa_number", index: "capas_tenant_id_capa_number_unique" },
];

/** How many duplicate groups a refusal lists before summarising. */
const REPORT_LIMIT = 20;

/** Lower-cased table names present in the database. */
const tableNames = async (queryInterface) =>
  (await queryInterface.showAllTables()).map((t) =>
    (typeof t === "object" ? t.tableName : t).toLowerCase(),
  );

/** Index names on a table, so each index step is idempotent without a catch. */
const indexNames = async (queryInterface, table) =>
  (await queryInterface.showIndex(table)).map((index) => index.name);

/**
 * Every (tenant, number) issued more than once, soft-deleted rows included.
 * @returns {Promise<Array<{tenant_id: string, number: string, copies: number}>>}
 */
const findDuplicates = async (queryInterface, { table, column }) => {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT tenant_id, ${column} AS number, COUNT(*)::int AS copies
       FROM ${table}
      GROUP BY tenant_id, ${column}
     HAVING COUNT(*) > 1
      ORDER BY tenant_id, ${column}`,
  );
  return rows;
};

/** The refusal. Names the table, each duplicate, and what to do. */
const duplicateError = (found) => {
  const lines = [];
  let total = 0;
  for (const { table, column, duplicates } of found) {
    total += duplicates.length;
    for (const d of duplicates.slice(0, REPORT_LIMIT)) {
      lines.push(`  ${table}.${column} = '${d.number}' ×${d.copies} in tenant ${d.tenant_id}`);
    }
    if (duplicates.length > REPORT_LIMIT) {
      lines.push(`  … and ${duplicates.length - REPORT_LIMIT} more in ${table}`);
    }
  }
  return new Error(
    `Migration 0024 refused: ${total} NC/CAPA number(s) are issued more than once within a tenant ` +
      "(A-73, the count()+1 race). A per-tenant unique index cannot be created over them, and this " +
      "migration will not renumber quality records on its own authority.\n" +
      `${lines.join("\n")}\n` +
      "Resolve each one deliberately (keep the original number on the earliest record, give the " +
      "others new numbers above the tenant's highest, and record the change), then re-run. " +
      "Find them with: SELECT tenant_id, nc_number, array_agg(id ORDER BY created_at) " +
      "FROM non_conformances GROUP BY 1, 2 HAVING COUNT(*) > 1; (and the same for capas.capa_number).",
  );
};

module.exports = {
  COUNTERS,
  TARGETS,

  up: async ({ context }) => {
    const present = await tableNames(context);
    // A table db.sync() has not created yet has no rows and no index to add;
    // the migration still creates the counter table.
    const targets = TARGETS.filter((t) => present.includes(t.table));

    // 1. Refuse on duplicates — before ANY change.
    const found = [];
    for (const target of targets) {
      const duplicates = await findDuplicates(context, target);
      if (duplicates.length) {
        found.push({ ...target, duplicates });
      }
    }
    if (found.length) {
      throw duplicateError(found);
    }

    // 2. The counter table. (tenant_id, kind) is the primary key and the
    //    ON CONFLICT target qms.service#claimNumber names.
    if (!present.includes(COUNTERS)) {
      const DataTypes = context.sequelize.Sequelize.DataTypes;
      await context.createTable(COUNTERS, {
        tenant_id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
          references: { model: "tenants", key: "id" },
          onDelete: "CASCADE",
        },
        kind: {
          type: DataTypes.STRING(16),
          allowNull: false,
          primaryKey: true,
        },
        seq: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false },
      });
    }

    // 3. The per-tenant unique indexes.
    for (const { table, column, index } of targets) {
      if (!(await indexNames(context, table)).includes(index)) {
        await context.addIndex(table, ["tenant_id", column], { name: index, unique: true });
      }
    }
  },

  down: async ({ context }) => {
    const present = await tableNames(context);
    for (const { table, index } of TARGETS) {
      if (present.includes(table) && (await indexNames(context, table)).includes(index)) {
        await context.removeIndex(table, index);
      }
    }
    if (present.includes(COUNTERS)) {
      await context.dropTable(COUNTERS);
    }
  },
};
