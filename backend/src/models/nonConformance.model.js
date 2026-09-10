const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class NonConformance extends Model {
    static associate(models) {
      NonConformance.belongsTo(models.Tenant, { foreignKey: "tenant_id", as: "tenant" });
      NonConformance.belongsTo(models.User, { foreignKey: "reported_by", as: "reporter" });
      NonConformance.belongsTo(models.CalibrationDevice, { foreignKey: "device_id", as: "device" });
      NonConformance.hasMany(models.Capa, { foreignKey: "nc_id", as: "capas" });
    }
  }
  
  NonConformance.init(
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
      ncNumber: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "nc_number",
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
      reportedBy: {
        type: DataTypes.UUID,
        field: "reported_by",
        allowNull: false,
      },
      deviceId: {
        type: DataTypes.UUID,
        field: "device_id",
        allowNull: true,
      },
      dateIdentified: {
        type: DataTypes.DATE,
        field: "date_identified",
        allowNull: false,
      },
      rootCause: {
        type: DataTypes.TEXT,
        field: "root_cause",
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "NonConformance",
      tableName: "non_conformances",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );
  
  return NonConformance;
};
