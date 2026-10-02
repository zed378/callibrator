/**
 * Migration 0108 — tenant_backups.name and .description (A-363).
 *
 * `POST /tenants/:tenantId/backups` requires `name` and accepts `description`
 * (packages/contracts/src/tenantBackup.ts), and TenantBackup.createBackup
 * passed both to `create`, but the model had neither attribute and the table
 * neither column: Sequelize dropped them on insert, the 201 said otherwise, and
 * the backup page listed every backup with a blank name (and used that blank
 * name as the Restore confirmation phrase). A backup record of a hospital
 * tenant is an operational record; what the operator called it is stored.
 *
 * Both columns are NULLABLE: every row written before this migration has
 * neither, and nothing can recover them. The model maps `name` / `description`
 * to the same names (`underscored: true` changes nothing for one word);
 * tests/migrations/0108-tenant-backup-name-description.test.ts holds the two
 * equal. `db.sync()` never alters an existing table, so an upgraded database
 * gets the columns only here; on a FRESH database sync() has created them from
 * the model and this is a no-op. No index (ADR-100 Am. 3: none is needed, and
 * a model index on a column a migration adds would break the upgrade boot).
 *
 * No blanket try/catch: only "the table does not exist yet" is a reason to
 * skip; anything else propagates and the migration is NOT recorded as applied.
 * Verify with psql, not the log:
 *   \d tenant_backups   -- name varchar(100) | description varchar(500), nullable
 *
 * Idempotent + reversible (down drops exactly these columns, if present).
 */
import type { ColumnsDescription, DataTypes, ModelAttributeColumnOptions, QueryInterface } from "sequelize";

/** The QueryInterface Umzug passes (P9-23: the context IS the QueryInterface). */
type Context = QueryInterface & { sequelize: { Sequelize: { DataTypes: typeof DataTypes } } };
type ColumnSpec = (dataTypes: typeof DataTypes) => ModelAttributeColumnOptions;

const TABLE = "tenant_backups";

/** Column -> its definition (the model's). */
const COLUMNS: Record<string, ColumnSpec> = {
  name: (types) => ({ type: types.STRING(100), allowNull: true }),
  description: (types) => ({ type: types.STRING(500), allowNull: true }),
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
