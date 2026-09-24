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
        onDelete: "RESTRICT",
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

  const { encryptData, decryptData, isEnvelope } = require("../services/kms.service");

  // A-150: which keys are secret is defined once, in
  // constants/tenantSecretSettings.js — the explicit list (now including
  // `ai_api_key`) plus any key named like a credential. tenant.service and
  // migration 0035 read the same definition.
  const {
    isSecretSettingKey,
    isEnvelopeSettingKey,
  } = require("../constants/tenantSecretSettings");

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  TenantSettings.associate = (models) => {
    // TenantSettings -> Tenant
    TenantSettings.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
  };

  /**
   * @param {*} value - a value about to be written
   * @returns {boolean} true when it is a non-empty string not yet enveloped
   */
  // P6-10: an envelope is `v1:` or `v2:<keyId>:` — kms.service decides.
  const isPlaintext = (value) =>
    typeof value === "string" && value !== "" && !isEnvelope(value);

  /**
   * Envelope-encrypt a built instance's value when its key is secret.
   * @param {object} setting - a TenantSettings instance
   */
  const encryptInstance = (setting) => {
    if (setting.changed("value") && isSecretSettingKey(setting.key) && isPlaintext(setting.value)) {
      if (!setting.tenantId) {
        // The envelope binds the tenant id as AAD; without one it could never
        // be decrypted. Refuse rather than store plaintext.
        throw new Error("TenantSettings: a secret setting needs its tenantId to be encrypted");
      }
      setting.value = encryptData(setting.tenantId, setting.value);
    }
  };

  // Add KMS Envelope Encryption Hooks for sensitive settings.
  //
  // A-177: `beforeSave` runs only for INSTANCE saves (create, save, update on
  // an instance, findOrCreate). The static paths each skip it, and each one
  // stored a secret in plaintext:
  //   Model.upsert      -> beforeValidate on the built instance (below), and
  //                        beforeUpsert refuses what is still plaintext
  //   Model.bulkCreate  -> beforeBulkCreate
  //   Model.update      -> beforeBulkUpdate
  // Only `hooks: false` bypasses them — the same explicit opt-out that also
  // bypasses tenant isolation (utils/tenantScope.util.js).
  TenantSettings.beforeSave(async (setting) => {
    encryptInstance(setting);
  });

  // Upsert. Sequelize v6 snapshots the INSERT/UPDATE values from the built
  // instance BEFORE it runs `beforeUpsert` (model.js `upsert`: build, validate,
  // snapshot, then the hook), so encrypting in `beforeUpsert` would change
  // nothing that reaches the database. Validation runs before the snapshot, on
  // that same instance, and `options.instance` identifies it. An instance
  // `save` validates too, before the global hooks stamp the tenant id; it is
  // left to `beforeSave`.
  TenantSettings.beforeValidate(async (setting, options) => {
    if (options.instance === setting) {
      encryptInstance(setting);
    }
  });

  // `upsert(..., { validate: false })` skips the hook above. The snapshot is
  // already taken, so the only fail-closed answer here is to refuse.
  TenantSettings.beforeUpsert(async (values, options) => {
    const { key, value } = options.instance;
    if (isSecretSettingKey(key) && isPlaintext(value)) {
      throw new Error(`TenantSettings: refusing to upsert "${key}" in plaintext`);
    }
  });

  TenantSettings.beforeBulkCreate(async (instances) => {
    for (const instance of instances) {
      encryptInstance(instance);
    }
  });

  // Model.update(values, { where }). The value is encrypted in
  // `options.attributes`, under the ONE tenant and for the keys the `where`
  // names. When the key or the tenant cannot be read off the statement and
  // a plaintext value is being written, it is refused: encrypting a
  // non-secret key would make it unreadable, and not encrypting a secret one
  // is the defect. (Runs before the global tenant hook adds its predicate.)
  TenantSettings.beforeBulkUpdate(async (options) => {
    const { attributes, where } = options;
    if (!isPlaintext(attributes.value)) {return;}

    const keySource = attributes.key !== undefined ? attributes.key : where.key;
    const keys = typeof keySource === "string" ? [keySource] : keySource;
    const known = Array.isArray(keys) && keys.length > 0 && keys.every((k) => typeof k === "string");
    if (known && !keys.some(isSecretSettingKey)) {return;}

    const tenantId = typeof where.tenantId === "string" ? where.tenantId : null;
    if (!known || !tenantId || !keys.every(isSecretSettingKey)) {
      throw new Error(
        "TenantSettings: a bulk update of a secret value must name one tenantId and only secret keys",
      );
    }
    attributes.value = encryptData(tenantId, attributes.value);
  });

  const decryptSetting = (setting) => {
    // A-178: a key that used to be secret (sso_idp_cert) may still hold an
    // envelope written before it was reclassified.
    if (setting && isEnvelopeSettingKey(setting.key) && isEnvelope(setting.value)) {
      setting.value = decryptData(setting.tenantId, setting.value);
    }
  };

  TenantSettings.afterFind(async (result) => {
    if (!result) {return;}
    if (Array.isArray(result)) {
      result.forEach(decryptSetting);
    } else {
      decryptSetting(result);
    }
  });

  return TenantSettings;
};

module.exports = defineModel;
