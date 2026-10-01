/**
 * Migration 0102 — the tenant profile columns (A-303).
 *
 * `PATCH /tenants/edit` and `POST /tenants/create` accepted a description,
 * phone, address, city, state (province), zip code, country and website, and
 * tenant.service wrote them — but they were attributes of no model and columns
 * of no table, so Sequelize dropped every one and the 200 said otherwise.
 * ISO/IEC 17025 7.8.2 puts the issuing laboratory's name and address on every
 * certificate, so a tenant must be able to store them
 * (certificateDocument.service `issuer`).
 *
 * The Tenant model uses `underscored: true`; each attribute maps to the
 * snake_case column named here (tests/migrations/0102-*.test.ts holds the two
 * equal). `db.sync()` never alters an existing table, so an upgraded database
 * gets the columns only here; on a FRESH database sync() has created them from
 * the model already and every step below is a no-op.
 *
 * No blanket try/catch: only "the table does not exist yet" is a reason to
 * skip; anything else propagates and the migration is NOT recorded as applied
 * (CLAUDE.md, the 0008/0013/0014 lesson). Verify with psql, not the log:
 *   \d tenants        -- description, phone, address, city, state, zip_code, country, website
 *
 * Idempotent + reversible (down drops exactly these columns, if present).
 */
import type { ColumnsDescription, DataTypes, ModelAttributeColumnOptions, QueryInterface } from "sequelize";

/** The QueryInterface Umzug passes (P9-23: the context IS the QueryInterface). */
type Context = QueryInterface & { sequelize: { Sequelize: { DataTypes: typeof DataTypes } } };
type ColumnSpec = (dataTypes: typeof DataTypes) => ModelAttributeColumnOptions;

const TABLE = "tenants";

/** Underscored column -> its definition (the model's, attribute for attribute). */
const COLUMNS: Record<string, ColumnSpec> = {
  description: (types) => ({ type: types.TEXT, allowNull: true }),
  phone: (types) => ({ type: types.STRING(50), allowNull: true }),
  address: (types) => ({ type: types.TEXT, allowNull: true }),
  city: (types) => ({ type: types.STRING(100), allowNull: true }),
  state: (types) => ({ type: types.STRING(100), allowNull: true }),
  zip_code: (types) => ({ type: types.STRING(20), allowNull: true }),
  country: (types) => ({ type: types.STRING(100), allowNull: true }),
  website: (types) => ({ type: types.STRING(255), allowNull: true }),
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
