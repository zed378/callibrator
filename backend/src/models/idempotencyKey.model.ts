/**
 * IdempotencyKey Model — one `Idempotency-Key` a caller sent, and what its first request did
 * (P20-04; ADR-127 § 7, ADR-126 Am. 1 § 8; spec MEMORY/specs/P19-02-ipm-session-aggregate.md
 * § 9.1). The middleware that writes and replays it is P21-03's.
 *
 * Stores the request hash, a scope fingerprint (AM-25) and the RESOURCE REFERENCE with its status —
 * never a response body (G-S10): a replay re-reads the resource in the caller's current context.
 * Exactly one of `userId` / `apiKeyId` names the caller (CHECK in 0126). Unique per tenant and
 * caller; purged after `expiresAt` (30 days) by a nightly job.
 *
 * TENANT-scoped, NOT facility-scoped: a bound principal reads only its own rows through
 * FACILITY_READABLE's `own-user` rule on `userId` (G-S11). NOT paranoid, NO defaultScope, no
 * `updated_at`; no index declared (all in 0126 — ADR-100 Am. 3).
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { IDEMPOTENCY_KEY_STATUSES, type IdempotencyKeyStatus } from "@callibrator/contracts/states";
import type { IdempotencyKeyId, TenantId, UserId } from "../types/ids";
import type { Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** An IdempotencyKey row. Types only: emits nothing. */
interface IdempotencyKey extends Model<InferAttributes<IdempotencyKey>, InferCreationAttributes<IdempotencyKey>> {
  id: CreationOptional<IdempotencyKeyId>;
  tenantId: TenantId;
  userId: CreationOptional<UserId | null>;
  apiKeyId: CreationOptional<string | null>;
  key: string;
  route: string;
  requestHash: string;
  scopeFingerprint: string;
  status: CreationOptional<IdempotencyKeyStatus>;
  responseStatus: CreationOptional<number | null>;
  resourceType: CreationOptional<string | null>;
  resourceId: CreationOptional<string | null>;
  createdAt: CreationOptional<Date>;
  completedAt: CreationOptional<Date | null>;
  expiresAt: Date;
}

interface IdempotencyKeyStatics {
  associate: (models: Models) => void;
}

type DefineIdempotencyKey = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<IdempotencyKey, IdempotencyKeyStatics>;

/** Define the IdempotencyKey model on `db`. */
const defineModel: DefineIdempotencyKey = (db, DataTypes) => {
  const IdempotencyKey = initModel<IdempotencyKey, IdempotencyKeyStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      apiKeyId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "api_keys", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      key: { type: DataTypes.UUID, allowNull: false },
      route: { type: DataTypes.STRING(128), allowNull: false },
      requestHash: { type: DataTypes.CHAR(64), allowNull: false },
      scopeFingerprint: { type: DataTypes.CHAR(64), allowNull: false },
      status: { type: DataTypes.ENUM(...IDEMPOTENCY_KEY_STATUSES), allowNull: false, defaultValue: "in_flight" },
      responseStatus: { type: DataTypes.SMALLINT, allowNull: true },
      resourceType: { type: DataTypes.STRING(64), allowNull: true },
      resourceId: { type: DataTypes.UUID, allowNull: true },
      completedAt: { type: DataTypes.DATE, allowNull: true },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      tableName: "idempotency_keys",
      timestamps: true,
      updatedAt: false,
      paranoid: false,
      underscored: true,
      modelName: "IdempotencyKey",
      sequelize: db,
    },
  );

  IdempotencyKey.associate = (models: Models): void => {
    IdempotencyKey.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant", onDelete: "RESTRICT" });
  };

  return IdempotencyKey;
};

export = defineModel;
