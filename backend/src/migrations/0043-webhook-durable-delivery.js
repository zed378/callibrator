"use strict";

/**
 * `webhook_deliveries.next_attempt_at` — durable webhook delivery (A-10, ADR-054).
 *
 * WHAT WAS WRONG
 *
 * Retries lived in a `setTimeout` loop inside the process that emitted the
 * event: 1-2-4-8 s of backoff, ~15 s (about 55 s with timeouts) end to end. A
 * restart dropped every pending retry and left its row `pending` or `failed`
 * forever, with nothing that would ever look at it again.
 *
 * WHAT THIS DOES — one transaction
 *
 * 1. Adds `next_attempt_at TIMESTAMPTZ NULL`: when a pending|failed delivery is
 *    next due. The dispatcher (webhook.service#claim) selects on it.
 * 2. Hands the rows the old loop left behind to the new dispatcher — honestly:
 *      pending|failed, next_attempt_at NULL, created in the last 24 h
 *                                 -> next_attempt_at = now()   (resumed)
 *      pending|failed, next_attempt_at NULL, older
 *                                 -> status 'exhausted', and last_error says why
 *    A day-old event is not delivered late by surprise; it is dead-lettered,
 *    with the reason on the row, where the deliveries list shows it.
 * 3. Adds the partial index `webhook_deliveries_due` on (next_attempt_at)
 *    WHERE status IN ('pending','failed') — the claim query's access path; it
 *    stays small because finished rows (the bulk of the table) are not in it.
 *
 * `webhook_deliveries` MUST exist (the backend runs `db.sync()` before the
 * migrator). Against an empty database this THROWS instead of skipping: a skip
 * would be recorded as applied without the column (the 0008/0013/0014 failure).
 *
 * IDEMPOTENT: every step checks the catalog first; step 2 only touches rows
 * whose next_attempt_at is NULL and whose status is still pending|failed, so a
 * second run changes nothing. On a database created by `db.sync()` after this
 * change, the column already exists (the model declares it) and only the
 * index is added.
 *
 * REVERSIBLE, with one loss: `down` drops the index and the column. The rows
 * step 2 dead-lettered stay `exhausted` — the old code could never have
 * retried them either.
 *
 * No try/catch: every failure propagates (CLAUDE.md). Verify with psql:
 *   \d webhook_deliveries
 *   SELECT status, count(*), min(next_attempt_at) FROM webhook_deliveries GROUP BY 1;
 */

const TABLE = "webhook_deliveries";
const COLUMN = "next_attempt_at";
const INDEX = "webhook_deliveries_due";
const RESUME_WINDOW = "24 hours";
const ABANDONED_NOTE = "0043: retry schedule lost before durable delivery; not resumed (older than 24 h)";
const LOCK_TIMEOUT = "10s";

const one = async (sequelize, transaction, sql, replacements = {}) => {
  const [rows] = await sequelize.query(sql, { transaction, replacements });
  return rows[0];
};

const tablePresent = async (sequelize, transaction) =>
  (await one(
    sequelize,
    transaction,
    "SELECT to_regclass(current_schema() || '.' || :table) IS NOT NULL AS present",
    { table: TABLE },
  )).present;

const columnPresent = async (sequelize, transaction) =>
  (await one(
    sequelize,
    transaction,
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column`,
    { table: TABLE, column: COLUMN },
  )).n > 0;

const indexPresent = async (sequelize, transaction) =>
  (await one(
    sequelize,
    transaction,
    "SELECT to_regclass(current_schema() || '.' || :index) IS NOT NULL AS present",
    { index: INDEX },
  )).present;

module.exports = {
  TABLE,
  COLUMN,
  INDEX,
  ABANDONED_NOTE,

  up: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      if (!(await tablePresent(sequelize, transaction))) {
        throw new Error(
          `0043: table "${TABLE}" does not exist. Run db.sync() first (the backend does at boot); ` +
            "skipping would record this migration as applied without its column.",
        );
      }
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });

      // 1. The column.
      if (!(await columnPresent(sequelize, transaction))) {
        await sequelize.query(`ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} TIMESTAMPTZ NULL`, {
          transaction,
        });
      }

      // 2. The rows the in-process loop abandoned: recent ones resume, old
      //    ones are dead-lettered with the reason.
      await sequelize.query(
        `UPDATE ${TABLE} SET ${COLUMN} = now()
          WHERE ${COLUMN} IS NULL AND status IN ('pending', 'failed')
            AND created_at >= now() - interval '${RESUME_WINDOW}'`,
        { transaction },
      );
      await sequelize.query(
        `UPDATE ${TABLE}
            SET status = 'exhausted',
                last_error = CASE WHEN last_error IS NULL THEN :note
                                  ELSE last_error || ' | ' || :note END,
                updated_at = now()
          WHERE ${COLUMN} IS NULL AND status IN ('pending', 'failed')`,
        { transaction, replacements: { note: ABANDONED_NOTE } },
      );

      // 3. The claim query's index.
      if (!(await indexPresent(sequelize, transaction))) {
        await sequelize.query(
          `CREATE INDEX ${INDEX} ON ${TABLE} (${COLUMN}) WHERE status IN ('pending', 'failed')`,
          { transaction },
        );
      }
    });
  },

  down: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      if (!(await tablePresent(sequelize, transaction))) {
        return; // nothing was ever added
      }
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS ${INDEX}`, { transaction });
      await sequelize.query(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS ${COLUMN}`, { transaction });
    });
  },
};
