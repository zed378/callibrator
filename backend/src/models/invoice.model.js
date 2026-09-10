const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Invoice extends Model {
    static associate(models) {
      Invoice.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "CASCADE",
      });
      Invoice.belongsTo(models.Subscription, {
        foreignKey: "subscriptionId",
        as: "subscription",
        onDelete: "CASCADE",
      });
    }
  }

  Invoice.init(
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
      subscriptionId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "subscriptions",
          key: "id",
        },
      },
      amountDue: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      amountPaid: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      currency: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "USD",
      },
      status: {
        type: DataTypes.ENUM("Draft", "Open", "Paid", "Uncollectible", "Void"),
        allowNull: false,
        defaultValue: "Draft",
      },
      invoiceUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Stripe invoice id — used to de-duplicate webhook deliveries (Stripe
      // retries). Nullable for invoices not originating from Stripe.
      stripeInvoiceId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
    },
    {
      sequelize,
      modelName: "Invoice",
      tableName: "invoices",
      timestamps: true,
      underscored: true,
    },
  );

  return Invoice;
};
