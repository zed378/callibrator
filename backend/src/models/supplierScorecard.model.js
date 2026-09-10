/**
 * SupplierScorecard Model (ISO 9001/17025)
 */
const defineModel = (db, DataTypes) => {
  const SupplierScorecard = db.define(
    "SupplierScorecard",
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
      vendorId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "vendors", key: "id" },
        onDelete: "CASCADE",
      },
      evaluationDate: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      qualityScore: {
        type: DataTypes.INTEGER, // 0-100
        allowNull: false,
        defaultValue: 0,
      },
      deliveryScore: {
        type: DataTypes.INTEGER, // 0-100
        allowNull: false,
        defaultValue: 0,
      },
      serviceScore: {
        type: DataTypes.INTEGER, // 0-100
        allowNull: false,
        defaultValue: 0,
      },
      overallScore: {
        type: DataTypes.VIRTUAL,
        get() {
          return Math.round((this.qualityScore + this.deliveryScore + this.serviceScore) / 3);
        }
      },
      status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "APPROVED", // APPROVED, PROBATION, DISQUALIFIED
      },
      comments: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      evaluatedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      nextEvaluationDate: {
        type: DataTypes.DATE,
        allowNull: true,
      }
    },
    {
      tableName: "supplier_scorecards",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );

  SupplierScorecard.associate = (models) => {
    SupplierScorecard.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
    SupplierScorecard.belongsTo(models.Vendor, {
      foreignKey: "vendor_id",
      as: "vendor",
    });
    SupplierScorecard.belongsTo(models.User, {
      foreignKey: "evaluated_by",
      as: "evaluator",
    });
  };

  return SupplierScorecard;
};

module.exports = defineModel;
