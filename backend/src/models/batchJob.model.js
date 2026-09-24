const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class BatchJob extends Model {
    static associate(models) {
      BatchJob.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant", onDelete: "CASCADE" });
      BatchJob.belongsTo(models.User, { foreignKey: "userId", as: "user", onDelete: "SET NULL" });
    }
  }
  
  BatchJob.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        field: "tenant_id",
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "CASCADE",
      },
      userId: {
        type: DataTypes.UUID,
        field: "user_id",
        allowNull: true,
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("PENDING", "PROCESSING", "COMPLETED", "FAILED"),
        defaultValue: "PENDING",
        allowNull: false,
      },
      progress: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false,
      },
      totalItems: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      processedItems: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      resultUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      errorDetails: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "BatchJob",
      tableName: "batch_jobs",
      timestamps: true,
      underscored: true,
    }
  );
  
  return BatchJob;
};
