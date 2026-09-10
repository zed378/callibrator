/**
 * Webhook Model
 *
 * Tenant-scoped outbound webhook subscriptions. Each webhook subscribes to a set
 * of domain events and receives HMAC-signed POST deliveries when they occur.
 */

const crypto = require("crypto");

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
        allowNull: false,
        defaultValue: [],
      },
      // Shared secret used to HMAC-sign delivery payloads.
      secret: {
        type: DataTypes.STRING(128),
        allowNull: false,
        defaultValue: () => crypto.randomBytes(24).toString("hex"),
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

  Webhook.prototype.softDelete = async function () {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  Webhook.associate = (models) => {
    Webhook.belongsTo(models.Tenant, { foreignKey: "tenant_id", as: "tenant" });
    Webhook.hasMany(models.WebhookDelivery, {
      foreignKey: "webhook_id",
      as: "deliveries",
    });
  };

  return Webhook;
};

module.exports = defineModel;
