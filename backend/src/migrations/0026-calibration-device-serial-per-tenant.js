"use strict";

/**
 * `calibration_devices.serial_number` unique PER TENANT, not globally (D-04).
 *
 * The column carried a GLOBAL unique constraint — twice over: `unique: true` on
 * the attribute (a constraint, `calibration_devices_serial_number_key`, created
 * with the table) and a unique model index (`calibration_devices_serial_number`).
 * The duplicate check in calibrationDevices.service#createCalibrationDevice is
 * narrowed to the caller's tenant, so a serial number held by ANOTHER tenant
 * passed the check and failed the insert with a database error:
 *
 *  - an existence oracle — a serial number is printed on the instrument, so a
 *    caller learned which hospital owns which analyser by failing to register
 *    it (CLAUDE.md traps table: a global uniqueness constraint);
 *  - a real collision — two hospitals owning the same instrument model from a
 *    manufacturer that reuses serials could not both register it, and the CSV
 *    bulk import failed its whole batch on one such row.
 *
 * This migration:
 *  1. REFUSES to run while a serial number repeats within one tenant — which
 *     can only happen if the global constraint was never there. It does not
 *     pick a winner among a hospital's device records on its own authority;
 *  2. drops every unique constraint and unique index whose key is exactly
 *     (serial_number), whatever it is called — the names differ between a
 *     database created by sync() and one created by hand;
 *  3. adds UNIQUE (tenant_id, serial_number).
 *
 * NULLs stay distinct (PostgreSQL default), so serial-less devices behave as
 * before. Soft-deleted rows are covered, exactly as they were by the global
 * constraint — this narrows the scope of the constraint and changes nothing
 * else about it.
 *
 * The composite index lives only here, not on the model (the 0024 pattern):
 * db.sync() runs before migrations at boot, and building the index from the
 * model would fail with a bare constraint error before step 1 could name the
 * duplicates.
 *
 * No try/catch: every failure propagates (CLAUDE.md; 0008/0013/0014). Verify
 * with psql, not the log:
 *   SELECT pg_get_indexdef(ix.indexrelid) FROM pg_index ix
 *     JOIN pg_class t ON t.oid = ix.indrelid
 *    WHERE t.relname = 'calibration_devices' AND ix.indisunique;
 */

const TABLE = "calibration_devices";
const COLUMN = "serial_number";
const INDEX = "calibration_devices_tenant_id_serial_number_unique";
const GLOBAL_INDEX = "calibration_devices_serial_number";

/** How many duplicate groups a refusal lists before summarising. */
const REPORT_LIMIT = 20;

const tableNames = async (queryInterface) =>
  (await queryInterface.showAllTables()).map((t) =>
    (typeof t === "object" ? t.tableName : t).toLowerCase(),
  );

const indexNames = async (queryInterface) =>
  (await queryInterface.showIndex(TABLE)).map((index) => index.name);

/**
 * Unique constraints and unique indexes whose key is exactly (serial_number).
 * Constraint-backed indexes are reported as constraints (they must be dropped
 * with ALTER TABLE … DROP CONSTRAINT), the rest as plain indexes.
 *
 * @returns {Promise<{constraints: string[], indexes: string[]}>}
 */
const globalUniques = async (queryInterface) => {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT i.relname AS index_name, c.conname AS constraint_name
       FROM pg_index ix
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
       LEFT JOIN pg_constraint c ON c.conindid = ix.indexrelid AND c.contype = 'u'
      WHERE t.relname = ?
        AND n.nspname = current_schema()
        AND ix.indisunique
        AND NOT ix.indisprimary
        AND ix.indnkeyatts = 1
        AND a.attname = ?`,
    { replacements: [TABLE, COLUMN] },
  );
  return {
    constraints: rows.filter((r) => r.constraint_name).map((r) => r.constraint_name),
    indexes: rows.filter((r) => !r.constraint_name).map((r) => r.index_name),
  };
};

/** (tenant, serial) pairs held by more than one row, soft-deleted rows included. */
const findDuplicates = async (queryInterface) => {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT tenant_id, ${COLUMN} AS serial, COUNT(*)::int AS copies
       FROM ${TABLE}
      WHERE ${COLUMN} IS NOT NULL
      GROUP BY tenant_id, ${COLUMN}
     HAVING COUNT(*) > 1
      ORDER BY tenant_id, ${COLUMN}`,
  );
  return rows;
};

/** Serial numbers held by more than one tenant — what `down` cannot restore over. */
const findCrossTenant = async (queryInterface) => {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT ${COLUMN} AS serial, COUNT(DISTINCT tenant_id)::int AS tenants
       FROM ${TABLE}
      WHERE ${COLUMN} IS NOT NULL
      GROUP BY ${COLUMN}
     HAVING COUNT(DISTINCT tenant_id) > 1`,
  );
  return rows;
};

const duplicateError = (duplicates) => {
  const lines = duplicates
    .slice(0, REPORT_LIMIT)
    .map((d) => `  serial_number = '${d.serial}' ×${d.copies} in tenant ${d.tenant_id}`);
  if (duplicates.length > REPORT_LIMIT) {
    lines.push(`  … and ${duplicates.length - REPORT_LIMIT} more`);
  }
  return new Error(
    `Migration 0026 refused: ${duplicates.length} serial number(s) repeat within a tenant, so ` +
      "UNIQUE (tenant_id, serial_number) cannot be created — the global constraint this replaces " +
      "cannot have been present. This migration will not choose between a hospital's device " +
      "records on its own authority.\n" +
      `${lines.join("\n")}\n` +
      "Resolve each deliberately (merge the records, or correct the serial that was mistyped), " +
      "then re-run. Find them with: SELECT tenant_id, serial_number, array_agg(id ORDER BY created_at) " +
      "FROM calibration_devices WHERE serial_number IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) > 1;",
  );
};

module.exports = {
  TABLE,
  INDEX,

  up: async ({ context }) => {
    if (!(await tableNames(context)).includes(TABLE)) {
      return; // db.sync() creates it later, without the global constraint
    }

    // 1. Refuse on in-tenant duplicates — before ANY change.
    const duplicates = await findDuplicates(context);
    if (duplicates.length) {
      throw duplicateError(duplicates);
    }

    // 2. Drop the global uniqueness, whatever it is called.
    const { constraints, indexes } = await globalUniques(context);
    for (const name of constraints) {
      await context.removeConstraint(TABLE, name);
    }
    for (const name of indexes) {
      await context.removeIndex(TABLE, name);
    }

    // 3. The per-tenant constraint.
    if (!(await indexNames(context)).includes(INDEX)) {
      await context.addIndex(TABLE, ["tenant_id", COLUMN], { name: INDEX, unique: true });
    }
  },

  down: async ({ context }) => {
    if (!(await tableNames(context)).includes(TABLE)) {
      return;
    }

    // A global constraint cannot be restored over a serial number two tenants
    // now legitimately hold. Refuse, naming how many, rather than fail on a
    // bare constraint error half-way.
    const shared = await findCrossTenant(context);
    if (shared.length) {
      throw new Error(
        `Migration 0026 down refused: ${shared.length} serial number(s) are now held by more than ` +
          "one tenant, so a global unique constraint cannot be restored over them.",
      );
    }

    const names = await indexNames(context);
    if (names.includes(INDEX)) {
      await context.removeIndex(TABLE, INDEX);
    }
    if (!names.includes(GLOBAL_INDEX)) {
      await context.addIndex(TABLE, [COLUMN], { name: GLOBAL_INDEX, unique: true });
    }
  },
};
