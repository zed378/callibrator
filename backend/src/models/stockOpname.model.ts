/**
 * StockOpname Model
 *
 * Periodic inventory counting records with status tracking.
 *
 * P9-10 batch 2 (ADR-087 Amendment 7): converted from stockOpname.model.js with
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
import { STOCK_OPNAME_STATUSES } from "@callibrator/contracts/states";

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
// P9-05: STOCK_OPNAME_STATUSES is the one list in @callibrator/contracts/states.

/** A StockOpname row (attributes, included associations, instance methods). Types only: emits nothing. */
interface StockOpname extends Model<
  InferAttributes<StockOpname>,
  InferCreationAttributes<StockOpname>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  warehouseId: string;
  status: CreationOptional<(typeof STOCK_OPNAME_STATUSES)[number] | null>;
  scheduledAt: Date;
  completedAt: Date | null;
  performedBy: UserId;
  notes: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  warehouse?: NonAttribute<ModelInstance<"Warehouse">>;
  performer?: NonAttribute<ModelInstance<"User">>;
}

interface StockOpnameStatics {
  associate: (models: Models) => void;
}

type DefineStockOpname = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<StockOpname, StockOpnameStatics>;

/** Define the StockOpname model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineStockOpname = (db, DataTypes) => {
  const StockOpname = initModel<StockOpname, StockOpnameStatics>(
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
      status: {
        type: DataTypes.ENUM(...STOCK_OPNAME_STATUSES),
        defaultValue: "draft",
      },
      scheduledAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      performedBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "stock_opnames",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["warehouse_id"] },
        { fields: ["status"] },
      ],
      modelName: "StockOpname",
      sequelize: db,
    },
  );

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  StockOpname.associate = (models: Models): void => {
    // StockOpname -> Tenant
    StockOpname.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // StockOpname -> Warehouse
    StockOpname.belongsTo(models.Warehouse, {
      foreignKey: "warehouseId",
      as: "warehouse",
      onDelete: "RESTRICT",
    });
    // StockOpname -> User (performedBy)
    StockOpname.belongsTo(models.User, {
      foreignKey: "performedBy",
      as: "performer",
      onDelete: "RESTRICT",
    });
  };

  return StockOpname;
};

export = defineModel;
