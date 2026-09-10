/**
 * WebhookDelivery Model
 *
 * Audit log of individual webhook delivery attempts (one row per webhook per
 * event). Tracks status, attempt count, and the last response/error.
 */

const defineModel = (db, DataTypes) => {
  const WebhookDelivery = db.define(
    "WebhookDelivery",
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
      webhookId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "webhooks", key: "id" },
        onDelete: "CASCADE",
      },
      event: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      payload: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      status: {
        type: DataTypes.ENUM("pending", "success", "failed", "exhausted"),
        allowNull: false,
        defaultValue: "pending",
      },
      attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      responseStatus: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      lastError: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      deliveredAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "webhook_deliveries",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["webhook_id"] },
        { fields: ["status"] },
      ],
    },
  );

  WebhookDelivery.associate = (models) => {
    WebhookDelivery.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
    WebhookDelivery.belongsTo(models.Webhook, {
      foreignKey: "webhook_id",
      as: "webhook",
    });
  };

  return WebhookDelivery;
};

module.exports = defineModel;
