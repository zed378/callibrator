/**
 * Adds tenants.parent_id (self-referential FK) to support tenant hierarchy /
 * sub-organizations. The tenant_hierarchies table itself is created by the
 * model-driven db.sync(); this migration only handles the column addition to
 * the pre-existing tenants table (which sync will not alter).
 *
 * Idempotent + reversible.
 */
import type { DataTypes, QueryInterface } from "sequelize";

/** The QueryInterface Umzug passes (P9-23: the context IS the QueryInterface). */
type Context = QueryInterface & { sequelize: { Sequelize: { DataTypes: typeof DataTypes } } };

const TABLE = "tenants";
const COLUMN = "parent_id";

export = {
  up: async ({ context }: { context: Context }): Promise<void> => {
    // D-14: no catch. db.sync() runs before migrations, so the table exists;
    // the only error a catch here could swallow is a real one.
    const desc = await context.describeTable(TABLE);
    const DataTypes = context.sequelize.Sequelize.DataTypes;

    if (!desc[COLUMN]) {
      await context.addColumn(TABLE, COLUMN, {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: TABLE, key: "id" },
        onDelete: "SET NULL",
      });
    }
  },

  down: async ({ context }: { context: Context }): Promise<void> => {
    // D-14: no catch. db.sync() runs before migrations, so the table exists;
    // the only error a catch here could swallow is a real one.
    const desc = await context.describeTable(TABLE);
    if (desc[COLUMN]) {
      await context.removeColumn(TABLE, COLUMN);
    }
  },
};
