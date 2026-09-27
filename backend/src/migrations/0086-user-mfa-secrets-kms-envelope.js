"use strict";

/**
 * TOTP seeds move from plaintext to KMS envelopes (S-20; ADR-080).
 *
 * WHAT WAS WRONG
 *
 * `users.mfa_secret` (the live second factor) and `users.mfa_pending_secret`
 * (one being enrolled, A-114) held the base32 seed in the clear. A database
 * dump — `make backup` writes one, unencrypted — handed out every account's
 * second factor. Every other stored secret already used kms.service.
 *
 * WHAT THIS DOES — one transaction, every row verified
 *
 * 1. Both columns become TEXT (they were VARCHAR(255); an envelope is ~200
 *    characters and must not be one long seed away from "value too long").
 * 2. Each plaintext seed is sealed as a v2 envelope under the CURRENT KMS
 *    master key, with the user id as AAD (mfa.service#secretAad), written
 *    with an optimistic predicate, re-read and decrypted again to prove it
 *    holds the same seed (services/keyRotation.service.js#rewrapTarget).
 *    Soft-deleted users included. An envelope under a previous key is
 *    re-wrapped on the way.
 *
 * It REFUSES rather than guesses: a value that is not a base32 seed of at
 * least 16 characters, or an envelope the configured key ring cannot open,
 * fails the migration naming the user id and column (never the value), and
 * the transaction leaves every row and both column types as they were.
 *
 * Idempotent: the type change is skipped when the column is already TEXT, and
 * a re-run finds only envelopes under the current key — nothing to do. On a
 * fresh database `db.sync()` has built both columns as TEXT from the model and
 * there are no rows.
 *
 * `down` turns every envelope back into the plaintext seed (the pre-0086 code
 * reads nothing else — an envelope would read as a wrong seed and lock every
 * MFA account out) and restores VARCHAR(255). It needs the KMS key the rows
 * are under and refuses, changing nothing, when a row does not open.
 *
 * No try/catch around the work. Verify with psql:
 *   SELECT count(*) FILTER (WHERE mfa_secret LIKE 'v2:%') AS sealed,
 *          count(*) FILTER (WHERE mfa_secret IS NOT NULL AND mfa_secret NOT LIKE 'v2:%') AS plaintext
 *     FROM users;   -- and the same for mfa_pending_secret
 */

const kms = require("../services/kms.service");
const { secretAad } = require("../services/mfa.service");
const { rewrapTarget, TARGETS } = require("../services/keyRotation.service");

const TABLE = "users";
const COLUMNS = Object.freeze(["mfa_secret", "mfa_pending_secret"]);
const LEGACY_LENGTH = 255;

/**
 * @param {object} sequelize
 * @returns {Promise<Object<string, string>>} column -> data_type, for the
 *   COLUMNS that exist (an empty object when the table does not)
 */
const columnTypes = async (sequelize) => {
  const rows = await sequelize.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = :table AND column_name IN (:columns)`,
    { type: "SELECT", replacements: { table: TABLE, columns: [...COLUMNS] } },
  );
  return Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
};

module.exports = {
  TABLE,
  COLUMNS,

  up: async ({ context }) => {
    const { sequelize } = context;
    const types = await columnTypes(sequelize);
    const missing = COLUMNS.filter((c) => !types[c]);
    if (missing.length === COLUMNS.length) {
      // No users table (or no MFA columns): db.sync() builds them from the
      // model, as TEXT, and a new seed is written sealed.
      return;
    }
    if (missing.length) {
      throw new Error(`0086: users has no ${missing.join(", ")} — run the earlier migrations (0004, 0028) first.`);
    }

    await sequelize.transaction(async () => {
      for (const column of COLUMNS) {
        if (types[column] !== "text") {
          await sequelize.query(`ALTER TABLE ${TABLE} ALTER COLUMN ${column} TYPE TEXT`);
        }
      }
      const failures = [];
      let skipped = 0;
      for (const column of COLUMNS) {
        const target = TARGETS.find((t) => t.table === TABLE && t.column === column);
        const report = await rewrapTarget({ sequelize, target });
        failures.push(...report.failed.map((f) => `${column} of user ${f.id}: ${f.error}`));
        skipped += report.skipped;
      }
      if (failures.length) {
        throw new Error(
          `0086: ${failures.length} MFA seed(s) could not be sealed (nothing was changed):\n  ` +
            `${failures.join("\n  ")}\n` +
            "A value that is not a base32 seed is not guessed at: clear that user's MFA " +
            "(POST /api/v1/users/:userId/mfa/reset, or scripts/breakGlassMfaReset.js) and restart. " +
            "An envelope that does not open needs the KMS_MASTER_KEY(_PREVIOUS) it was written under.",
        );
      }
      if (skipped) {
        throw new Error(`0086: ${skipped} row(s) changed while being sealed; restart to retry.`);
      }
    });
  },

  down: async ({ context }) => {
    const { sequelize } = context;
    const types = await columnTypes(sequelize);
    const present = COLUMNS.filter((c) => types[c]);
    if (!present.length) {
      return;
    }
    await sequelize.transaction(async () => {
      for (const column of present) {
        const rows = await sequelize.query(
          `SELECT id::text AS id, ${column} AS value FROM ${TABLE}
            WHERE ${column} LIKE 'v1:%' OR ${column} LIKE 'v2:%'`,
          { type: "SELECT" },
        );
        for (const row of rows) {
          // Throws on a row the ring cannot open; the transaction undoes the rest.
          const seed = kms.decryptData(secretAad(row.id), row.value);
          await sequelize.query(`UPDATE ${TABLE} SET ${column} = :seed WHERE id::text = :id AND ${column} = :value`, {
            replacements: { seed, id: row.id, value: row.value },
          });
        }
        const [[{ longest }]] = await sequelize.query(
          `SELECT COALESCE(max(length(${column})), 0) AS longest FROM ${TABLE}`,
        );
        if (Number(longest) > LEGACY_LENGTH) {
          throw new Error(
            `0086 down refused: users.${column} holds a value of ${longest} characters, ` +
              `longer than the VARCHAR(${LEGACY_LENGTH}) the earlier schema has (nothing was changed).`,
          );
        }
        await sequelize.query(`ALTER TABLE ${TABLE} ALTER COLUMN ${column} TYPE VARCHAR(${LEGACY_LENGTH})`);
      }
    });
  },
};
