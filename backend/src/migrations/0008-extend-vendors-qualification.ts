import type { DataTypes, QueryInterface } from "sequelize";

/** The QueryInterface Umzug passes (P9-23: the context IS the QueryInterface). */
type Context = QueryInterface & { sequelize: { Sequelize: { DataTypes: typeof DataTypes } } };

export = {
  up: async ({ context }: { context: Context }): Promise<void> => {
    const { sequelize } = context;
    const DataTypes = sequelize.Sequelize.DataTypes;

    // Idempotent: db.sync() creates the current vendor schema on a fresh DB, so
    // only add columns that are actually missing (this migration also runs as a
    // catch-up on pre-existing databases that predate these columns).
    const table = await context.describeTable("vendors");

    if (!table["approval_status"]) {
      await context.addColumn("vendors", "approval_status", {
        type: DataTypes.ENUM("APPROVED", "PENDING", "REJECTED", "CONDITIONAL"),
        defaultValue: "PENDING",
        allowNull: false,
      });
    }

    if (!table["scorecard"]) {
      await context.addColumn("vendors", "scorecard", {
        type: DataTypes.INTEGER,
        allowNull: true,
      });
    }

    if (!table["last_audit_date"]) {
      await context.addColumn("vendors", "last_audit_date", {
        type: DataTypes.DATE,
        allowNull: true,
      });
    }

    if (!table["next_audit_date"]) {
      await context.addColumn("vendors", "next_audit_date", {
        type: DataTypes.DATE,
        allowNull: true,
      });
    }
  },

  down: async ({ context }: { context: Context }): Promise<void> => {
    await context.removeColumn("vendors", "next_audit_date");
    await context.removeColumn("vendors", "last_audit_date");
    await context.removeColumn("vendors", "scorecard");
    await context.removeColumn("vendors", "approval_status");
  },
};
