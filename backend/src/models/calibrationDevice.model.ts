/**
 * CalibrationDevice Model
 *
 * Tracks calibration devices with their calibration schedule.
 * Each device belongs to a tenant and can be assigned to a warehouse.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from calibrationDevice.model.js with no behaviour
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
import {
  jsonShape,
  type ReadingTolerance,
  type UncertaintyBudget,
} from "../utils/jsonShape.util";
import type { TenantId } from "../types/ids";
import type { DefaultScoped, ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/**
 * Define the CalibrationDevice model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
// D-27 (ADR-070): every JSON column declares its shape, validated on write.
/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const CALIBRATION_DEVICE_STATUSES = [
  "active",
  "inactive",
  "maintenance",
  "retired",
] as const;

/** A CalibrationDevice row (attributes, included associations, instance methods). Types only: emits nothing. */
interface CalibrationDevice extends Model<
  InferAttributes<CalibrationDevice>,
  InferCreationAttributes<CalibrationDevice>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  name: string;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  category: string | null;
  status: CreationOptional<(typeof CALIBRATION_DEVICE_STATUSES)[number] | null>;
  locationId: string | null;
  installationDate: Date | null;
  nextCalibrationDate: Date | null;
  calibrationIntervalDays: number | null;
  /** JSONB, D-27 shape `CalibrationDevice.uncertaintyBudget`. */
  uncertaintyBudget: UncertaintyBudget | null;
  remarks: string | null;
  /** A-29: excluded by the defaultScope and by toJSON; still an attribute (an unscoped read and create() carry it). */
  iotTokenHash: string | null;
  iotTokenIssuedAt: Date | null;
  iotEnabled: CreationOptional<boolean>;
  /** JSONB, D-27 shape `CalibrationDevice.readingTolerance`. */
  readingTolerance: ReadingTolerance | null;
  recommendedCalibrationInterval: number | null;
  recommendationReason: string | null;
  isDeleted: CreationOptional<boolean>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  warehouse?: NonAttribute<ModelInstance<"Warehouse">>;
  calibrationRecords?: NonAttribute<ModelInstance<"CalibrationRecord">[]>;

  softDelete(): Promise<CalibrationDevice>;
}

interface CalibrationDeviceStatics {
  associate: (models: Models) => void;
  restoreStatic: (id: string) => Promise<[affectedCount: number]>;
  /** D-12: the defaultScope carries a `where`, so a bare include is an INNER JOIN. Phantom: never read at run time. */
  readonly defaultScoped: DefaultScoped;
}

type DefineCalibrationDevice = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<CalibrationDevice, CalibrationDeviceStatics>;

/** Define the CalibrationDevice model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineCalibrationDevice = (db, DataTypes) => {
  const CalibrationDevice = initModel<
    CalibrationDevice,
    CalibrationDeviceStatics
  >(
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
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // Unique PER TENANT (D-04): UNIQUE (tenant_id, serial_number), created
      // by migration 0026 — not here, so db.sync() cannot build it before the
      // migration has checked for duplicates. It used to be `unique: true`, a
      // GLOBAL constraint: a cross-tenant existence oracle (CLAUDE.md traps).
      serialNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      manufacturer: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      model: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      category: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(...CALIBRATION_DEVICE_STATUSES),
        defaultValue: "active",
      },
      locationId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "warehouses", key: "id" },
        onDelete: "SET NULL",
      },
      installationDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      nextCalibrationDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      calibrationIntervalDays: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "Days between automatic recalibration",
      },
      uncertaintyBudget: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("CalibrationDevice.uncertaintyBudget") },
        allowNull: true,
        comment:
          "Stores parameters and formulas for measurement uncertainty budget",
      },
      remarks: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // A-29: the ingest token is stored ONLY as a hex SHA-256 hash (migration
      // 0044, which also creates its unique index — not here, see 0026). The
      // plaintext is shown once, by services/iotDevice.service.js, and never
      // stored. The hash is excluded from the defaultScope and from toJSON()
      // below, so no device response carries it.
      iotTokenHash: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment:
          "SHA-256 (hex) of the IoT ingest token; the token itself is never stored",
      },
      iotTokenIssuedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      iotEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      readingTolerance: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("CalibrationDevice.readingTolerance") },
        allowNull: true,
        comment:
          "Stores upper/lower bounds for anomaly detection on IoT readings",
      },
      recommendedCalibrationInterval: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment:
          "AI/Algorithmic recommendation for calibration interval in days",
      },
      recommendationReason: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Reason for the recommended interval change",
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    },
    {
      tableName: "calibration_devices",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["status"] },
        { fields: ["next_calibration_date"] },
        { fields: ["is_deleted"] },
      ],
      defaultScope: {
        // @ts-expect-error -- the key is the COLUMN is_deleted, not the attribute isDeleted: a caller's where on is_deleted REPLACES this default only with the column key (P9-10 spec, probe 3)
        where: { is_deleted: false },
        attributes: { exclude: ["iotTokenHash"] }, // A-29
      },
      // A-274 (2026-09-30): the unused `includeDeleted` scope was removed — no
      // caller used it, and `.scope(["defaultScope", "includeDeleted"])` would have
      // silently dropped the soft-delete predicate. Use `.unscoped()` deliberately.
      modelName: "CalibrationDevice",
      sequelize: db,
    },
  );

  /**
   * A-29 — the token hash never leaves the server, even from a row loaded
   * `.unscoped()` or returned by create(). Belt and braces with the
   * defaultScope exclusion above.
   * @returns {object} the plain values without `iotTokenHash`
   */
  // Model#toJSON is generic (`toJSON<T>(): T`); the override keeps that signature.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the override must match Model#toJSON<T>(): T
  CalibrationDevice.prototype.toJSON = function <T>(
    this: CalibrationDevice,
  ): T {
    const values: Partial<InferAttributes<CalibrationDevice>> = {
      ...this.get({ plain: true }),
    };
    delete values.iotTokenHash;
    return values as T;
  };

  /**
   * Soft-delete a calibration device. Sets is_deleted = true and persists.
   */
  CalibrationDevice.prototype.softDelete = async function (
    this: CalibrationDevice,
  ): Promise<CalibrationDevice> {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  /**
   * Restore a soft-deleted calibration device by ID. Sets is_deleted = false.
   */
  CalibrationDevice.restoreStatic = async function (
    this: TypedModel<CalibrationDevice, CalibrationDeviceStatics>,
    id: string,
  ): Promise<[affectedCount: number]> {
    // `isDeleted` is the ATTRIBUTE (column is_deleted via underscored).
    // Model.update intersects its values with attribute names, so the former
    // `{ is_deleted: false }` was dropped and nothing was written (D-07).
    // unscoped(): the defaultScope pins isDeleted = false, which a restore
    // must not inherit; paranoid and the global tenant hooks still apply.
    return this.unscoped().update(
      { isDeleted: false },
      { where: { id, isDeleted: true } },
    );
  };

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  CalibrationDevice.associate = (models: Models): void => {
    // CalibrationDevice -> Tenant
    CalibrationDevice.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // CalibrationDevice -> Warehouse
    CalibrationDevice.belongsTo(models.Warehouse, {
      foreignKey: "locationId",
      as: "warehouse",
      onDelete: "SET NULL",
    });
    // CalibrationDevice -> CalibrationRecord (hasMany)
    CalibrationDevice.hasMany(models.CalibrationRecord, {
      foreignKey: "deviceId",
      as: "calibrationRecords",
      onDelete: "RESTRICT",
    });
  };

  return CalibrationDevice;
};

export = defineModel;
