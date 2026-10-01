/**
 * ADR-108 Amendment 1 — `webauthn_credentials`: several passkeys per user.
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. the table unless it exists (db.sync() creates it from the model first on
 *     a database that has never seen it): user_id → users ON DELETE CASCADE,
 *     credential_id UNIQUE, public_key, sign_count, name, transports, last_used_at;
 *  2. `webauthn_credentials_user_id` (D-20: the foreign key's leading index);
 *  3. moves every passkey enrolled the old way (one per user, on `users`) into
 *     it, named "Passkey", keeping its sign count — a credential already there
 *     (a re-run) is skipped, never duplicated;
 *  4. clears the moved `users.webauthn_credential_id / _public_key /
 *     _sign_count` (`webauthn_enabled` stays: it is the derived "has at least
 *     one passkey" flag). The columns themselves are dropped in a later
 *     contract step, once no code reads them
 *     (migrations/pending/drop-legacy-user-webauthn-columns.ts).
 *
 * A HALF-ENROLLED legacy credential — a credential id with no public key — is
 * NOT moved: without a key it cannot verify a signature, so it could never
 * sign anyone in. It is cleared with the rest (ADR-108 Amendment 1, decided
 * 2026-09-30). Not silently: the migration logs HOW MANY were dropped (a
 * count only — no user or credential id reaches the log).
 *
 * A credential id is globally unique by construction (the authenticator mints
 * it from 16+ random bytes; it is stored only from a verified attestation), so
 * the unique index is not a cross-tenant existence oracle — see 0100.
 *
 * No try/catch (CLAUDE.md). Verify with psql, not the log:
 *   \d webauthn_credentials
 *   SELECT count(*) FROM users WHERE webauthn_credential_id IS NOT NULL;   -- 0
 *
 * Idempotent. `down` moves each user's OLDEST credential back to `users` and
 * drops the table (a user with several keeps one — the rest are lost; stated).
 */
import { DataTypes, type QueryInterface, type Transaction } from "sequelize";
import { logger } from "../middlewares/activityLog.middleware";

const TABLE = "webauthn_credentials";
const INDEX_USER = "webauthn_credentials_user_id";

const INDEX_SQL = `CREATE INDEX IF NOT EXISTS ${INDEX_USER} ON ${TABLE} (user_id)`;

const BACKFILL_SQL =
  `INSERT INTO ${TABLE} (id, user_id, credential_id, public_key, sign_count, name, created_at, updated_at) ` +
  "SELECT gen_random_uuid(), u.id, u.webauthn_credential_id, u.webauthn_public_key, COALESCE(u.webauthn_sign_count, 0), " +
  "'Passkey', now(), now() FROM users u " +
  "WHERE u.webauthn_credential_id IS NOT NULL AND u.webauthn_public_key IS NOT NULL " +
  `AND NOT EXISTS (SELECT 1 FROM ${TABLE} c WHERE c.credential_id = u.webauthn_credential_id)`;

/** Legacy credentials the backfill cannot move: an id without a public key. */
const UNUSABLE_SQL =
  "SELECT count(*)::int AS n FROM users WHERE webauthn_credential_id IS NOT NULL AND webauthn_public_key IS NULL";

const CLEAR_SQL =
  "UPDATE users SET webauthn_credential_id = NULL, webauthn_public_key = NULL, webauthn_sign_count = 0 " +
  "WHERE webauthn_credential_id IS NOT NULL";

const RESTORE_SQL =
  "UPDATE users u SET webauthn_credential_id = c.credential_id, webauthn_public_key = c.public_key, " +
  "webauthn_sign_count = c.sign_count, webauthn_enabled = true " +
  `FROM (SELECT DISTINCT ON (user_id) user_id, credential_id, public_key, sign_count FROM ${TABLE} ` +
  "ORDER BY user_id, created_at) c WHERE u.id = c.user_id";

const tableExists = async (context: QueryInterface, transaction: Transaction): Promise<boolean> => {
  const [rows] = (await context.sequelize.query(`SELECT to_regclass('${TABLE}') IS NOT NULL AS present`, {
    transaction,
  })) as [{ present: boolean }[], unknown];
  return rows[0]?.present === true;
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await context.sequelize.transaction(async (transaction) => {
    if (!(await tableExists(context, transaction))) {
      await context.createTable(
        TABLE,
        {
          id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
          user_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: "users", key: "id" },
            onDelete: "CASCADE",
          },
          credential_id: { type: DataTypes.STRING(512), allowNull: false, unique: true },
          public_key: { type: DataTypes.TEXT, allowNull: false },
          sign_count: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
          name: { type: DataTypes.STRING(64), allowNull: false },
          transports: { type: DataTypes.JSONB, allowNull: true },
          last_used_at: { type: DataTypes.DATE, allowNull: true },
          created_at: { type: DataTypes.DATE, allowNull: false },
          updated_at: { type: DataTypes.DATE, allowNull: false },
        },
        { transaction },
      );
    }
    await context.sequelize.query(INDEX_SQL, { transaction });
    await context.sequelize.query(BACKFILL_SQL, { transaction });
    const [unusable] = (await context.sequelize.query(UNUSABLE_SQL, { transaction })) as [{ n: number }[], unknown];
    const dropped = unusable[0]?.n ?? 0;
    if (dropped > 0) {
      logger.warn(
        `0104: ${String(dropped)} legacy passkey credential(s) had no public key and were dropped, not moved ` +
          "(an unusable credential cannot sign anyone in; ADR-108 Amendment 1)",
      );
    }
    await context.sequelize.query(CLEAR_SQL, { transaction });
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await context.sequelize.transaction(async (transaction) => {
    if (await tableExists(context, transaction)) {
      await context.sequelize.query(RESTORE_SQL, { transaction });
    }
    await context.sequelize.query(`DROP TABLE IF EXISTS ${TABLE}`, { transaction });
  });
};

export = { TABLE, INDEX_USER, INDEX_SQL, BACKFILL_SQL, UNUSABLE_SQL, CLEAR_SQL, RESTORE_SQL, up, down };
