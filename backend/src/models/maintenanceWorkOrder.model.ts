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
import { WORK_ORDER_STATUSES } from "@callibrator/contracts/states";

/**
 * D-21: a NUMERIC read back from pg (a string) as a number; null AND undefined
 * are returned as they are. Typed `unknown` in and out: the value getDataValue
 * holds is the driver's string, whatever the attribute's declared type.
 */
const toNumber = (value: unknown): unknown =>
  value === null || value === undefined ? value : Number(value);

/** The `type` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const WORK_ORDER_TYPES = ["Preventative", "Breakdown", "Repair"] as const;

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
// P9-05: WORK_ORDER_STATUSES is the one list in @callibrator/contracts/states.

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
  /** Q-55 (migration 0107): when the work is planned, and when it was done. */
  scheduledDate: Date | null;
  completedDate: Date | null;
  /** Q-55: DECIMAL(14,2) ≥ 0, read as a number by its getter (D-21). `raw: true` / SUM() still return a string. */
  estimatedCost: number | null;
  /** Q-55: DECIMAL(14,2) ≥ 0, read as a number by its getter (D-21). */
  actualCost: number | null;
  /** Q-55: how the device was returned to service, ≤ 5000 characters (a CHECK, and the contract's bound). */
  resolutionNotes: string | null;
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
      // Q-55 (migration 0107, ADR-097 Am. 4): accepted by the API since P9-11 and
      // dropped until these attributes existed. The bounds are CHECKs in the
      // migration (sync never creates a CHECK) and the contract's 400s; no index.
      scheduledDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      completedDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      estimatedCost: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: true,
        // D-21: node-postgres returns NUMERIC as a string ("1250.00"); read as a
        // number, NULL stays NULL. `raw: true` queries and SUM() bypass this.
        get(this: MaintenanceWorkOrder): unknown {
          return toNumber(this.getDataValue("estimatedCost"));
        },
      },
      actualCost: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: true,
        // D-21: node-postgres returns NUMERIC as a string ("1250.00"); read as a
        // number, NULL stays NULL. `raw: true` queries and SUM() bypass this.
        get(this: MaintenanceWorkOrder): unknown {
          return toNumber(this.getDataValue("actualCost"));
        },
      },
      resolutionNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
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
