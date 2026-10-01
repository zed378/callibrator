/**
 * TenantKey Model — Per-tenant cryptographic key pairs
 *
 * Stores RSA (or other algorithm) key pairs used by the e-signature module.
 * The private key is stored ENCRYPTED at rest (AES-256) by the e-signature
 * service; this model never holds a plaintext private key. Tenant-scoped, so
 * the tenant-isolation hooks confine every query to the caller's tenant.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from tenantKey.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import type { TenantId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A TenantKey row (attributes, included associations, instance methods). Types only: emits nothing. */
interface TenantKey extends Model<
  InferAttributes<TenantKey>,
  InferCreationAttributes<TenantKey>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  keyId: string;
  keyType: CreationOptional<string>;
  algorithm: CreationOptional<string>;
  publicKey: string;
  /** A KMS envelope of the PEM (tenant AAD), never plaintext; excluded by the defaultScope. */
  privateKey: string;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
}

interface TenantKeyStatics {
  associate: (models: Models) => void;
}

type DefineTenantKey = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<TenantKey, TenantKeyStatics>;

/** Define the TenantKey model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineTenantKey = (db, DataTypes) => {
  const TenantKey = initModel<TenantKey, TenantKeyStatics>(
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
      keyId: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        comment: "Human-readable key identifier (key-<ts>-<rand>)",
      },
      keyType: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "esignature",
      },
      algorithm: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "RS256",
      },
      publicKey: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      privateKey: {
        type: DataTypes.TEXT,
        allowNull: false,
        // P6-10: a kms.service envelope (v2:<keyId>:…, GCM, tenant id as AAD).
        // Rows written before migration 0058 were AES-CBC `iv:ciphertext`
        // under ENCRYPT_KEY; 0058 re-wraps them (services/signingKeyWrap).
        comment: "KMS envelope of the PEM (tenant AAD); never plaintext",
      },
    },
    {
      tableName: "tenant_keys",
      timestamps: true,
      paranoid: true,
      underscored: true,
      defaultScope: {
        // Never leak the encrypted private key on ordinary reads; the service
        // opts back in with `.scope(null)` / attributes when it needs it.
        attributes: { exclude: ["privateKey"] },
      },
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["key_id"], unique: true },
        { fields: ["key_type"] },
      ],
      modelName: "TenantKey",
      sequelize: db,
    },
  );

  TenantKey.associate = (models: Models): void => {
    TenantKey.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
  };

  return TenantKey;
};

export = defineModel;
