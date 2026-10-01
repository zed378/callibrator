/**
 * P10-10 (ADR-098 §5) — `users_webauthn_credential_id_unique`: the passwordless
 * passkey sign-in looks an account up BY its credential id
 * (services/passkeyLogin.service.ts), which nothing queried by value before.
 *
 * UNIQUE, partial (`WHERE webauthn_credential_id IS NOT NULL`: most accounts
 * have none). Why a global unique index here is NOT a cross-tenant existence
 * oracle (CLAUDE.md, The Traps): a credential id is minted by the
 * authenticator — 16+ random bytes — and stored only from a verified
 * attestation of the account's own authenticator (webauthn.service
 * #verifyRegistration). Nobody can choose another account's credential id, so
 * there is no value an attacker could submit to learn whether it is taken.
 * And two accounts sharing one id would make the sign-in ambiguous.
 *
 * Refuses (throws) if duplicates already exist, naming the count, rather than
 * picking a winner: a duplicate means a data problem an operator must look at.
 *
 * The index lives only here, never on the model: db.sync() runs BEFORE the
 * migrations at boot and never adds an index to an existing table (D-13).
 *
 * No try/catch (CLAUDE.md). Verify with psql, not the log:
 *   \d users   -- "users_webauthn_credential_id_unique" UNIQUE, btree
 *              --   (webauthn_credential_id) WHERE webauthn_credential_id IS NOT NULL
 *
 * Idempotent + reversible.
 */
import type { QueryInterface } from "sequelize";

const INDEX = "users_webauthn_credential_id_unique";

const DUPLICATES_SQL =
  "SELECT count(*)::int AS n FROM (SELECT webauthn_credential_id FROM users " +
  "WHERE webauthn_credential_id IS NOT NULL GROUP BY webauthn_credential_id HAVING count(*) > 1) d";
const CREATE_INDEX_SQL =
  `CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX}" ON users (webauthn_credential_id) ` +
  "WHERE webauthn_credential_id IS NOT NULL";
const DROP_INDEX_SQL = `DROP INDEX IF EXISTS "${INDEX}"`;

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const [rows] = (await context.sequelize.query(DUPLICATES_SQL)) as [{ n: number }[], unknown];
  const duplicates = rows[0]?.n ?? 0;
  if (duplicates > 0) {
    throw new Error(
      `0100: ${String(duplicates)} passkey credential id(s) are held by more than one account — resolve them before migrating`,
    );
  }
  await context.sequelize.query(CREATE_INDEX_SQL);
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await context.sequelize.query(DROP_INDEX_SQL);
};

export = { INDEX, DUPLICATES_SQL, CREATE_INDEX_SQL, DROP_INDEX_SQL, up, down };
