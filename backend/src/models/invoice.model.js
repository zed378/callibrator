const { Model, DataTypes } = require("sequelize");

/** D-21: a NUMERIC read back from pg (a string) as a number; null/undefined kept. */
const toNumber = (value) => (value === null || value === undefined ? value : Number(value));

module.exports = (sequelize) => {
  class Invoice extends Model {
    static associate(models) {
      Invoice.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "RESTRICT",
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
        onDelete: "RESTRICT",
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
        // D-21: node-postgres returns NUMERIC as a string ("1250.00"), so
        // `a + b` concatenated and `>` compared lexicographically. Read as a
        // number; NULL stays NULL. `raw: true` queries and SUM() bypass this.
        get() {
          return toNumber(this.getDataValue("amountDue"));
        },
      },
      amountPaid: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.00,
        // D-21: node-postgres returns NUMERIC as a string ("1250.00"), so
        // `a + b` concatenated and `>` compared lexicographically. Read as a
        // number; NULL stays NULL. `raw: true` queries and SUM() bypass this.
        get() {
          return toNumber(this.getDataValue("amountPaid"));
        },
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
