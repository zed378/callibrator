/**
 * StockTransfer Model
 *
 * Tracks inter-warehouse stock transfers.
 *
 * P9-10 batch 2 (ADR-087 Amendment 7): converted from stockTransfer.model.js with
 * no behaviour change — the pattern in initModel.ts; definition equality
 * against the JavaScript original (ADR-092 check (b)).
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
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const STOCK_TRANSFER_STATUSES = [
  "pending",
  "in_transit",
  "completed",
  "cancelled",
] as const;

/** A StockTransfer row (attributes, included associations, instance methods). Types only: emits nothing. */
interface StockTransfer extends Model<
  InferAttributes<StockTransfer>,
  InferCreationAttributes<StockTransfer>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  fromWarehouseId: string;
  toWarehouseId: string;
  status: CreationOptional<(typeof STOCK_TRANSFER_STATUSES)[number] | null>;
  requestedBy: UserId;
  approvedBy: UserId | null;
  itemName: string;
  quantity: number;
  transferDate: Date | null;
  notes: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  fromWarehouse?: NonAttribute<ModelInstance<"Warehouse">>;
  toWarehouse?: NonAttribute<ModelInstance<"Warehouse">>;
  requester?: NonAttribute<ModelInstance<"User">>;
  approver?: NonAttribute<ModelInstance<"User">>;
}

interface StockTransferStatics {
  associate: (models: Models) => void;
}

type DefineStockTransfer = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<StockTransfer, StockTransferStatics>;

/** Define the StockTransfer model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineStockTransfer = (db, DataTypes) => {
  const StockTransfer = initModel<StockTransfer, StockTransferStatics>(
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
      fromWarehouseId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "warehouses", key: "id" },
        onDelete: "RESTRICT",
      },
      toWarehouseId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "warehouses", key: "id" },
        onDelete: "RESTRICT",
      },
      status: {
        type: DataTypes.ENUM(...STOCK_TRANSFER_STATUSES),
        defaultValue: "pending",
      },
      requestedBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
      },
      approvedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      itemName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      transferDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "stock_transfers",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["from_warehouse_id"] },
        { fields: ["to_warehouse_id"] },
        { fields: ["status"] },
      ],
      modelName: "StockTransfer",
      sequelize: db,
    },
  );

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  StockTransfer.associate = (models: Models): void => {
    // StockTransfer -> Tenant
    StockTransfer.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // StockTransfer -> Warehouse (from)
    StockTransfer.belongsTo(models.Warehouse, {
      foreignKey: "fromWarehouseId",
      as: "fromWarehouse",
      onDelete: "RESTRICT",
    });
    // StockTransfer -> Warehouse (to)
    StockTransfer.belongsTo(models.Warehouse, {
      foreignKey: "toWarehouseId",
      as: "toWarehouse",
      onDelete: "RESTRICT",
    });
    // StockTransfer -> User (requestedBy)
    StockTransfer.belongsTo(models.User, {
      foreignKey: "requestedBy",
      as: "requester",
      onDelete: "RESTRICT",
    });
    // StockTransfer -> User (approvedBy)
    StockTransfer.belongsTo(models.User, {
      foreignKey: "approvedBy",
      as: "approver",
      onDelete: "SET NULL",
    });
  };

  return StockTransfer;
};

export = defineModel;
