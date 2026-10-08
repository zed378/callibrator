/**
 * Warehouse Model
 *
 * Physical warehouse locations for a tenant.
 *
 * P9-10 batch 2 (ADR-087 Amendment 7): converted from warehouse.model.js with
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
import { WAREHOUSE_KINDS, type WarehouseKind } from "@callibrator/contracts/deviceValues";
import type { ClientFacilityId, TenantId } from "../types/ids";
import type { DefaultScoped, ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const WAREHOUSE_STATUSES = ["active", "inactive"] as const;

/** A Warehouse row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Warehouse extends Model<
  InferAttributes<Warehouse>,
  InferCreationAttributes<Warehouse>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  /**
   * P20-07 (ADR-124 Am. 2, G-F4): the client facility a room belongs to; NULL = the provider's own
   * store. Composite foreign key `(tenant_id, client_facility_id)` → client_facilities in migration
   * 0123; the CHECK that a room carries one waits for UD-10's room kind.
   */
  clientFacilityId: CreationOptional<ClientFacilityId | null>;
  name: string;
  code: string;
  address: string | null;
  description: string | null;
  status: CreationOptional<(typeof WAREHOUSE_STATUSES)[number] | null>;
  /**
   * P20-02 (UD-10, ADR-132 § 5; migration 0128): a provider's `store` (the default — every row
   * before 0128) or a facility's `room`. CHECKs there: a room has a facility, a store no floor; a
   * room's name and floor are unique per facility among live rooms.
   */
  kind: CreationOptional<WarehouseKind>;
  /** A room's floor (upstream `lantai`); NULL for a store. */
  floor: CreationOptional<string | null>;
  isDeleted: CreationOptional<boolean>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  locations?: NonAttribute<ModelInstance<"StorageLocation">[]>;
  stocks?: NonAttribute<ModelInstance<"Stock">[]>;
  outgoingTransfers?: NonAttribute<ModelInstance<"StockTransfer">[]>;
  incomingTransfers?: NonAttribute<ModelInstance<"StockTransfer">[]>;
  adjustments?: NonAttribute<ModelInstance<"StockAdjustment">[]>;
  opnames?: NonAttribute<ModelInstance<"StockOpname">[]>;

  softDelete(): Promise<Warehouse>;
}

interface WarehouseStatics {
  associate: (models: Models) => void;
  restoreStatic: (id: string) => Promise<[affectedCount: number]>;
  /** D-12: the defaultScope carries a `where`, so a bare include of Warehouse is an INNER JOIN. Phantom: never read at run time. */
  readonly defaultScoped: DefaultScoped;
}

type DefineWarehouse = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<Warehouse, WarehouseStatics>;

/** Define the Warehouse model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineWarehouse = (db, DataTypes) => {
  const Warehouse = initModel<Warehouse, WarehouseStatics>(
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
      // P20-07: nullable; the composite key lives in migration 0123 (ADR-100 Am. 3).
      clientFacilityId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      code: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      address: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(...WAREHOUSE_STATUSES),
        defaultValue: "active",
      },
      // P20-02 (migration 0128): no index or CHECK here (ADR-100 Am. 3).
      kind: {
        type: DataTypes.ENUM(...WAREHOUSE_KINDS),
        allowNull: false,
        defaultValue: "store",
      },
      floor: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    },
    {
      tableName: "warehouses",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["code"] },
        { fields: ["status"] },
        { fields: ["is_deleted"] },
      ],
      defaultScope: {
        // @ts-expect-error -- the key is the COLUMN is_deleted, not the attribute isDeleted: a caller's where on is_deleted REPLACES this default only with the column key (P9-10 spec, probe 3)
        where: { is_deleted: false },
      },
      // A-274 (2026-09-30): the unused `includeDeleted` scope was removed — no
      // caller used it, and `.scope(["defaultScope", "includeDeleted"])` would have
      // silently dropped the soft-delete predicate. Use `.unscoped()` deliberately.
      modelName: "Warehouse",
      sequelize: db,
    },
  );

  /**
   * Soft-delete a warehouse. Sets is_deleted = true and persists.
   */
  Warehouse.prototype.softDelete = async function (
    this: Warehouse,
  ): Promise<Warehouse> {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  /**
   * Restore a soft-deleted warehouse by ID. Sets is_deleted = false.
   */
  Warehouse.restoreStatic = async function (
    this: TypedModel<Warehouse, WarehouseStatics>,
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
  Warehouse.associate = (models: Models): void => {
    // Warehouse -> StorageLocation (hasMany)
    Warehouse.hasMany(models.StorageLocation, {
      foreignKey: "warehouseId",
      as: "locations",
      onDelete: "RESTRICT",
    });
    // Warehouse -> Stock (hasMany)
    Warehouse.hasMany(models.Stock, {
      foreignKey: "warehouseId",
      as: "stocks",
      onDelete: "RESTRICT",
    });
    // Warehouse -> StockTransfer (fromWarehouse)
    Warehouse.hasMany(models.StockTransfer, {
      foreignKey: "fromWarehouseId",
      as: "outgoingTransfers",
      onDelete: "RESTRICT",
    });
    // Warehouse -> StockTransfer (toWarehouse)
    Warehouse.hasMany(models.StockTransfer, {
      foreignKey: "toWarehouseId",
      as: "incomingTransfers",
      onDelete: "RESTRICT",
    });
    // Warehouse -> StockAdjustment (hasMany)
    Warehouse.hasMany(models.StockAdjustment, {
      foreignKey: "warehouseId",
      as: "adjustments",
      onDelete: "RESTRICT",
    });
    // Warehouse -> StockOpname (hasMany)
    Warehouse.hasMany(models.StockOpname, {
      foreignKey: "warehouseId",
      as: "opnames",
      onDelete: "RESTRICT",
    });
  };

  return Warehouse;
};

export = defineModel;
