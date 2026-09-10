/**
 * TenantSettings Model
 *
 * Key-value pairs for tenant-specific configuration settings.
 */

/**
 * Define the TenantSettings model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const TenantSettings = db.define(
    "TenantSettings",
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
      key: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      value: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "tenant_settings",
      timestamps: true,
      underscored: true,
      indexes: [
        {
          fields: ["tenant_id", "key"],
          unique: true,
        },
      ],
    },
  );

  const { encryptData, decryptData } = require("../services/kms.service");

  const SENSITIVE_KEYS = [
    'sso_idp_cert',
    'oidc_client_secret',
    'stripe_secret_key',
    'webhook_signing_secret',
    // A tenant's own object-storage keys (bring-your-own bucket). These grant
    // direct access to that tenant's files, so they are envelope-encrypted at
    // rest exactly like the other secrets above.
    'storage_credentials',
  ];

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  TenantSettings.associate = (models) => {
    // TenantSettings -> Tenant
    TenantSettings.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
  };

  // Add KMS Envelope Encryption Hooks for sensitive settings
  TenantSettings.beforeSave(async (setting, options) => {
    if (setting.changed('value') && SENSITIVE_KEYS.includes(setting.key) && setting.value) {
      // Avoid double encrypting if it already looks like a KMS payload
      if (!setting.value.startsWith('v1:')) {
        setting.value = encryptData(setting.tenantId, setting.value);
      }
    }
  });

  const decryptSetting = (setting) => {
    if (setting && SENSITIVE_KEYS.includes(setting.key) && setting.value && setting.value.startsWith('v1:')) {
      setting.value = decryptData(setting.tenantId, setting.value);
    }
  };

  TenantSettings.afterFind(async (result, options) => {
    if (!result) return;
    if (Array.isArray(result)) {
      result.forEach(decryptSetting);
    } else {
      decryptSetting(result);
    }
  });

  return TenantSettings;
};

module.exports = defineModel;
