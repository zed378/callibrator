/**
 * StorageLocation Model
 *
 * Specific storage locations within a warehouse (shelf, bin, rack, etc.).
 *
 * P9-10 batch 2 (ADR-087 Amendment 7): converted from storageLocation.model.js with
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
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A StorageLocation row (attributes, included associations, instance methods). Types only: emits nothing. */
interface StorageLocation extends Model<
  InferAttributes<StorageLocation>,
  InferCreationAttributes<StorageLocation>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  warehouseId: string;
  name: string;
  code: string;
  description: string | null;
  isActive: CreationOptional<boolean | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  warehouse?: NonAttribute<ModelInstance<"Warehouse">>;
  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  stocks?: NonAttribute<ModelInstance<"Stock">[]>;
}

interface StorageLocationStatics {
  associate: (models: Models) => void;
}

type DefineStorageLocation = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<StorageLocation, StorageLocationStatics>;

/** Define the StorageLocation model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineStorageLocation = (db, DataTypes) => {
  const StorageLocation = initModel<StorageLocation, StorageLocationStatics>(
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
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      code: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName: "storage_locations",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["warehouse_id"] },
        { fields: ["code"] },
        { fields: ["is_active"] },
      ],
      modelName: "StorageLocation",
      sequelize: db,
    },
  );

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  StorageLocation.associate = (models: Models): void => {
    // StorageLocation -> Warehouse
    StorageLocation.belongsTo(models.Warehouse, {
      foreignKey: "warehouseId",
      as: "warehouse",
      onDelete: "RESTRICT",
    });
    // StorageLocation -> Tenant
    StorageLocation.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // StorageLocation -> Stock (hasMany)
    StorageLocation.hasMany(models.Stock, {
      foreignKey: "locationId",
      as: "stocks",
      onDelete: "SET NULL",
    });
  };

  return StorageLocation;
};

export = defineModel;
