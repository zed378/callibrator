/**
 * PlanQuota Model
 *
 * Per-tenant quota limits per metric, used by usage/quota enforcement. A null
 * value would mean "unlimited"; a positive integer is the hard limit.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from planQuota.model.js with no behaviour
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

/** A PlanQuota row (attributes, included associations, instance methods). Types only: emits nothing. */
interface PlanQuota extends Model<
  InferAttributes<PlanQuota>,
  InferCreationAttributes<PlanQuota>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  metric: string;
  /** null = unlimited. */
  limit: number | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
}

interface PlanQuotaStatics {
  associate: (models: Models) => void;
}

type DefinePlanQuota = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<PlanQuota, PlanQuotaStatics>;

/** Define the PlanQuota model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefinePlanQuota = (db, DataTypes) => {
  const PlanQuota = initModel<PlanQuota, PlanQuotaStatics>(
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
      metric: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      limit: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: "plan_quotas",
      timestamps: true,
      underscored: true,
      indexes: [{ fields: ["tenant_id", "metric"], unique: true }],
      modelName: "PlanQuota",
      sequelize: db,
    },
  );

  PlanQuota.associate = (models: Models): void => {
    PlanQuota.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "CASCADE",
    });
  };

  return PlanQuota;
};

export = defineModel;
