/**
 * Risk Model (ISO 14971)
 */
const defineModel = (db, DataTypes) => {
  const Risk = db.define(
    "Risk",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "CASCADE",
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      category: {
        type: DataTypes.STRING(100),
        allowNull: false,
        defaultValue: "OPERATIONAL", // OPERATIONAL, FINANCIAL, COMPLIANCE, STRATEGIC, SAFETY
      },
      severity: {
        type: DataTypes.INTEGER, // 1-5
        allowNull: false,
        defaultValue: 1,
      },
      likelihood: {
        type: DataTypes.INTEGER, // 1-5
        allowNull: false,
        defaultValue: 1,
      },
      // Calculated Risk Priority Number (severity * likelihood)
      rpn: {
        type: DataTypes.VIRTUAL,
        get() {
          return this.severity * this.likelihood;
        }
      },
      status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "OPEN", // OPEN, MITIGATED, CLOSED, ACCEPTED
      },
      mitigationPlan: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      identifiedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      assignedTo: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      dueDate: {
        type: DataTypes.DATE,
        allowNull: true,
      }
    },
    {
      tableName: "risks",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );

  Risk.associate = (models) => {
    Risk.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
    Risk.belongsTo(models.User, {
      foreignKey: "identified_by",
      as: "identifier",
    });
    Risk.belongsTo(models.User, {
      foreignKey: "assigned_to",
      as: "assignee",
    });
  };

  return Risk;
};

module.exports = defineModel;
