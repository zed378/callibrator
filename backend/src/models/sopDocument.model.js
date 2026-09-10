const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class SopDocument extends Model {
    static associate(models) {
      SopDocument.belongsTo(models.Tenant, { foreignKey: "tenant_id", as: "tenant" });
      SopDocument.belongsTo(models.User, { foreignKey: "author_id", as: "author" });
      SopDocument.hasMany(models.SopTrainingAcknowledgment, { foreignKey: "document_id", as: "acknowledgments" });
    }
  }
  
  SopDocument.init(
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
      documentNumber: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "document_number",
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
      contentUrl: {
        type: DataTypes.STRING,
        field: "content_url",
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("DRAFT", "UNDER_REVIEW", "PUBLISHED", "ARCHIVED"),
        defaultValue: "DRAFT",
        allowNull: false,
      },
      authorId: {
        type: DataTypes.UUID,
        field: "author_id",
        allowNull: false,
      },
      publishedDate: {
        type: DataTypes.DATE,
        field: "published_date",
        allowNull: true,
      },
      requiresTraining: {
        type: DataTypes.BOOLEAN,
        field: "requires_training",
        defaultValue: true,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "SopDocument",
      tableName: "sop_documents",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );
  
  return SopDocument;
};
