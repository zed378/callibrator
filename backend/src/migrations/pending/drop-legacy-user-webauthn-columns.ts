/**
 * PENDING — NOT REGISTERED. The contract step of ADR-108 Amendment 1: drop the
 * one-per-user passkey columns that migration 0104 emptied, and 0100's index
 * on one of them.
 *
 * WHEN: only after the VM deploy has run 0104 and been verified (the passkeys
 * are in `webauthn_credentials`, `SELECT count(*) FROM users WHERE
 * webauthn_credential_id IS NOT NULL` is 0, and a passkey sign-in works).
 * Until then the columns are the only way back (0104's `down` restores them).
 *
 * TO REGISTER IT, in ONE change:
 *  1. move this file to `src/migrations/NNNN-drop-legacy-user-webauthn-columns.ts`
 *     with the next free number, and add it to `config/migrator.js`;
 *  2. remove `webauthnCredentialId`, `webauthnPublicKey` and `webauthnSignCount`
 *     (NOT `webauthnEnabled`) from `models/user.model.ts` — schemaVerify refuses
 *     a boot where the model and the table disagree;
 *  3. remove them from `gdpr.service.js#AUTHENTICATORS_CLEARED`,
 *     `user.service.ts` (the safe-attribute exclusion and the admin passkey
 *     reset's update) and the tests that name them;
 *  4. run it on a copy of production-shaped data and inspect `\d users`.
 *
 * WHAT IT DOES: refuses (throws, the migration is not recorded) if any legacy
 * credential column still holds a value — 0104 has not run, or something wrote
 * the old columns since; then drops 0100's index and the three columns.
 * `users.webauthn_enabled` stays: it is the "has at least one passkey" flag.
 *
 * No try/catch (CLAUDE.md). Verify with psql, not the log:
 *   \d users   -- no webauthn_credential_id / _public_key / _sign_count;
 *              -- no users_webauthn_credential_id_unique
 *
 * `down` re-adds the three columns (empty, as 0104 left them) and 0100's index;
 * the data lives in webauthn_credentials, which this never touches.
 */
import { DataTypes, type QueryInterface } from "sequelize";

const TABLE = "users";
const COLUMNS = Object.freeze(["webauthn_credential_id", "webauthn_public_key", "webauthn_sign_count"]);
const INDEX = "users_webauthn_credential_id_unique";

const STILL_HELD_SQL =
  "SELECT count(*)::int AS n FROM users WHERE webauthn_credential_id IS NOT NULL OR webauthn_public_key IS NOT NULL";
const DROP_INDEX_SQL = `DROP INDEX IF EXISTS "${INDEX}"`;
const CREATE_INDEX_SQL =
  `CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX}" ON users (webauthn_credential_id) ` +
  "WHERE webauthn_credential_id IS NOT NULL";

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const desc = await context.describeTable(TABLE);
  const present = COLUMNS.filter((c) => desc[c] !== undefined);
  if (present.length > 0 && desc["webauthn_credential_id"] !== undefined) {
    const [rows] = (await context.sequelize.query(STILL_HELD_SQL)) as [{ n: number }[], unknown];
    const held = rows[0]?.n ?? 0;
    if (held > 0) {
      throw new Error(
        `drop-legacy-user-webauthn-columns: ${String(held)} user(s) still hold a legacy passkey column — run 0104 first`,
      );
    }
  }
  await context.sequelize.query(DROP_INDEX_SQL);
  for (const column of present) {
    await context.removeColumn(TABLE, column);
  }
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const desc = await context.describeTable(TABLE);
  if (desc["webauthn_credential_id"] === undefined) {
    await context.addColumn(TABLE, "webauthn_credential_id", { type: DataTypes.STRING(255), allowNull: true });
  }
  if (desc["webauthn_public_key"] === undefined) {
    await context.addColumn(TABLE, "webauthn_public_key", { type: DataTypes.TEXT, allowNull: true });
  }
  if (desc["webauthn_sign_count"] === undefined) {
    await context.addColumn(TABLE, "webauthn_sign_count", { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 });
  }
  await context.sequelize.query(CREATE_INDEX_SQL);
};

export = { TABLE, COLUMNS, INDEX, STILL_HELD_SQL, DROP_INDEX_SQL, CREATE_INDEX_SQL, up, down };
