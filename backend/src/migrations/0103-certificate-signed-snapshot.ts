/**
 * Migration 0103 — certificates.signed_snapshot (ADR-107, Q-50).
 *
 * ISO/IEC 17025 7.8: a certificate's content is fixed once issued. The issuer
 * (name, address, contact, website), the instrument and the people a signed
 * certificate prints were read from the LIVE rows, so a rename after signing
 * changed an issued certificate. From ADR-107 the sign step stores them here
 * (certificateDocument.service#captureSignedSnapshot) and the v3 hash binds
 * them.
 *
 * NO BACK-FILL, deliberately: a certificate signed before this migration was
 * never snapshot, and a snapshot made now would record today's rows as if they
 * were the rows at signing — an invented fact. Those rows stay NULL and keep
 * their v2/v1 hashes, printed and verified exactly as before.
 *
 * The column is JSONB, nullable, no default. `db.sync()` never alters an
 * existing table, so an upgraded database gets it only here; on a fresh one
 * sync() has created it from the model and every step is a no-op.
 *
 * No blanket try/catch: only "the table does not exist yet" is a reason to
 * skip; anything else propagates and the migration is NOT recorded as applied.
 * Verify with psql, not the log:  \d certificates  -- signed_snapshot jsonb
 *
 * Idempotent + reversible (down drops the column, if present — and with it any
 * snapshot taken since; a v3 certificate then no longer verifies, so a down on
 * a database that has signed with v3 is a data loss, as a down usually is).
 */
import type { ColumnsDescription, DataTypes, QueryInterface } from "sequelize";

/** The QueryInterface Umzug passes (P9-23: the context IS the QueryInterface). */
type Context = QueryInterface & { sequelize: { Sequelize: { DataTypes: typeof DataTypes } } };

const TABLE = "certificates";
const COLUMN = "signed_snapshot";

const describeOrSkip = async (queryInterface: QueryInterface): Promise<ColumnsDescription | null> => {
  try {
    return await queryInterface.describeTable(TABLE);
  } catch (err) {
    if (/no description found|does not exist/i.test((err as Error).message || "")) {
      return null; // table not present yet — db.sync() will create it whole
    }
    throw err;
  }
};

const up = async ({ context }: { context: Context }): Promise<void> => {
  const desc = await describeOrSkip(context);
  if (!desc || desc[COLUMN]) {
    return;
  }
  await context.addColumn(TABLE, COLUMN, { type: context.sequelize.Sequelize.DataTypes.JSONB, allowNull: true });
};

const down = async ({ context }: { context: Context }): Promise<void> => {
  const desc = await describeOrSkip(context);
  if (!desc?.[COLUMN]) {
    return;
  }
  await context.removeColumn(TABLE, COLUMN);
};

export = { TABLE, COLUMN, up, down };
