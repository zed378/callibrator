/**
 * StockAdjustment Model
 *
 * Tracks manual stock adjustments (addition/subtraction/write_off).
 *
 * P9-10 batch 2 (ADR-087 Amendment 7): converted from stockAdjustment.model.js with
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

/** The `type` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const STOCK_ADJUSTMENT_TYPES = [
  "addition",
  "subtraction",
  "write_off",
] as const;

/** A StockAdjustment row (attributes, included associations, instance methods). Types only: emits nothing. */
interface StockAdjustment extends Model<
  InferAttributes<StockAdjustment>,
  InferCreationAttributes<StockAdjustment>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  warehouseId: string;
  locationId: string | null;
  type: (typeof STOCK_ADJUSTMENT_TYPES)[number];
  quantity: number;
  reason: string;
  stockId: string | null;
  quantityBefore: number | null;
  quantityAfter: number | null;
  adjustedBy: UserId;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  warehouse?: NonAttribute<ModelInstance<"Warehouse">>;
  location?: NonAttribute<ModelInstance<"StorageLocation">>;
  stock?: NonAttribute<ModelInstance<"Stock">>;
  adjuster?: NonAttribute<ModelInstance<"User">>;
}

interface StockAdjustmentStatics {
  associate: (models: Models) => void;
}

type DefineStockAdjustment = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<StockAdjustment, StockAdjustmentStatics>;

/** Define the StockAdjustment model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineStockAdjustment = (db, DataTypes) => {
  const StockAdjustment = initModel<StockAdjustment, StockAdjustmentStatics>(
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
      warehouseId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "warehouses", key: "id" },
        onDelete: "RESTRICT",
      },
      locationId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "storage_locations", key: "id" },
        onDelete: "SET NULL",
      },
      type: {
        type: DataTypes.ENUM(...STOCK_ADJUSTMENT_TYPES),
        allowNull: false,
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // P6-09: required, and never blank — CHECK (btrim(reason) <> '') from
      // migration 0059. Rows older than P6-09 carry a reason saying none was
      // recorded.
      reason: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // P6-09: WHICH item moved, and from what to what. Nullable only because
      // rows written before migration 0059 cannot be attributed after the
      // fact; stock.service writes all three on every adjustment.
      stockId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "stocks", key: "id" },
        onDelete: "RESTRICT",
      },
      quantityBefore: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      quantityAfter: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      adjustedBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
      },
    },
    {
      tableName: "stock_adjustments",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["warehouse_id"] },
        { fields: ["type"] },
      ],
      modelName: "StockAdjustment",
      sequelize: db,
    },
  );

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  StockAdjustment.associate = (models: Models): void => {
    // StockAdjustment -> Tenant
    StockAdjustment.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // StockAdjustment -> Warehouse
    StockAdjustment.belongsTo(models.Warehouse, {
      foreignKey: "warehouseId",
      as: "warehouse",
      onDelete: "RESTRICT",
    });
    // StockAdjustment -> StorageLocation
    StockAdjustment.belongsTo(models.StorageLocation, {
      foreignKey: "locationId",
      as: "location",
      onDelete: "SET NULL",
    });
    // StockAdjustment -> Stock (the item adjusted; P6-09)
    StockAdjustment.belongsTo(models.Stock, {
      foreignKey: "stockId",
      as: "stock",
      onDelete: "RESTRICT",
    });
    // StockAdjustment -> User (adjustedBy)
    StockAdjustment.belongsTo(models.User, {
      foreignKey: "adjustedBy",
      as: "adjuster",
      onDelete: "RESTRICT",
    });
  };

  return StockAdjustment;
};

export = defineModel;
