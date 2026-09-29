/**
 * UsageMetric Model
 *
 * Time-bucketed per-tenant usage counters (api_calls, storage_bytes,
 * calibrations, ...). Aggregated by periodStart. Intentionally NOT underscored:
 * the metered-billing service's Postgres aggregation path queries the
 * "UsageMetrics" table with camelCase "tenantId"/"periodStart" columns, so the
 * model column names must match that shape.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from usageMetric.model.js with no behaviour
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

/** A UsageMetric row (attributes, included associations, instance methods). Types only: emits nothing. */
interface UsageMetric extends Model<
  InferAttributes<UsageMetric>,
  InferCreationAttributes<UsageMetric>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  metric: string;
  periodStart: Date;
  count: CreationOptional<number>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
}

interface UsageMetricStatics {
  associate: (models: Models) => void;
}

type DefineUsageMetric = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<UsageMetric, UsageMetricStatics>;

/** Define the UsageMetric model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineUsageMetric = (db, DataTypes) => {
  const UsageMetric = initModel<UsageMetric, UsageMetricStatics>(
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
      periodStart: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "UsageMetrics",
      timestamps: true,
      indexes: [
        { fields: ["tenantId", "metric", "periodStart"], unique: true },
        { fields: ["tenantId"] },
        { fields: ["periodStart"] },
      ],
      modelName: "UsageMetric",
      sequelize: db,
    },
  );

  UsageMetric.associate = (models: Models): void => {
    UsageMetric.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "CASCADE",
    });
  };

  return UsageMetric;
};

export = defineModel;
