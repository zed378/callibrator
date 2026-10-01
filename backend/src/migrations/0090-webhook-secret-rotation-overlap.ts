import type { DataTypes as SequelizeDataTypes, ModelAttributeColumnOptions, QueryInterface } from "sequelize";

/** The QueryInterface Umzug passes (P9-23: the context IS the QueryInterface). */
type Context = QueryInterface & { sequelize: { Sequelize: { DataTypes: typeof SequelizeDataTypes } } };

/**
 * Adds `webhooks.previous_secret` and `webhooks.previous_secret_expires_at`
 * (P6-13, ADR-085).
 *
 * WHAT WAS WRONG
 *
 * `POST /webhooks/:id/rotate-secret` (A-51) invalidated the old secret at the
 * instant it issued the new one. A receiver had to be reconfigured before the
 * next event, or it refused deliveries until it was: every rotation was a
 * coordinated cut-over, and a rotation after a suspected leak was an outage.
 *
 * WHAT THIS DOES
 *
 * Two nullable columns, no default, no backfill, no index:
 *
 *   previous_secret             TEXT         the secret a rotation replaced, as
 *                                            the same kms.service envelope
 *                                            (`v1:`/`v2:`, tenant id as AAD) the
 *                                            `secret` column holds — never
 *                                            plaintext
 *   previous_secret_expires_at  TIMESTAMPTZ  when that secret stops signing
 *
 * While `previous_secret_expires_at` is in the future, a delivery carries a
 * second signature under the previous secret (`X-Webhook-Signature-Previous`),
 * so a receiver that accepts either header survives the rotation without
 * coordination. NULL on every existing row is correct: none is mid-rotation.
 * No index: both are read only with the row the delivery already loads.
 *
 * On a FRESH database `db.sync()` has already created both columns from the
 * model; `up` then does nothing.
 *
 * No try/catch (D-14): boot runs db.sync() before the migrator, so `webhooks`
 * exists, and any failure must fail the migration rather than be recorded as
 * applied. Verify with psql, not the log:
 *   \d webhooks   -- previous_secret text, previous_secret_expires_at timestamptz
 *
 * `down` drops both columns: every rotation in progress ends at once, which is
 * exactly the pre-P6-13 behaviour.
 */
const TABLE = "webhooks";

/** @param {object} DataTypes */
const columns = (DataTypes: typeof SequelizeDataTypes): Record<string, ModelAttributeColumnOptions> => ({
  previous_secret: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
  previous_secret_expires_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
});

export = {
  TABLE,
  columns,

  up: async ({ context }: { context: Context }): Promise<void> => {
    const desc = await context.describeTable(TABLE);
    const specs = columns(context.sequelize.Sequelize.DataTypes);
    for (const [name, spec] of Object.entries(specs)) {
      if (!desc[name]) {
        await context.addColumn(TABLE, name, spec);
      }
    }
  },

  down: async ({ context }: { context: Context }): Promise<void> => {
    const desc = await context.describeTable(TABLE);
    for (const name of Object.keys(columns(context.sequelize.Sequelize.DataTypes))) {
      if (desc[name]) {
        await context.removeColumn(TABLE, name);
      }
    }
  },
};
