const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Vendor extends Model {
    static associate(models) {
      Vendor.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "CASCADE",
      });
    }
  }

  Vendor.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "tenants",
          key: "id",
        },
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM("CalibrationLab", "PartsSupplier", "Other"),
        allowNull: false,
        defaultValue: "Other",
      },
      contactPerson: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          isEmail: true,
        },
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      address: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      rating: {
        type: DataTypes.FLOAT,
        allowNull: true,
        validate: {
          min: 0,
          max: 5,
        },
      },
      approvalStatus: {
        type: DataTypes.ENUM("APPROVED", "PENDING", "REJECTED", "CONDITIONAL"),
        defaultValue: "PENDING",
        allowNull: false,
        field: "approval_status",
      },
      scorecard: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      lastAuditDate: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "last_audit_date",
      },
      nextAuditDate: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "next_audit_date",
      },
      status: {
        type: DataTypes.ENUM("Active", "Inactive"),
        allowNull: false,
        defaultValue: "Active",
      },
    },
    {
      sequelize,
      modelName: "Vendor",
      tableName: "vendors",
      timestamps: true,
      paranoid: true,
      underscored: true,
    },
  );

  return Vendor;
};
