/**
 * IotReading Model
 *
 * Stores time-series telemetry data from IoT calibration devices.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from iotReading.model.js with no behaviour
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
import { jsonShape, type IotMetrics } from "../utils/jsonShape.util";
import type { TenantId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

// D-27 (ADR-070): every JSON column declares its shape, validated on write.
/** A IotReading row (attributes, included associations, instance methods). Types only: emits nothing. */
interface IotReading extends Model<
  InferAttributes<IotReading>,
  InferCreationAttributes<IotReading>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  deviceId: string;
  timestamp: CreationOptional<Date>;
  /** JSONB, D-27 shape `IotReading.metrics`. */
  metrics: IotMetrics;
  isAnomaly: CreationOptional<boolean>;
  /** Immutable timeseries: `updatedAt: false`, so createdAt only. */
  createdAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  device?: NonAttribute<ModelInstance<"CalibrationDevice">>;
}

interface IotReadingStatics {
  associate: (models: Models) => void;
}

type DefineIotReading = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<IotReading, IotReadingStatics>;

/** Define the IotReading model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineIotReading = (db, DataTypes) => {
  const IotReading = initModel<IotReading, IotReadingStatics>(
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
      deviceId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "calibration_devices", key: "id" },
        onDelete: "RESTRICT",
      },
      timestamp: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      metrics: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("IotReading.metrics") },
        allowNull: false,
        comment:
          "Stores the telemetry readings (e.g. { temperature: 22, humidity: 45 })",
      },
      isAnomaly: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    },
    {
      tableName: "iot_readings",
      timestamps: true,
      updatedAt: false, // Immutable timeseries data
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["device_id"] },
        { fields: ["timestamp"] },
        { fields: ["device_id", "timestamp"] },
        // D-19 (migration 0067 creates the same names on an existing
        // database): a device's telemetry window inside its tenant, and the
        // tenant time range the retention purge deletes by.
        { fields: ["tenant_id", "device_id", "timestamp"] },
        { fields: ["tenant_id", "timestamp"] },
      ],
      modelName: "IotReading",
      sequelize: db,
    },
  );

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  IotReading.associate = (models: Models): void => {
    // IotReading -> Tenant
    IotReading.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // IotReading -> CalibrationDevice
    IotReading.belongsTo(models.CalibrationDevice, {
      foreignKey: "deviceId",
      as: "device",
      onDelete: "RESTRICT",
    });
  };

  return IotReading;
};

export = defineModel;
