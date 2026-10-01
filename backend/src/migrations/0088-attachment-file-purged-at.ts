/**
 * Adds `attachments.file_purged_at` (D-22, ADR-083).
 *
 * WHAT WAS WRONG
 *
 * A parent's soft delete soft-deletes its attachments and keeps their files
 * (ADR-070), so a restore of the parent can bring them back. Nothing removed
 * those files afterwards: every cascaded file stayed on disk for good,
 * unreachable and uncounted.
 *
 * WHAT THIS DOES
 *
 * One nullable TIMESTAMPTZ, no default, no backfill, no index. The daily
 * deleted-file sweep (services/attachmentFileSweep.service.js) sets it when it
 * has removed a deleted row's bytes — or confirmed they were already gone —
 * and selects only rows where it is NULL, so a row is swept once. NULL on every
 * existing row is correct: none has been swept. No index: the sweep's read is
 * per tenant (`attachments.tenant_id` is indexed) and bounded.
 *
 * On a FRESH database `db.sync()` has already created the column from the
 * model; `up` then does nothing.
 *
 * No try/catch at all (D-14): boot runs db.sync() before the migrator, so
 * `attachments` exists, and any failure must fail the migration rather than be
 * recorded as applied. Verify with psql, not the log:
 *   \d attachments   -- file_purged_at timestamp with time zone
 *
 * `down` drops the column. The sweep's audit rows (`operation: "file-purge"`)
 * still say which files were removed; a sweep run after a `down` would find
 * those rows again and record them `absent`.
 */
import type { DataTypes as SequelizeDataTypes, ModelAttributeColumnOptions, QueryInterface } from "sequelize";

/** The QueryInterface Umzug passes (P9-23: the context IS the QueryInterface). */
type Context = QueryInterface & { sequelize: { Sequelize: { DataTypes: typeof SequelizeDataTypes } } };

const TABLE = "attachments";
const COLUMN = "file_purged_at";

/** @param {object} DataTypes */
const columnSpec = (DataTypes: typeof SequelizeDataTypes): ModelAttributeColumnOptions => ({
  type: DataTypes.DATE,
  allowNull: true,
  defaultValue: null,
});

export = {
  TABLE,
  COLUMN,
  columnSpec,

  up: async ({ context }: { context: Context }): Promise<void> => {
    const desc = await context.describeTable(TABLE);
    if (!desc[COLUMN]) {
      await context.addColumn(TABLE, COLUMN, columnSpec(context.sequelize.Sequelize.DataTypes));
    }
  },

  down: async ({ context }: { context: Context }): Promise<void> => {
    const desc = await context.describeTable(TABLE);
    if (!desc[COLUMN]) {
      return;
    }
    await context.removeColumn(TABLE, COLUMN);
  },
};
