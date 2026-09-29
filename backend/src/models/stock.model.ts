/**
 * Stock Model
 *
 * Tracks inventory levels per item per warehouse location.
 *
 * P9-10 batch 2 (ADR-087 Amendment 7): converted from stock.model.js with
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
import type { TenantId } from "../types/ids";
import type { DefaultScoped, ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A Stock row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Stock extends Model<
  InferAttributes<Stock>,
  InferCreationAttributes<Stock>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  warehouseId: string;
  locationId: string | null;
  itemName: string;
  sku: string | null;
  serialNumber: string | null;
  quantity: CreationOptional<number>;
  minQuantity: CreationOptional<number>;
  description: string | null;
  isDeleted: CreationOptional<boolean>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  warehouse?: NonAttribute<ModelInstance<"Warehouse">>;
  location?: NonAttribute<ModelInstance<"StorageLocation">>;

  softDelete(): Promise<Stock>;
}

interface StockStatics {
  associate: (models: Models) => void;
  restoreStatic: (id: string) => Promise<[affectedCount: number]>;
  /** D-12: the defaultScope carries a `where`, so a bare include of Stock is an INNER JOIN. Phantom: never read at run time. */
  readonly defaultScoped: DefaultScoped;
}

type DefineStock = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<Stock, StockStatics>;

/** Define the Stock model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineStock = (db, DataTypes) => {
  const Stock = initModel<Stock, StockStatics>(
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
      itemName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      sku: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      serialNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      minQuantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    },
    {
      tableName: "stocks",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["warehouse_id"] },
        { fields: ["location_id"] },
        { fields: ["sku"] },
        { fields: ["serial_number"] },
        { fields: ["is_deleted"] },
      ],
      defaultScope: {
        // @ts-expect-error -- the key is the COLUMN is_deleted, not the attribute isDeleted: a caller's where on is_deleted REPLACES this default only with the column key (P9-10 spec, probe 3)
        where: { is_deleted: false },
      },
      scopes: {
        includeDeleted: {
          // @ts-expect-error -- where: null clears the defaultScope's predicate when the scopes are combined; {} would keep it (P9-10 spec, probe 2)
          where: null,
        },
      },
      modelName: "Stock",
      sequelize: db,
    },
  );

  /**
   * Soft-delete a stock record. Sets is_deleted = true and persists.
   */
  Stock.prototype.softDelete = async function (this: Stock): Promise<Stock> {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  /**
   * Restore a soft-deleted stock record by ID. Sets is_deleted = false.
   */
  Stock.restoreStatic = async function (
    this: TypedModel<Stock, StockStatics>,
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
  Stock.associate = (models: Models): void => {
    // Stock -> Tenant
    Stock.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // Stock -> Warehouse
    Stock.belongsTo(models.Warehouse, {
      foreignKey: "warehouseId",
      as: "warehouse",
      onDelete: "RESTRICT",
    });
    // Stock -> StorageLocation
    Stock.belongsTo(models.StorageLocation, {
      foreignKey: "locationId",
      as: "location",
      onDelete: "SET NULL",
    });
  };

  return Stock;
};

export = defineModel;
