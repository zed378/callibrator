"use strict";

const TABLE = "batch_jobs";

module.exports = {
  up: async ({ context }) => {
    let desc;
    try {
      desc = await context.describeTable(TABLE);
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

  down: async ({ context }) => {
    await context.dropTable(TABLE);
  },
};
