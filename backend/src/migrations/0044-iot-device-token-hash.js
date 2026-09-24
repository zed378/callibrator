"use strict";

/**
 * A-29 — IoT ingest tokens are stored as a SHA-256 hash, never in plaintext.
 *
 * `calibration_devices.iot_device_token` (migration 0010) held the ingest
 * credential in plaintext, and the model's defaultScope excluded nothing, so
 * the moment a token existed it was returned in every device list and detail
 * response to everyone who could read the device register. Nothing could set
 * one (no service, validator or UI), so on the reference deployment the
 * column is empty; any value in it was written by hand in SQL.
 *
 * This migration:
 *  1. adds `iot_token_hash` VARCHAR(64) — hex SHA-256 of the token, which is
 *     what `POST /api/v1/iot/ingest` now looks up — and `iot_token_issued_at`;
 *  2. DELIBERATELY hashes every plaintext token that exists, in SQL:
 *     `encode(sha256(convert_to(token, 'UTF8')), 'hex')` is byte-for-byte
 *     what `crypto.createHash("sha256").update(token)` computes, so a device
 *     already sending that token keeps ingesting. The alternative — revoking
 *     them — would silently cut devices off, and the operator who wrote the
 *     token by hand is the one who should decide that. An EMPTY string is
 *     mapped to no token: `ingestHttp` refuses a falsy token before looking
 *     anything up, so '' authenticated nothing and still does not.
 *     A token that sat in this column was readable by every device reader in
 *     its tenant: treat it as disclosed and ROTATE it
 *     (`POST /api/v1/iot/devices/:deviceId/token`);
 *  3. re-reads, and throws if any plaintext token is not matched by its hash;
 *  4. drops `iot_device_token` (and its global unique constraint with it);
 *  5. adds a unique index on `iot_token_hash`. Global, not per tenant — and
 *     that is not the "global uniqueness is an existence oracle" trap: the
 *     value is 32 server-generated random bytes, never caller-chosen, so no
 *     caller can probe it. It makes the ingest lookup unambiguous.
 *
 * The index lives only here, not on the model (the 0024/0026 pattern):
 * db.sync() runs before migrations at boot and would try to index a column
 * that does not exist yet.
 *
 * All in one transaction. No try/catch: every failure propagates (CLAUDE.md;
 * 0008/0013/0014). Idempotent — a second run finds the old column gone and
 * the index present.
 *
 * `down` REFUSES while any device holds a hashed token: the plaintext cannot
 * be recovered, and restoring an empty `iot_device_token` would silently stop
 * every provisioned device. Revoke them first, or restore from a backup.
 *
 * Verify with psql, not the log:
 *   \d calibration_devices          -- iot_token_hash, no iot_device_token
 *   SELECT indexdef FROM pg_indexes WHERE indexname = 'calibration_devices_iot_token_hash_unique';
 */

const TABLE = "calibration_devices";
const LEGACY = "iot_device_token";
const HASH = "iot_token_hash";
const ISSUED_AT = "iot_token_issued_at";
const INDEX = "calibration_devices_iot_token_hash_unique";

/** SQL that computes, from the legacy column, what the application hashes. */
const HASH_SQL = `encode(sha256(convert_to(${LEGACY}, 'UTF8')), 'hex')`;

const tableNames = async (queryInterface, transaction) =>
  (await queryInterface.showAllTables({ transaction })).map((t) =>
    (typeof t === "object" ? t.tableName : t).toLowerCase(),
  );

const indexNames = async (queryInterface, transaction) =>
  (await queryInterface.showIndex(TABLE, { transaction })).map((index) => index.name);

const countOf = async (queryInterface, sql, transaction) => {
  const [rows] = await queryInterface.sequelize.query(sql, { transaction });
  return Number(rows[0].n);
};

module.exports = {
  TABLE,
  INDEX,
  HASH_SQL,

  up: async ({ context }) => {
    const { DataTypes } = require("sequelize");
    await context.sequelize.transaction(async (transaction) => {
      if (!(await tableNames(context, transaction)).includes(TABLE)) {
        return; // db.sync() creates it later, from the model, with no plaintext column
      }
      const columns = await context.describeTable(TABLE, { transaction });

      // 1. The new columns.
      if (!columns[HASH]) {
        await context.addColumn(
          TABLE,
          HASH,
          { type: DataTypes.STRING(64), allowNull: true },
          { transaction },
        );
      }
      if (!columns[ISSUED_AT]) {
        await context.addColumn(
          TABLE,
          ISSUED_AT,
          { type: DataTypes.DATE, allowNull: true },
          { transaction },
        );
      }

      if (columns[LEGACY]) {
        // 2. Hash every plaintext token, deliberately (see the header).
        await context.sequelize.query(
          `UPDATE ${TABLE}
              SET ${HASH} = ${HASH_SQL},
                  ${ISSUED_AT} = COALESCE(${ISSUED_AT}, updated_at)
            WHERE ${LEGACY} IS NOT NULL AND ${LEGACY} <> '' AND ${HASH} IS NULL`,
          { transaction },
        );

        // 3. Every plaintext token must now be matched by its hash.
        const unmatched = await countOf(
          context,
          `SELECT COUNT(*)::int AS n FROM ${TABLE}
            WHERE ${LEGACY} IS NOT NULL AND ${LEGACY} <> ''
              AND ${HASH} IS DISTINCT FROM ${HASH_SQL}`,
          transaction,
        );
        if (unmatched) {
          throw new Error(
            `Migration 0044 refused: ${unmatched} device(s) hold a plaintext IoT token that does not ` +
              `match ${HASH} — the row already carried a different hash. This migration will not ` +
              "choose which credential a device keeps. Inspect with: SELECT id, tenant_id FROM " +
              `${TABLE} WHERE ${LEGACY} IS NOT NULL AND ${LEGACY} <> '' AND ${HASH} IS DISTINCT FROM ` +
              `${HASH_SQL};`,
          );
        }

        // 4. The plaintext goes, with its global unique constraint.
        await context.removeColumn(TABLE, LEGACY, { transaction });
      }

      // 5. One device per token.
      if (!(await indexNames(context, transaction)).includes(INDEX)) {
        await context.addIndex(TABLE, [HASH], { name: INDEX, unique: true, transaction });
      }
    });
  },

  down: async ({ context }) => {
    const { DataTypes } = require("sequelize");
    await context.sequelize.transaction(async (transaction) => {
      if (!(await tableNames(context, transaction)).includes(TABLE)) {
        return;
      }
      const columns = await context.describeTable(TABLE, { transaction });

      if (columns[HASH]) {
        const provisioned = await countOf(
          context,
          `SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE ${HASH} IS NOT NULL`,
          transaction,
        );
        if (provisioned) {
          throw new Error(
            `Migration 0044 down refused: ${provisioned} device(s) hold a hashed IoT ingest token. ` +
              "The plaintext cannot be recovered, so rolling back would silently cut those devices " +
              "off. Revoke them first (DELETE /api/v1/iot/devices/:deviceId/token), or restore from backup.",
          );
        }
      }

      if ((await indexNames(context, transaction)).includes(INDEX)) {
        await context.removeIndex(TABLE, INDEX, { transaction });
      }
      if (columns[HASH]) {
        await context.removeColumn(TABLE, HASH, { transaction });
      }
      if (columns[ISSUED_AT]) {
        await context.removeColumn(TABLE, ISSUED_AT, { transaction });
      }
      if (!columns[LEGACY]) {
        await context.addColumn(
          TABLE,
          LEGACY,
          { type: DataTypes.STRING(255), allowNull: true, unique: true },
          { transaction },
        );
      }
    });
  },
};
