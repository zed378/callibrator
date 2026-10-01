/**
 * certificates.verification_token — the secret the certificate's QR code
 * carries (A-293, ADR-100).
 *
 * WHAT WAS WRONG
 *
 * Certificate numbers are sequential (CERT-YYYYMMDD-<code>-NNNN) and the
 * public GET /certificates/verify/:number returned the whole certificate —
 * device name and serial number, who calibrated, approved and signed it, and
 * the document — to anyone who walked the numbers.
 *
 * WHAT THIS DOES
 *
 * Adds `verification_token` (VARCHAR(64)): 24 bytes from a CSPRNG, base64url
 * (32 characters, 192 bits), one per certificate. The public endpoint answers
 * the full verdict only with the matching token; a bare number gets the
 * minimal verdict. Stored in plaintext on purpose: the application reprints
 * the same QR code from GET /certificates/:id/document at any time, and the
 * token gates only disclosure detail that anyone who can read the row
 * already reads.
 *
 *  1. add the column, nullable;
 *  2. back-fill EVERY row that has none — soft-deleted (paranoid) rows too,
 *     since raw SQL applies no `deleted_at` filter — each with its own
 *     token, in batches of BATCH rows;
 *  3. SET NOT NULL;
 *  4. a UNIQUE index, `certificates_verification_token_unique`.
 *
 * The index is created here only, never declared on the model: db.sync()
 * runs BEFORE the migrations at boot and would try to index a column that
 * does not exist yet on an existing database (D-13, as 0093).
 *
 * The back-fill runs as the owner across every tenant, and writes nothing
 * but the new column of rows that have none.
 *
 * No try/catch: a failure propagates and the migration is not recorded as
 * applied (CLAUDE.md). A batch that updates nothing throws instead of
 * looping. Verify with psql, not the log:
 *   \d certificates   -- verification_token varchar(64) not null,
 *                     -- "certificates_verification_token_unique" UNIQUE btree
 *   SELECT count(*) FROM certificates WHERE verification_token IS NULL;  -- 0
 *
 * Idempotent + reversible.
 */
import * as crypto from "crypto";
import { DataTypes, type QueryInterface } from "sequelize";

const TABLE = "certificates";
const COLUMN = "verification_token";
const INDEX = "certificates_verification_token_unique";
const BATCH = 500;

/** 24 random bytes, base64url: 32 characters, 192 bits. Frozen here, not imported. */
const newToken = (): string => crypto.randomBytes(24).toString("base64url");

const SELECT_MISSING_SQL = `SELECT id FROM certificates WHERE verification_token IS NULL ORDER BY id LIMIT ${String(BATCH)}`;

/** One UPDATE for a batch: `(id, token)` pairs as bind parameters. */
const updateSql = (count: number): string => {
  const values = Array.from({ length: count }, (_, i) => `($${String(2 * i + 1)}::uuid, $${String(2 * i + 2)})`);
  return (
    "UPDATE certificates AS c SET verification_token = v.token " +
    `FROM (VALUES ${values.join(", ")}) AS v(id, token) ` +
    "WHERE c.id = v.id AND c.verification_token IS NULL RETURNING c.id"
  );
};

const SET_NOT_NULL_SQL = "ALTER TABLE certificates ALTER COLUMN verification_token SET NOT NULL";
const CREATE_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX}" ON certificates (verification_token)`;
const DROP_INDEX_SQL = `DROP INDEX IF EXISTS "${INDEX}"`;

const backfill = async (context: QueryInterface): Promise<number> => {
  let filled = 0;
  for (;;) {
    const [rows] = (await context.sequelize.query(SELECT_MISSING_SQL)) as [{ id: string }[], unknown];
    if (rows.length === 0) {
      return filled;
    }
    const bind = rows.flatMap((row) => [row.id, newToken()]);
    const [updated] = (await context.sequelize.query(updateSql(rows.length), { bind })) as [
      { id: string }[],
      unknown,
    ];
    if (updated.length === 0) {
      throw new Error(`0096: a back-fill batch of ${String(rows.length)} certificates updated nothing`);
    }
    filled += updated.length;
  }
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const desc = await context.describeTable(TABLE);
  if (!desc[COLUMN]) {
    await context.addColumn(TABLE, COLUMN, { type: DataTypes.STRING(64), allowNull: true });
  }
  await backfill(context);
  await context.sequelize.query(SET_NOT_NULL_SQL);
  await context.sequelize.query(CREATE_INDEX_SQL);
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await context.sequelize.query(DROP_INDEX_SQL);
  const desc = await context.describeTable(TABLE);
  if (desc[COLUMN]) {
    await context.removeColumn(TABLE, COLUMN);
  }
};

export = {
  TABLE,
  COLUMN,
  INDEX,
  BATCH,
  SELECT_MISSING_SQL,
  SET_NOT_NULL_SQL,
  CREATE_INDEX_SQL,
  DROP_INDEX_SQL,
  updateSql,
  up,
  down,
};
