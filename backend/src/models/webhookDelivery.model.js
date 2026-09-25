/**
 * WebhookDelivery Model
 *
 * Audit log of individual webhook delivery attempts (one row per webhook per
 * event). Tracks status, attempt count, and the last response/error.
 *
 * Since A-10 (ADR-054) this row is also the durable delivery queue (an
 * outbox): `status` pending|failed + `nextAttemptAt` is the retry schedule,
 * and `exhausted` is the dead letter. See services/webhook.service.js.
 */

// D-27 (ADR-070): every JSON column declares its shape, validated on write.
const { jsonShape } = require("../utils/jsonShape.util");
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
        validate: { shape: jsonShape("WebhookDelivery.payload") },
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
      // A-10 / migration 0043: when the delivery is next due. The dispatcher
      // claims rows with status pending|failed and nextAttemptAt <= now(),
      // pushing it forward by a lease while an attempt is in flight. NULL on a
      // row that is finished (success / exhausted).
      nextAttemptAt: {
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
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "CASCADE",
    });
    WebhookDelivery.belongsTo(models.Webhook, {
      foreignKey: "webhookId",
      as: "webhook",
      onDelete: "CASCADE",
    });
  };

  return WebhookDelivery;
};

module.exports = defineModel;
