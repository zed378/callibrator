/**
 * DeviceType Model — one type of medical device in the GLOBAL inspection
 * catalogue (P20-01; ADR-125 and its Amendment 1; spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 4.1).
 *
 * GLOBAL, by decision (UD-3, ADR-125 § 1): no `tenantId`, no `clientFacilityId`
 * — the tenant hooks scope a model iff it declares a tenant attribute
 * (`tenantScope.util#tenantKeyOf`), so they leave this one alone, and the
 * facility dimension of ADR-124 does not apply to global models. Every write
 * is the platform operator's (`superAdminOnly`, P21-01). Listed in
 * unscopedModels.d17 as `global`; held by catalogueModels.p2003.guard.
 *
 * NOT paranoid and NO defaultScope (G-4): an include of a model with a
 * defaultScope is an INNER JOIN (the A-75 trap) — a device including its
 * retired type would vanish from a list. `status` (`retired`) is the only
 * removal; the database refuses a DELETE (migration 0111's trigger).
 *
 * NO association to a tenant model (ADR-125 § 7): a device names its type
 * (`CalibrationDevice.belongsTo(DeviceType)`, tenant → global), never the
 * reverse — a type's device count across tenants would be other tenants' data.
 *
 * The table, its CHECKs, its unique and foreign-key indexes and its trigger
 * are created by migration 0111; none is declared here (db.sync() runs before
 * the migrations at boot — ADR-100 Am. 3).
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import { DEVICE_TYPE_STATUSES, type DeviceTypeStatus } from "@callibrator/contracts/states";
import type { DeviceTypeId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A DeviceType row. Types only: emits nothing. */
interface DeviceType extends Model<InferAttributes<DeviceType>, InferCreationAttributes<DeviceType>> {
  id: CreationOptional<DeviceTypeId>;
  /** Trimmed, internal whitespace collapsed; unique over every status, case-insensitively. */
  name: string;
  status: CreationOptional<DeviceTypeStatus>;
  /** Upstream `mst_alat.id` (P24-02); never returned to tenants. */
  legacyId: CreationOptional<number | null>;
  /** The operator who created / last changed it; never returned to tenants. */
  createdBy: CreationOptional<UserId | null>;
  updatedBy: CreationOptional<UserId | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  template?: NonAttribute<ModelInstance<"InspectionTemplate"> | null>;
}

interface DeviceTypeStatics {
  associate: (models: Models) => void;
}

type DefineDeviceType = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<DeviceType, DeviceTypeStatics>;

/** Define the DeviceType model on `db`. */
const defineModel: DefineDeviceType = (db, DataTypes) => {
  const user = { model: "users", key: "id" };
  const DeviceType = initModel<DeviceType, DeviceTypeStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      status: { type: DataTypes.ENUM(...DEVICE_TYPE_STATUSES), allowNull: false, defaultValue: "active" },
      legacyId: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      updatedBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
    },
    {
      tableName: "device_types",
      timestamps: true,
      paranoid: false,
      underscored: true,
      modelName: "DeviceType",
      sequelize: db,
    },
  );

  DeviceType.associate = (models: Models): void => {
    // Global → global only (ADR-125 § 7). At most one template per type (UNIQUE in 0112).
    DeviceType.hasOne(models.InspectionTemplate, { foreignKey: "deviceTypeId", as: "template", onDelete: "RESTRICT" });
  };

  return DeviceType;
};

export = defineModel;
