"use strict";

/**
 * Every stock quantity change names its item, its before/after and a reason
 * (P6-09; ADR-PENDING-data).
 *
 * WHAT WAS WRONG
 *
 *  - `PATCH /api/v1/stocks/:stockId` could set `quantity` directly — no
 *    reason, no actor, no trace. (Fixed in stock.service: a quantity change
 *    there is refused and routed to an adjustment.)
 *  - An adjustment's `reason` was optional, so "adjustment" did not mean
 *    "explained".
 *  - `stock_adjustments` did not even record WHICH item it adjusted — only the
 *    warehouse and location — nor the quantity it moved from and to. An
 *    auditor could not reconcile a stock level against its adjustments.
 *
 * WHAT THIS DOES — one transaction
 *
 *  1. Adds `stock_id` (FK stocks, RESTRICT: an adjusted item cannot be hard
 *     deleted out from under its history), `quantity_before`,
 *     `quantity_after`. All three stay NULLABLE: rows written before this
 *     migration cannot be attributed to an item after the fact, and this
 *     migration will not guess (the 0026/0030 refuse-don't-repair rule).
 *     Every row written from now on carries them (stock.service).
 *  2. Rows with no reason (NULL or blank) get one saying so, so the
 *     constraint below holds for every row.
 *  3. `reason` becomes NOT NULL with CHECK (btrim(reason) <> '') — a blank
 *     reason is no reason (the P6-09 abuse case).
 *
 * The model declares the same columns, so a fresh db.sync() has them; the
 * CHECK exists only here. Throws, rather than skipping, when the table is
 * absent (db.sync() runs before the migrator at boot; a skip would be
 * recorded as applied with no constraint — PR-5).
 *
 * No try/catch. Verify with psql:
 *   \d stock_adjustments
 */

const TABLE = "stock_adjustments";
const CHECK_REASON = "stock_adjustments_reason_not_blank";
const LEGACY_REASON = "Not recorded (adjustment made before P6-09, 2026-09-24).";
const LOCK_TIMEOUT = "10s";

const NEW_COLUMNS = Object.freeze([
  ["stock_id", "UUID REFERENCES stocks (id) ON DELETE RESTRICT ON UPDATE CASCADE"],
  ["quantity_before", "INTEGER"],
  ["quantity_after", "INTEGER"],
]);

/** @returns {Promise<Set<string>|null>} column names, or null when the table is absent */
const columnNames = async (sequelize, transaction) => {
  const [rows] = await sequelize.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = :table`,
    { transaction, replacements: { table: TABLE } },
  );
  return rows.length ? new Set(rows.map((r) => r.column_name)) : null;
};

const constraintExists = async (sequelize, transaction, name) => {
  const [[{ present }]] = await sequelize.query(
    `SELECT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid = (current_schema() || '.' || :table)::regclass AND conname = :name) AS present`,
    { transaction, replacements: { table: TABLE, name } },
  );
  return present;
};

module.exports = {
  TABLE,
  CHECK_REASON,
  LEGACY_REASON,

  up: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      const columns = await columnNames(sequelize, transaction);
      if (!columns) {
        throw new Error(
          `0059: table ${TABLE} does not exist. Run db.sync() first (the backend does at boot); ` +
            "skipping would record this migration as applied with no reason constraint.",
        );
      }
      for (const [name, ddl] of NEW_COLUMNS) {
        if (!columns.has(name)) {
          await sequelize.query(`ALTER TABLE ${TABLE} ADD COLUMN ${name} ${ddl}`, { transaction });
        }
      }
      await sequelize.query(
        `UPDATE ${TABLE} SET reason = :reason WHERE reason IS NULL OR btrim(reason) = ''`,
        { transaction, replacements: { reason: LEGACY_REASON } },
      );
      await sequelize.query(`ALTER TABLE ${TABLE} ALTER COLUMN reason SET NOT NULL`, { transaction });
      if (!(await constraintExists(sequelize, transaction, CHECK_REASON))) {
        await sequelize.query(
          `ALTER TABLE ${TABLE} ADD CONSTRAINT ${CHECK_REASON} CHECK (btrim(reason) <> '')`,
          { transaction },
        );
      }
    });
  },

  /**
   * Drops the CHECK and the NOT NULL. The new columns and the backfilled
   * reasons stay: they are the record of which item moved, and dropping them
   * would erase it.
   */
  down: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      await sequelize.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${CHECK_REASON}`, { transaction });
      await sequelize.query(`ALTER TABLE ${TABLE} ALTER COLUMN reason DROP NOT NULL`, { transaction });
    });
  },
};
