/**
 * TenantSettings Model
 *
 * Key-value pairs for tenant-specific configuration settings.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from tenantSettings.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
  type UpdateOptions,
  type UpsertOptions,
} from "sequelize";
import type * as TenantSecretSettings from "../constants/tenantSecretSettings";
import type { TenantId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** The kms.service functions this model calls (kms.service is TypeScript since P9-18; this view is what the model reads). */
interface KmsForSettings {
  encryptData: (tenantId: string, plaintext: string) => string;
  decryptData: (tenantId: string, payload: string) => string;
  isEnvelope: (value: unknown) => boolean;
}

/** The beforeUpsert hook: the upserted values, and the options carrying the built instance. */
type UpsertHookTenantSettings = (
  values: unknown,
  options: unknown,
) => Promise<void>;

/** A bulk update's values and filter, as Sequelize hands them to beforeBulkUpdate (not in its typings). */
interface SettingsBulkUpdateOptions {
  attributes: { value?: unknown; key?: unknown };
  where: { key?: unknown; tenantId?: unknown };
}

/** A TenantSettings row (attributes, included associations, instance methods). Types only: emits nothing. */
interface TenantSettings extends Model<
  InferAttributes<TenantSettings>,
  InferCreationAttributes<TenantSettings>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  key: string;
  /** A secret key's value is stored as a kms.service envelope (the hooks encrypt on write, decrypt on read). */
  value: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
}

interface TenantSettingsStatics {
  associate: (models: Models) => void;
}

type DefineTenantSettings = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<TenantSettings, TenantSettingsStatics>;

/** Define the TenantSettings model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineTenantSettings = (db, DataTypes) => {
  const TenantSettings = initModel<TenantSettings, TenantSettingsStatics>(
    class extends Model {},
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
      modelName: "TenantSettings",
      sequelize: db,
    },
  );

  // services/kms.service is required HERE, inside the factory, as the JavaScript did: the same lazy
  // load (it reads the master key ring at load). It was JavaScript when this model converted and is
  // TypeScript since P9-18 (ADR-087); the lazy require is kept for the load timing.
  const { encryptData, decryptData, isEnvelope } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require, kept for the load timing
    require("../services/kms.service") as KmsForSettings;

  // A-150: which keys are secret is defined once, in
  // constants/tenantSecretSettings.js — the explicit list (now including
  // `ai_api_key`) plus any key named like a credential. tenant.service and
  // migration 0035 read the same definition.
  // Required in the factory as before (TypeScript now, but the same load timing).
  const { isSecretSettingKey, isEnvelopeSettingKey } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required in the factory
    require("../constants/tenantSecretSettings") as typeof TenantSecretSettings;

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  TenantSettings.associate = (models: Models): void => {
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
  const isPlaintext = (value: unknown): value is string =>
    typeof value === "string" && value !== "" && !isEnvelope(value);

  /**
   * Envelope-encrypt a built instance's value when its key is secret.
   * @param {object} setting - a TenantSettings instance
   */
  const encryptInstance = (setting: TenantSettings): void => {
    if (
      setting.changed("value") &&
      isSecretSettingKey(setting.key) &&
      isPlaintext(setting.value)
    ) {
      if (!setting.tenantId) {
        // The envelope binds the tenant id as AAD; without one it could never
        // be decrypted. Refuse rather than store plaintext.
        throw new Error(
          "TenantSettings: a secret setting needs its tenantId to be encrypted",
        );
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
  // eslint-disable-next-line @typescript-eslint/require-await -- as built: async hooks
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
  // eslint-disable-next-line @typescript-eslint/require-await -- as built: async hooks
  TenantSettings.beforeValidate(async (setting, options) => {
    // `options.instance` is set by Sequelize on validation from save() (not in its typings).
    if ((options as { instance?: unknown }).instance === setting) {
      encryptInstance(setting);
    }
  });

  // `upsert(..., { validate: false })` skips the hook above. The snapshot is
  // already taken, so the only fail-closed answer here is to refuse.
  // `beforeUpsert` is a Sequelize hook shorthand that exists at run time but is missing from its
  // static typings; the same call, through a typed view of the class.
  (
    TenantSettings as typeof TenantSettings & {
      beforeUpsert: (fn: UpsertHookTenantSettings) => void;
    }
  )
    // eslint-disable-next-line @typescript-eslint/require-await -- as built: async hooks
    .beforeUpsert(async (_values, options) => {
      // upsert() passes the built instance as `options.instance` (not in Sequelize's typings).
      const { key, value } = (
        options as UpsertOptions<InferAttributes<TenantSettings>> & {
          instance: TenantSettings;
        }
      ).instance;
      if (isSecretSettingKey(key) && isPlaintext(value)) {
        throw new Error(
          `TenantSettings: refusing to upsert "${key}" in plaintext`,
        );
      }
    });

  // eslint-disable-next-line @typescript-eslint/require-await -- as built: async hooks
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
  // eslint-disable-next-line @typescript-eslint/require-await -- as built: async hooks
  TenantSettings.beforeBulkUpdate(async (options) => {
    const { attributes, where } = options as UpdateOptions<
      InferAttributes<TenantSettings>
    > &
      SettingsBulkUpdateOptions;
    if (!isPlaintext(attributes.value)) {
      return;
    }

    const keySource = attributes.key !== undefined ? attributes.key : where.key;
    const keys = typeof keySource === "string" ? [keySource] : keySource;
    const known =
      Array.isArray(keys) &&
      keys.length > 0 &&
      keys.every((k) => typeof k === "string");
    if (known && !(keys as unknown[]).some(isSecretSettingKey)) {
      return;
    }

    const tenantId = typeof where.tenantId === "string" ? where.tenantId : null;
    if (!known || !tenantId || !(keys as unknown[]).every(isSecretSettingKey)) {
      throw new Error(
        "TenantSettings: a bulk update of a secret value must name one tenantId and only secret keys",
      );
    }
    attributes.value = encryptData(tenantId, attributes.value);
  });

  const decryptSetting = (setting: TenantSettings | null | undefined): void => {
    // A-178: a key that used to be secret (sso_idp_cert) may still hold an
    // envelope written before it was reclassified.
    if (
      setting &&
      isEnvelopeSettingKey(setting.key) &&
      isEnvelope(setting.value)
    ) {
      setting.value = decryptData(setting.tenantId, setting.value as string);
    }
  };

  // eslint-disable-next-line @typescript-eslint/require-await -- as built: async hooks
  TenantSettings.afterFind(async (result) => {
    if (!result) {
      return;
    }
    if (Array.isArray(result)) {
      (result as readonly TenantSettings[]).forEach((setting) => {
        decryptSetting(setting);
      });
    } else {
      decryptSetting(result as TenantSettings);
    }
  });

  return TenantSettings;
};

export = defineModel;
