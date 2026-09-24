/**
 * Webhook Model
 *
 * Tenant-scoped outbound webhook subscriptions. Each webhook subscribes to a set
 * of domain events and receives HMAC-signed POST deliveries when they occur.
 */

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
