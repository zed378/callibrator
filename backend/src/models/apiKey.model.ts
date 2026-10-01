/**
 * ApiKey Model
 *
 * Tenant-scoped API keys / service accounts. The full key is shown only once at
 * creation; only a SHA-256 hash + a short display prefix are stored. Keys carry
 * scopes ("<resource>:<read|write|*>" or "*") enforced by dynamicAccess.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from apiKey.model.js with no behaviour
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
import { jsonShape, type ApiKeyScopes } from "../utils/jsonShape.util";
import type { TenantId, UserId } from "../types/ids";
import type { DefaultScoped, ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

// D-27 (ADR-070): every JSON column declares its shape, validated on write.
/** A ApiKey row (attributes, included associations, instance methods). Types only: emits nothing. */
interface ApiKey extends Model<
  InferAttributes<ApiKey>,
  InferCreationAttributes<ApiKey>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  name: string;
  keyPrefix: string;
  /** SHA-256 of the key; the key itself is shown once and never stored. */
  keyHash: string;
  /** JSONB, D-27 shape `ApiKey.scopes`. */
  scopes: CreationOptional<ApiKeyScopes>;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  isActive: CreationOptional<boolean>;
  createdBy: UserId | null;
  isDeleted: CreationOptional<boolean>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;

  softDelete(): Promise<ApiKey>;
}

interface ApiKeyStatics {
  associate: (models: Models) => void;
  /** D-12: the defaultScope carries a `where`, so a bare include is an INNER JOIN. Phantom: never read at run time. */
  readonly defaultScoped: DefaultScoped;
}

type DefineApiKey = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<ApiKey, ApiKeyStatics>;

/** Define the ApiKey model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineApiKey = (db, DataTypes) => {
  const ApiKey = initModel<ApiKey, ApiKeyStatics>(
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
        onDelete: "CASCADE",
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // Short, non-secret display prefix (e.g. "cbk_1a2b3c").
      keyPrefix: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      // SHA-256 hex of the full key. Looked up on authentication.
      keyHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      // Lower-case "<menu slug>:<read|write>" strings, e.g. ["equipment:read", "certificate:write"].
      // Shape enforced on write by apiKey.service#assertScopes (A-27): a known slug,
      // read or write, and NO wildcard — the "*" / "*:read" forms this comment used
      // to show are refused (D-27).
      scopes: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("ApiKey.scopes") },
        allowNull: false,
        defaultValue: [],
      },
      lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      expiresAt: {
        type: DataTypes.DATE,
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
      tableName: "api_keys",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["key_hash"], unique: true },
        { fields: ["is_deleted"] },
      ],
      // @ts-expect-error -- the key is the COLUMN is_deleted, not the attribute isDeleted: a caller's where on is_deleted REPLACES this default only with the column key (P9-10 spec, probe 3)
      defaultScope: { where: { is_deleted: false } },
      // A-274: the ONE `includeDeleted` scope kept, for its callers —
      // calibrationRecords.service and stock.service include
      // `ApiKey.scope("includeDeleted")` so a row made by a since-revoked key
      // still names it (Q-51, ADR-100 Amendment 2). Used ALONE it replaces the
      // defaultScope; never combine it with "defaultScope"
      // (tests/models/includeDeletedScope.a274.test.ts).
      // @ts-expect-error -- where: null clears the defaultScope's predicate when the scopes are combined; {} would keep it (P9-10 spec, probe 2)
      scopes: { includeDeleted: { where: null } },
      modelName: "ApiKey",
      sequelize: db,
    },
  );

  ApiKey.prototype.softDelete = async function (this: ApiKey): Promise<ApiKey> {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  ApiKey.associate = (models: Models): void => {
    ApiKey.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "CASCADE",
    });
  };

  return ApiKey;
};

export = defineModel;
