/**
 * UsageAlert Model
 *
 * Per-tenant usage-threshold alerts. When a monitored metric crosses the
 * configured threshold (per the comparison operator), notifications are sent on
 * the configured channels.
 */
// D-27 (ADR-070): every JSON column declares its shape, validated on write.
// P9-10 (ADR-087 Amendments 7–8): converted from usageAlert.model.js with no behaviour
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
import { jsonShape, type NotificationChannels } from "../utils/jsonShape.util";
import type { TenantId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** The `comparison` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const USAGE_ALERT_COMPARISONS = ["gte", "lte", "eq", "gt", "lt"] as const;

/** A UsageAlert row (attributes, included associations, instance methods). Types only: emits nothing. */
interface UsageAlert extends Model<
  InferAttributes<UsageAlert>,
  InferCreationAttributes<UsageAlert>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  metricName: string;
  threshold: number;
  comparison: CreationOptional<(typeof USAGE_ALERT_COMPARISONS)[number]>;
  /** JSONB, D-27 shape `UsageAlert.notificationChannels`. */
  notificationChannels: CreationOptional<NotificationChannels>;
  isEnabled: CreationOptional<boolean>;
  description: CreationOptional<string | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
}

interface UsageAlertStatics {
  associate: (models: Models) => void;
}

type DefineUsageAlert = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<UsageAlert, UsageAlertStatics>;

/** Define the UsageAlert model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineUsageAlert = (db, DataTypes) => {
  const UsageAlert = initModel<UsageAlert, UsageAlertStatics>(
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
      metricName: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      threshold: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
      comparison: {
        type: DataTypes.ENUM(...USAGE_ALERT_COMPARISONS),
        allowNull: false,
        defaultValue: "gte",
      },
      notificationChannels: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("UsageAlert.notificationChannels") },
        allowNull: false,
        defaultValue: ["email"],
      },
      isEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      description: {
        type: DataTypes.STRING(500),
        allowNull: true,
        defaultValue: "",
      },
    },
    {
      tableName: "usage_alerts",
      timestamps: true,
      underscored: true,
      indexes: [{ fields: ["tenant_id"] }, { fields: ["metric_name"] }],
      modelName: "UsageAlert",
      sequelize: db,
    },
  );

  UsageAlert.associate = (models: Models): void => {
    UsageAlert.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "CASCADE",
    });
  };

  return UsageAlert;
};

export = defineModel;
