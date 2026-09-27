/**
 * Webhook Model
 *
 * Tenant-scoped outbound webhook subscriptions. Each webhook subscribes to a set
 * of domain events and receives HMAC-signed POST deliveries when they occur.
 */

// D-27 (ADR-070): every JSON column declares its shape, validated on write.
const { jsonShape } = require("../utils/jsonShape.util");
const defineModel = (db, DataTypes) => {
  const Webhook = db.define(
    "Webhook",
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
      url: {
        type: DataTypes.STRING(1024),
        allowNull: false,
        validate: {
          // Accept any http(s) URL (incl. localhost in dev). NOTE: outbound
          // webhook URLs are attacker-influenced — SSRF hardening (blocking
          // internal/link-local targets) is a recommended follow-on.
          isHttpUrl(value) {
            if (!/^https?:\/\/.+/i.test(value)) {
              throw new Error("url must be a valid http(s) URL");
            }
          },
        },
      },
      // Subscribed event names, e.g. ["certificate.signed","device.overdue"].
      // The special value "*" subscribes to every event.
      events: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("Webhook.events") },
        allowNull: false,
        defaultValue: [],
      },
      // Shared secret used to HMAC-sign delivery payloads — stored as a
      // kms.service envelope (`v1:...`, tenant id as AAD), never plaintext
      // (A-51). TEXT because the envelope is ~200 characters; migration 0022
      // widened the column and encrypted the rows that predate it.
      //
      // No defaultValue, on purpose: the old default generated a PLAINTEXT
      // secret the caller never saw. The only writer is webhook.service.js,
      // which generates, seals and returns it once; a create that bypasses the
      // service now fails allowNull rather than storing an unencrypted key.
      secret: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // P6-13 (ADR-085, migration 0090): the secret a rotation replaced, as the
      // same kms.service envelope, and when it stops signing. While
      // previousSecretExpiresAt is in the future a delivery carries a second
      // signature under it (X-Webhook-Signature-Previous), so a receiver can
      // switch secrets without a coordinated cut-over. Never returned by the API.
      previousSecret: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      previousSecretExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      description: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    },
    {
      tableName: "webhooks",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [{ fields: ["tenant_id"] }, { fields: ["is_deleted"] }],
      defaultScope: { where: { is_deleted: false } },
      scopes: { includeDeleted: { where: null } },
    },
  );

  // P6-13: takes the caller's options, so the delete and its audit row share
  // one transaction.
  Webhook.prototype.softDelete = async function (options = {}) {
    this.isDeleted = true;
    return this.save({ ...options, hooks: false });
  };

  Webhook.associate = (models) => {
    Webhook.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant", onDelete: "CASCADE" });
    Webhook.hasMany(models.WebhookDelivery, {
      foreignKey: "webhookId",
      as: "deliveries",
      onDelete: "CASCADE",
    });
  };

  return Webhook;
};

module.exports = defineModel;
