"use strict";

module.exports = {
  up: async ({ context }) => {
    const { sequelize } = context;
    const DataTypes = sequelize.Sequelize.DataTypes;

    // Idempotent: db.sync() creates these tables from the models on a fresh DB,
    // so only create the ones actually missing.
    const existing = (await context.showAllTables()).map((t) =>
      (typeof t === "object" ? t.tableName : t).toLowerCase(),
    );

    if (!existing.includes("non_conformances")) {
    // Create non_conformances table
    await context.createTable("non_conformances", {
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
      nc_number: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("OPEN", "UNDER_INVESTIGATION", "CAPA_REQUIRED", "CLOSED"),
        defaultValue: "OPEN",
        allowNull: false,
      },
      severity: {
        type: DataTypes.ENUM("LOW", "MEDIUM", "HIGH", "CRITICAL"),
        defaultValue: "MEDIUM",
        allowNull: false,
      },
      reported_by: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      device_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "calibration_devices", key: "id" },
        onDelete: "SET NULL",
      },
      date_identified: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      root_cause: {
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
      deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    });
    }

    if (!existing.includes("capas")) {
    // Create capas table
    await context.createTable("capas", {
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
      capa_number: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      nc_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "non_conformances", key: "id" },
        onDelete: "CASCADE",
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      action_plan: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("DRAFT", "OPEN", "IN_PROGRESS", "VERIFICATION", "CLOSED"),
        defaultValue: "DRAFT",
        allowNull: false,
      },
      assigned_to: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      due_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      completed_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      approved_by: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      verification_notes: {
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
      deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    });
    }
  },

  down: async ({ context }) => {
    await context.dropTable("capas");
    await context.dropTable("non_conformances");
  },
};
