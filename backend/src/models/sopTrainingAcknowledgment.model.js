const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class SopTrainingAcknowledgment extends Model {
    static associate(models) {
      SopTrainingAcknowledgment.belongsTo(models.Tenant, { foreignKey: "tenant_id", as: "tenant" });
      SopTrainingAcknowledgment.belongsTo(models.SopDocument, { foreignKey: "document_id", as: "document" });
      SopTrainingAcknowledgment.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
    }
  }
  
  SopTrainingAcknowledgment.init(
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
      },
      documentId: {
        type: DataTypes.UUID,
        field: "document_id",
        allowNull: false,
      },
      userId: {
        type: DataTypes.UUID,
        field: "user_id",
        allowNull: false,
      },
      acknowledgedAt: {
        type: DataTypes.DATE,
        field: "acknowledged_at",
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("PENDING", "COMPLETED"),
        defaultValue: "PENDING",
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "SopTrainingAcknowledgment",
      tableName: "sop_training_acknowledgments",
      timestamps: true,
      underscored: true,
    }
  );
  
  return SopTrainingAcknowledgment;
};
