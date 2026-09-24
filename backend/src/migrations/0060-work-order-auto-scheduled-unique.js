"use strict";

/**
 * One open auto-scheduled calibration work order per device (W-03,
 * ADR-PENDING-async).
 *
 * WHAT WAS WRONG
 *
 * The calibration scan's idempotency guard was a read ("does this device have
 * an open Preventative work order?") followed by three writes — the work
 * order, a tenant-wide notification and a webhook. Nothing made the pair
 * atomic, so two scans in the same minute (two replicas, or the cron and a
 * manual POST /calibration-scheduler/run) both read "none" and both wrote:
 * two work orders, every user of the hospital notified twice, the tenant's
 * webhook called twice.
 *
 * WHAT THIS DOES — one transaction
 *
 *  1. Adds `auto_scheduled BOOLEAN NOT NULL DEFAULT false`: true only on a
 *     work order the scan created.
 *  2. Adds the partial unique index
 *       UNIQUE (device_id) WHERE auto_scheduled
 *                            AND status IN ('Open','InProgress')
 *                            AND deleted_at IS NULL
 *     so the database, not the process topology, holds the invariant. The
 *     losing scan's INSERT fails, maintenance.service maps that to 409, and
 *     the scan counts a skip before it notifies or calls a webhook.
 *
 * WHY NOT UNIQUE ON EVERY OPEN PREVENTATIVE ORDER (the card's first
 * suggestion). A person may legitimately open a second Preventative order on
 * a device (cleaning, an electrical-safety test) while a calibration order is
 * open; constraining those would turn an ordinary API create into a 409. The
 * scan still SKIPS a device with any open Preventative order (its read guard
 * is unchanged); the index only closes the race between two scans.
 *
 * NO BACKFILL. Existing rows stay `false`: which of them the scan created is
 * only guessable from free text, and a guess that marked two open rows for one
 * device would make this index fail to build. Because every existing row is
 * `false`, the index cannot find a duplicate when it is built.
 *
 * The model declares the column (so a fresh db.sync() has it); the index
 * exists only here. Throws, rather than skipping, when the table is absent
 * (a skip would be recorded as applied with no constraint — PR-5).
 *
 * No try/catch. Verify with psql:
 *   \d maintenance_work_orders
 */

const TABLE = "maintenance_work_orders";
const COLUMN = "auto_scheduled";
const INDEX = "maintenance_work_orders_one_open_auto_per_device";
const LOCK_TIMEOUT = "10s";

const INDEX_DDL =
  `CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX} ON ${TABLE} (device_id) ` +
  `WHERE ${COLUMN} AND status IN ('Open', 'InProgress') AND deleted_at IS NULL`;

/** @returns {Promise<Set<string>|null>} column names, or null when the table is absent */
const columnNames = async (sequelize, transaction) => {
  const [rows] = await sequelize.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = :table`,
    { transaction, replacements: { table: TABLE } },
  );
  return rows.length ? new Set(rows.map((r) => r.column_name)) : null;
};

module.exports = {
  TABLE,
  COLUMN,
  INDEX,
  INDEX_DDL,

  up: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      const columns = await columnNames(sequelize, transaction);
      if (!columns) {
        throw new Error(
          `0060: table ${TABLE} does not exist. Run db.sync() first (the backend does at boot); ` +
            "skipping would record this migration as applied with no uniqueness constraint.",
        );
      }
      if (!columns.has(COLUMN)) {
        await sequelize.query(
          `ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} BOOLEAN NOT NULL DEFAULT false`,
          { transaction },
        );
      }
      await sequelize.query(INDEX_DDL, { transaction });
    });
  },

  /**
   * Drops the index. The column stays: it records which work orders the scan
   * created, and the model still declares it.
   */
  down: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS ${INDEX}`, { transaction });
    });
  },
};
