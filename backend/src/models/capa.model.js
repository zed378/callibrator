const { Model } = require("sequelize");
const { CAPA_STATUSES } = require("../constants/qmsConstants");

module.exports = (sequelize, DataTypes) => {
  class Capa extends Model {
    static associate(models) {
      Capa.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant", onDelete: "RESTRICT" });
      Capa.belongsTo(models.NonConformance, { foreignKey: "ncId", as: "nonConformance", onDelete: "RESTRICT" });
      Capa.belongsTo(models.User, { foreignKey: "assignedTo", as: "assignee", onDelete: "SET NULL" });
      Capa.belongsTo(models.User, { foreignKey: "approvedBy", as: "approver", onDelete: "RESTRICT" });
    }
  }
  
  Capa.init(
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
      capaNumber: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "capa_number",
      },
      ncId: {
        type: DataTypes.UUID,
        field: "nc_id",
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      actionPlan: {
        type: DataTypes.TEXT,
        field: "action_plan",
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...CAPA_STATUSES),
        defaultValue: "DRAFT",
        allowNull: false,
      },
      assignedTo: {
        type: DataTypes.UUID,
        field: "assigned_to",
        allowNull: true,
      },
      dueDate: {
        type: DataTypes.DATE,
        field: "due_date",
        allowNull: true,
      },
      completedDate: {
        type: DataTypes.DATE,
        field: "completed_date",
        allowNull: true,
      },
      approvedBy: {
        type: DataTypes.UUID,
        field: "approved_by",
        allowNull: true,
      },
      verificationNotes: {
        type: DataTypes.TEXT,
        field: "verification_notes",
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Capa",
      tableName: "capas",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );
  
  return Capa;
};
