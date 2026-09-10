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

    if (!existing.includes("sop_documents")) {
    // Create sop_documents table
    await context.createTable("sop_documents", {
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
      document_number: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      version: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "1.0",
      },
      content_url: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("DRAFT", "UNDER_REVIEW", "PUBLISHED", "ARCHIVED"),
        defaultValue: "DRAFT",
        allowNull: false,
      },
      author_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      published_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      requires_training: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
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

    if (!existing.includes("sop_training_acknowledgments")) {
    // Create sop_training_acknowledgments table
    await context.createTable("sop_training_acknowledgments", {
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
      document_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "sop_documents", key: "id" },
        onDelete: "CASCADE",
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      acknowledged_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("PENDING", "COMPLETED"),
        defaultValue: "PENDING",
        allowNull: false,
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
    }
  },

  down: async ({ context }) => {
    await context.dropTable("sop_training_acknowledgments");
    await context.dropTable("sop_documents");
  },
};
