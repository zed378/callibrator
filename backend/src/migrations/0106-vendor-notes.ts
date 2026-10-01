/**
 * Migration 0106 — vendors.notes (Q-52, ADR-109 §6).
 *
 * `POST /vendors` and `PATCH /vendors/:vendorId` accept `notes`
 * (packages/contracts/src/vendor.ts) and vendor.service passed it on, but the
 * Vendor model had no `notes` attribute and `vendors` no column, so Sequelize
 * dropped it and the 200 said otherwise. ADR-109 §6 decided to STORE it (the
 * non-breaking choice: the contract stays as it is).
 *
 * The Vendor model uses `underscored: true`; `notes` maps to the column
 * `notes` (tests/migrations/0106-vendor-notes.test.ts holds the two equal).
 * `db.sync()` never alters an existing table, so an upgraded database gets the
 * column only here; on a FRESH database sync() has created it from the model
 * and this is a no-op.
 *
 * No blanket try/catch: only "the table does not exist yet" is a reason to
 * skip; anything else propagates and the migration is NOT recorded as applied.
 * Verify with psql, not the log:
 *   \d vendors        -- notes | text | nullable
 *
 * Idempotent + reversible (down drops exactly this column, if present).
 */
import type { ColumnsDescription, DataTypes, ModelAttributeColumnOptions, QueryInterface } from "sequelize";

/** The QueryInterface Umzug passes (P9-23: the context IS the QueryInterface). */
type Context = QueryInterface & { sequelize: { Sequelize: { DataTypes: typeof DataTypes } } };
type ColumnSpec = (dataTypes: typeof DataTypes) => ModelAttributeColumnOptions;

const TABLE = "vendors";

/** Underscored column -> its definition (the model's). */
const COLUMNS: Record<string, ColumnSpec> = {
  notes: (types) => ({ type: types.TEXT, allowNull: true }),
};

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
  if (!desc) {
    return;
  }
  const types = context.sequelize.Sequelize.DataTypes;
  for (const [column, spec] of Object.entries(COLUMNS)) {
    if (!desc[column]) {
      await context.addColumn(TABLE, column, spec(types));
    }
  }
};

const down = async ({ context }: { context: Context }): Promise<void> => {
  const desc = await describeOrSkip(context);
  if (!desc) {
    return;
  }
  for (const column of Object.keys(COLUMNS)) {
    if (desc[column]) {
      await context.removeColumn(TABLE, column);
    }
  }
};

export = { TABLE, COLUMNS, up, down };
