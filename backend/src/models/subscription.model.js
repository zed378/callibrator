const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Subscription extends Model {
    static associate(models) {
      Subscription.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "CASCADE",
      });
      Subscription.hasMany(models.Invoice, {
        foreignKey: "subscriptionId",
        as: "invoices",
        onDelete: "CASCADE",
      });
    }
  }

  Subscription.init(
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
      planId: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "basic",
      },
      status: {
        type: DataTypes.ENUM("Active", "PastDue", "Canceled", "Unpaid"),
        allowNull: false,
        defaultValue: "Active",
      },
      billingCycle: {
        type: DataTypes.ENUM("Monthly", "Annually"),
        allowNull: false,
        defaultValue: "Monthly",
      },
      currentPeriodStart: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      currentPeriodEnd: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      stripeCustomerId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      stripeSubscriptionId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Subscription",
      tableName: "subscriptions",
      timestamps: true,
      underscored: true,
    },
  );

  return Subscription;
};
