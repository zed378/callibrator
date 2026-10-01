/**
 * DsarRequest Model (Data Subject Access Request)
 *
 * Tracks GDPR data-subject requests (export / erasure / rectification /
 * restriction) as asynchronous, auditable work items.
 */
// D-27 (ADR-070): every JSON column declares its shape, validated on write.
// P9-10 (ADR-087 Amendments 7–8): converted from dsarRequest.model.js with no behaviour
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
import { jsonShape, type DsarDetails } from "../utils/jsonShape.util";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** The `type` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const DSAR_TYPES = [
  "export",
  "erasure",
  "rectification",
  "restriction",
] as const;

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const DSAR_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "rejected",
] as const;

/** A DsarRequest row (attributes, included associations, instance methods). Types only: emits nothing. */
interface DsarRequest extends Model<
  InferAttributes<DsarRequest>,
  InferCreationAttributes<DsarRequest>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  userId: UserId;
  type: (typeof DSAR_TYPES)[number];
  status: CreationOptional<(typeof DSAR_STATUSES)[number]>;
  /** JSONB, D-27 shape `DsarRequest.details`. */
  details: DsarDetails | null;
  requestedAt: CreationOptional<Date>;
  completedAt: Date | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  user?: NonAttribute<ModelInstance<"User">>;
}

interface DsarRequestStatics {
  associate: (models: Models) => void;
}

type DefineDsarRequest = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<DsarRequest, DsarRequestStatics>;

/** Define the DsarRequest model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineDsarRequest = (db, DataTypes) => {
  const DsarRequest = initModel<DsarRequest, DsarRequestStatics>(
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
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
      },
      type: {
        type: DataTypes.ENUM(...DSAR_TYPES),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...DSAR_STATUSES),
        allowNull: false,
        defaultValue: "pending",
      },
      details: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("DsarRequest.details") },
        allowNull: true,
      },
      requestedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "dsar_requests",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["user_id"] },
        { fields: ["status"] },
      ],
      modelName: "DsarRequest",
      sequelize: db,
    },
  );

  DsarRequest.associate = (models: Models): void => {
    DsarRequest.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    DsarRequest.belongsTo(models.User, {
      foreignKey: "userId",
      as: "user",
      onDelete: "RESTRICT",
    });
  };

  return DsarRequest;
};

export = defineModel;
