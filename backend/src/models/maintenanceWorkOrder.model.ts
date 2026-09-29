// P9-10 (ADR-087 Amendments 7–8): converted from maintenanceWorkOrder.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  DataTypes,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** The `type` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const WORK_ORDER_TYPES = ["Preventative", "Breakdown", "Repair"] as const;

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const WORK_ORDER_STATUSES = [
  "Open",
  "InProgress",
  "Completed",
  "Cancelled",
] as const;

/** The `priority` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const WORK_ORDER_PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;

/** A MaintenanceWorkOrder row (attributes, included associations, instance methods). Types only: emits nothing. */
interface MaintenanceWorkOrder extends Model<
  InferAttributes<MaintenanceWorkOrder>,
  InferCreationAttributes<MaintenanceWorkOrder>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  deviceId: string;
  title: string;
  description: string | null;
  type: CreationOptional<(typeof WORK_ORDER_TYPES)[number]>;
  status: CreationOptional<(typeof WORK_ORDER_STATUSES)[number]>;
  priority: CreationOptional<(typeof WORK_ORDER_PRIORITIES)[number]>;
  vendorId: string | null;
  assignedTo: UserId | null;
  autoScheduled: CreationOptional<boolean>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  device?: NonAttribute<ModelInstance<"CalibrationDevice">>;
  vendor?: NonAttribute<ModelInstance<"Vendor">>;
  assignee?: NonAttribute<ModelInstance<"User">>;
}

interface MaintenanceWorkOrderStatics {
  associate(models: Models): void;
}

type DefineMaintenanceWorkOrder = (
  sequelize: Sequelize,
) => TypedModel<MaintenanceWorkOrder, MaintenanceWorkOrderStatics>;

/** Define the MaintenanceWorkOrder model (a fresh class per call). */
const defineModel: DefineMaintenanceWorkOrder = (sequelize) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class MaintenanceWorkOrderModel extends Model {
    static associate(models: Models): void {
      MaintenanceWorkOrder.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "RESTRICT",
      });
      MaintenanceWorkOrder.belongsTo(models.CalibrationDevice, {
        foreignKey: "deviceId",
        as: "device",
        onDelete: "CASCADE",
      });
      MaintenanceWorkOrder.belongsTo(models.Vendor, {
        foreignKey: "vendorId",
        as: "vendor",
        onDelete: "SET NULL",
      });
      MaintenanceWorkOrder.belongsTo(models.User, {
        foreignKey: "assignedTo",
        as: "assignee",
        onDelete: "SET NULL",
      });
    }
  }

  const MaintenanceWorkOrder = initModel<
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatics
  >(
    MaintenanceWorkOrderModel,
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "tenants",
          key: "id",
        },
        onDelete: "RESTRICT",
      },
      deviceId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "calibration_devices",
          key: "id",
        },
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      type: {
        type: DataTypes.ENUM(...WORK_ORDER_TYPES),
        allowNull: false,
        defaultValue: "Preventative",
      },
      status: {
        type: DataTypes.ENUM(...WORK_ORDER_STATUSES),
        allowNull: false,
        defaultValue: "Open",
      },
      priority: {
        type: DataTypes.ENUM(...WORK_ORDER_PRIORITIES),
        allowNull: false,
        defaultValue: "Medium",
      },
      vendorId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: "vendors",
          key: "id",
        },
      },
      assignedTo: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
      },
      // W-03 — true only for a work order the calibration scan created. At
      // most ONE such order per device may be open (Open/InProgress, not
      // soft-deleted): migration 0060's partial unique index, which is what
      // makes two concurrent scans create one work order, not two. The index
      // lives only in the migration — declared here, db.sync() would try to
      // build it before the migration adds this column on an existing DB.
      autoScheduled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: "MaintenanceWorkOrder",
      tableName: "maintenance_work_orders",
      timestamps: true,
      paranoid: true,
      underscored: true,
    },
  );

  return MaintenanceWorkOrder;
};

export = defineModel;
