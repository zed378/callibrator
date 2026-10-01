import type { DataTypes, QueryInterface } from "sequelize";

/** The QueryInterface Umzug passes (P9-23: the context IS the QueryInterface). */
type Context = QueryInterface & { sequelize: { Sequelize: { DataTypes: typeof DataTypes } } };

const TABLE = "batch_jobs";

export = {
  up: async ({ context }: { context: Context }): Promise<void> => {
    try {
      await context.describeTable(TABLE);
    } catch {
      // Create table if it doesn't exist
      const DataTypes = context.sequelize.Sequelize.DataTypes;
      await context.createTable(TABLE, {
        id: {
          type: DataTypes.UUID,
          primaryKey: true,
        },
        tenant_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: "tenants", key: "id" },
          onDelete: "CASCADE",
        },
        user_id: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: "users", key: "id" },
          onDelete: "SET NULL",
        },
        type: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        status: {
          type: DataTypes.ENUM("PENDING", "PROCESSING", "COMPLETED", "FAILED"),
          allowNull: false,
          defaultValue: "PENDING",
        },
        progress: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        total_items: {
          type: DataTypes.INTEGER,
          defaultValue: 0,
        },
        processed_items: {
          type: DataTypes.INTEGER,
          defaultValue: 0,
        },
        result_url: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        error_details: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
      });
      return;
    }
  },

  down: async ({ context }: { context: Context }): Promise<void> => {
    await context.dropTable(TABLE);
  },
};
