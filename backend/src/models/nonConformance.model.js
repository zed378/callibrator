const { Model } = require("sequelize");
const { NC_STATUSES, NC_SEVERITIES } = require("../constants/qmsConstants");

module.exports = (sequelize, DataTypes) => {
  class NonConformance extends Model {
    static associate(models) {
      NonConformance.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant", onDelete: "RESTRICT" });
      NonConformance.belongsTo(models.User, { foreignKey: "reportedBy", as: "reporter", onDelete: "RESTRICT" });
      NonConformance.belongsTo(models.CalibrationDevice, { foreignKey: "deviceId", as: "device", onDelete: "SET NULL" });
      NonConformance.hasMany(models.Capa, { foreignKey: "ncId", as: "capas", onDelete: "RESTRICT" });
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
        references: { model: "tenants", key: "id" },
        onDelete: "RESTRICT",
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
        type: DataTypes.ENUM(...NC_STATUSES),
        defaultValue: "OPEN",
        allowNull: false,
      },
      severity: {
        type: DataTypes.ENUM(...NC_SEVERITIES),
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
